import dns from 'dns'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import mongoose from 'mongoose'
import { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, BorderStyle } from 'docx'
import { clerkMiddleware, getAuth } from '@clerk/express'
dns.setServers(['8.8.8.8', '8.8.4.4'])

function decodeHtmlEntities(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

dotenv.config()

const app = express()
const PORT = 3001

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'https://resume-optimizer-delta-dusky.vercel.app']
}))
app.use(express.json({ limit: '10mb' }))
app.use(clerkMiddleware())

// ── MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err))

// ── Job Schema
const jobSchema = new mongoose.Schema({
  id:              { type: String, unique: true },
  title:           String,
  company:         String,
  companySlug:     String,
  location:        String,
  isRemote:        Boolean,
  description:     String,
  applyUrl:        String,
  postedAt:        Date,
  sponsorBadge:    Boolean,
  ats:             String,
  fetchedAt:       Date,
  experienceLevel: String,
  workType:        String,
  state:           String,
  salaryMin:       Number,
  salaryMax:       Number,
  employmentType:  String,
  yearsMin:        Number,
  yearsMax:        Number,
})

jobSchema.index({ title: 'text', company: 'text' })
jobSchema.index({ postedAt: -1 })
jobSchema.index({ sponsorBadge: 1 })
jobSchema.index({ isRemote: 1 })
jobSchema.index({ state: 1 })
jobSchema.index({ workType: 1 })
jobSchema.index({ experienceLevel: 1 })

const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

// ── Auth guard — returns a JSON 401 instead of redirecting
function requireUser(req, res, next) {
  const { userId } = getAuth(req)
  if (!userId) return res.status(401).json({ error: 'You need to be signed in.' })
  req.userId = userId
  next()
}

// ── User Schema
const userSchema = new mongoose.Schema({
  clerkUserId:    { type: String, required: true, unique: true, index: true },
  resumeText:     { type: String, default: '' },
  resumeFileName: { type: String, default: '' },
  updatedAt:      { type: Date, default: Date.now },
})

const User = mongoose.models.User || mongoose.model('User', userSchema)

app.get('/', (req, res) => {
  res.json({ message: 'Resume Optimizer backend is running.' })
})

// ── ME / RESUME — the logged-in user's saved resume
app.get('/me/resume', requireUser, async (req, res) => {
  try {
    const userId = req.userId
    const user = await User.findOne({ clerkUserId: userId }).lean()
    res.json({
      hasResume:      Boolean(user?.resumeText),
      resumeText:     user?.resumeText     || '',
      resumeFileName: user?.resumeFileName || '',
      updatedAt:      user?.updatedAt      || null,
    })
  } catch (error) {
    console.error('Get resume error:', error)
    res.status(500).json({ error: 'Failed to load your resume. Please try again.' })
  }
})

app.post('/me/resume', requireUser, async (req, res) => {
  try {
    const userId = req.userId
    const { resumeText, resumeFileName } = req.body

    if (!resumeText || !resumeText.trim()) {
      return res.status(400).json({ error: 'Please provide your resume text.' })
    }
    if (resumeText.length > 100000) {
      return res.status(400).json({ error: 'That resume is too long — please shorten it.' })
    }

    const user = await User.findOneAndUpdate(
      { clerkUserId: userId },
      {
        clerkUserId:    userId,
        resumeText:     resumeText.trim(),
        resumeFileName: resumeFileName || '',
        updatedAt:      new Date(),
      },
      { upsert: true, new: true }
    ).lean()

    res.json({
      hasResume:      true,
      resumeText:     user.resumeText,
      resumeFileName: user.resumeFileName,
      updatedAt:      user.updatedAt,
    })
  } catch (error) {
    console.error('Save resume error:', error)
    res.status(500).json({ error: 'Failed to save your resume. Please try again.' })
  }
})

// ── Shared keyword extraction. Both routes use this, so they cannot disagree.
// Previously each route asked Claude independently and got different lists —
// the modal showed 45, the backend recomputed 60, same resume.
async function extractKeywords(resumeText, jobText) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    temperature: 0,   // deterministic: same resume + same job = same skills, every time
    messages: [{
      role: 'user',
      content: `You are an ATS specialist.

Read the job description and identify the specific skills, technologies, tools, and qualifications it screens for. Use the exact wording the posting uses (e.g. "PySpark", not "Spark"). Pick the 6-10 most important.

Ignore generic filler. An ATS does not screen on "strong attention to detail", "good communication skills", "strong organizational skills", "team player", or "ability to work independently". Skip all of it. Only list concrete, checkable things: named technologies, named tools, named platforms, specific technical practices.

Then check the resume against that list.

Resume:
${resumeText}

Job Description:
${jobText}

Respond in this exact JSON format with no extra text:
{
  "matchedKeywords": [<the ones already present in the resume>],
  "missingKeywords": [<the ones that are not>]
}`
    }]
  })
  const cleaned = message.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  return {
    matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords : [],
    missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [],
  }
}

// ── ANALYZE — what this job screens for, and what the resume already has.
// No rewrite, so it is fast. The modal shows gaps in ~2s.
app.post('/analyze', async (req, res) => {
  const { resumeText, jobText } = req.body
  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }
  try {
    const { matchedKeywords, missingKeywords } = await extractKeywords(resumeText, jobText)
    const total = matchedKeywords.length + missingKeywords.length
    res.json({
      matchedKeywords,
      missingKeywords,
      scoreBefore: total ? Math.round((matchedKeywords.length / total) * 100) : 0,
    })
  } catch (error) {
    console.error('Analyze error:', error)
    if (error.status === 401) return res.status(401).json({ error: 'Invalid API key.' })
    if (error.status === 402) return res.status(402).json({ error: 'No API credits remaining.' })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ── OPTIMIZE — rewrite around the skills the student confirmed.
// Takes the keyword lists from /analyze. Does NOT re-extract them.
// ── OPTIMIZE CODE GATE ─────────────────────────────────────────────
// Prompt rules are suggestions the model ignores intermittently (an em-dash
// leaked in 1 of 3 runs, and a fabricated bullet slipped through). So after the
// model answers, we check the output in code and, on a real violation, send it
// back naming the exact problem. Retry at most twice.

const GATE_STOPWORDS = new Set('a an and the to of in for with on at by from into as is are was were be been being this that these those it he she they them his her our your my we you i using use used across within over under after before between during through per via or nor not no so than then also both each any all more most other some such only own same up out off down'.split(' ').filter(Boolean))

// Em-dash, en-dash, or double hyphen anywhere in the resume body. A correct
// certification line uses a plain hyphen "-", which is NOT one of these.
function findBannedDashes(text) {
  const hits = []
  for (const line of String(text).split('\n')) {
    if (/[\u2014\u2013]|--/.test(line)) hits.push(line.trim())
  }
  return hits
}

// The "- " bullets that live under the EXPERIENCE section only.
function experienceBullets(resume) {
  const bullets = []
  let inExp = false
  for (const raw of String(resume).split('\n')) {
    const line = raw.trim()
    const isHeader = /^[A-Z][A-Z &/]{2,30}$/.test(line) && line.split(' ').length <= 4
    if (isHeader) { inExp = /EXPERIENCE/.test(line); continue }
    if (inExp && /^-\s+/.test(line)) bullets.push(line.replace(/^-\s+/, ''))
  }
  return bullets
}

// Content words: lowercase, drop short words, stopwords, and any word that is
// part of a confirmed skill (a woven-in confirmed skill is EXPECTED to be new,
// so counting it as fabrication would be a false positive).
function gateContentWords(str, skills) {
  const skillWords = new Set(
    skills.flatMap(s => String(s).toLowerCase().split(/[^a-z0-9+#]+/)).filter(Boolean)
  )
  return String(str).toLowerCase().split(/[^a-z0-9+#]+/)
    .filter(w => w.length > 2 && !GATE_STOPWORDS.has(w) && !skillWords.has(w))
}

// A bullet is flagged as invented when almost none of its real work-words appear
// anywhere in the original resume. Comparing against the WHOLE original (not one
// source bullet) lets reworded and merged bullets pass; only work that simply is
// not in the resume gets flagged. The threshold is deliberately low to avoid
// false positives on honest rewrites.
function inventedBullets(optimized, original, skills) {
  const origWords = new Set(gateContentWords(original, skills))
  const flagged = []
  for (const b of experienceBullets(optimized)) {
    const words = gateContentWords(b, skills)
    if (words.length < 4) continue
    const overlap = words.filter(w => origWords.has(w)).length / words.length
    if (overlap < 0.40) flagged.push(b)
  }
  return flagged
}

app.post('/optimize', async (req, res) => {
  const { resumeText, jobText, confirmedSkills = [] } = req.body
  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }

  try {
    // Use the lists the modal already has. Only extract if the caller didn't send
    // them (the standalone Resume Tool doesn't run /analyze first).
    let matchedKeywords = Array.isArray(req.body.matchedKeywords) ? req.body.matchedKeywords : null
    let missingKeywords = Array.isArray(req.body.missingKeywords) ? req.body.missingKeywords : null
    if (!matchedKeywords || !missingKeywords) {
      const found = await extractKeywords(resumeText, jobText)
      matchedKeywords = found.matchedKeywords
      missingKeywords = found.missingKeywords
    }

    const confirmed = (Array.isArray(confirmedSkills) ? confirmedSkills : [])
      .filter(k => missingKeywords.includes(k))

    const confirmedBlock = confirmed.length
      ? `THE CANDIDATE HAS CONFIRMED THEY HAVE USED THESE SKILLS: ${confirmed.join(', ')}

They told us this directly. Treat it as fact.`
      : `The candidate has not confirmed any additional skills. Do not add any skill that does not already appear somewhere in their resume.`

    const basePrompt = `You are an expert resume editor and ATS specialist. Rewrite the resume below so it is targeted at this specific job.

${confirmedBlock}

═══ RULE 1 — EVERY CONFIRMED SKILL MUST APPEAR, HONESTLY ═══
Every confirmed skill must end up in the resume. There is an order of preference for how:
(a) Attach it to an EXISTING bullet, but only when the work that bullet already describes genuinely involved this skill. You are naming a tool inside work they already did, not writing new work. This is the best outcome.
(b) Otherwise, list it in the skills section as a plain category-line entry. This is honest and expected. A skills-list entry claims "I know this tool", nothing more, and that is a true, defensible claim.
   - Fine: their resume says "Built ETL pipelines in Python", they confirmed Databricks, and those pipelines actually ran in Databricks, so it becomes "Built ETL pipelines in Python, running in Databricks." The work was already there; you only added the tool.
   - Not fine: writing a brand-new bullet such as "Built a customer-facing recommendation system using LLM scoring and retrieval-augmented generation." If that accomplishment is not already on their resume, it is invented, and it ends their interview the moment someone asks. That skill goes in the skills list instead.
NEVER write a NEW experience bullet to make a confirmed skill appear. If a skill has no existing bullet whose real work involved it, it goes in the skills section. Full stop. There is no third option and no exception.
THE TEST FOR ANY EXPERIENCE BULLET: the accomplishment, the employer, the system, the scale, and the outcome must ALREADY be on their original resume. The tool may come from their checkbox, but the work may not. If the accomplishment is not already there, you are inventing it. Do not.
A skills-list entry is NOT dodging. If the posting is built around a skill the person only has in the skills list, that is the honest signal that their experience does not yet cover this job's core, and the feedback must say so plainly. It is not your job to hide a missing qualification behind an invented bullet; the truth serves the person, a fabrication ends their interview.

═══ RULE 2 — ATTACH, DO NOT AUTHOR ═══
A confirmed skill rides on a bullet about work the candidate actually described. It does not get its own bullet written from the job posting.
- Right: their bullet says "Wrote SQL to transform claims data for the reporting layer" and they confirmed dbt, so it becomes "Wrote SQL and dbt models to transform claims data for the reporting layer." Their work, their words, keyword carried.
- Wrong: "Owned dbt project structure, macros, testing, and CI/CD deployment." That is the posting's duty list pasted onto their life. They confirmed a tool. They never confirmed macros, or CI/CD, or owning the project structure.
Most skills need no new bullet at all: they attach to existing work, or they go to the skills list. You never write a new experience bullet for a skill. If a confirmed skill has nowhere real to attach, it goes to the skills section, never into an invented bullet.

═══ RULE 3 — NEVER COPY THE POSTING'S SENTENCES ═══
Use the posting's TERM for a thing they did. Never lift its phrasing.
- Their term, fine: the posting says "ELT pipelines", they built pipelines, so call them ELT pipelines.
- Lifted, not fine: the posting says "SQL transformations and Python scripts and automation to process and prepare data" and the resume says "SQL transformations and Python scripts to prepare and clean data."
HARD LINE: no four consecutive words from the job description may appear in the resume. A recruiter reading their own posting back at them knows exactly what happened, and it is the opposite of standing out.

═══ RULE 4 — SELECT AND MERGE, DO NOT ACCUMULATE ═══
Keep each role to roughly 4-6 bullets. This is not a target to hit — four strong bullets beat six padded ones. It is a ceiling to prevent ballooning.
If adding skills has pushed a role to 8 or 9 bullets, do two things: rank by relevance to THIS posting and cut the weakest, and merge related bullets into one. Two thin bullets about the same work become one stronger bullet.
Bullets containing real results outrank keyword-carrying bullets. "Reduced pipeline runtime from 4 hours to 90 minutes by rewriting the join logic" survives every cut and never gets merged away. It is the most persuasive line on the page precisely because nobody invents "90 minutes".

LENGTH DISCIPLINE (keeps the resume tight, ideally two pages):
- Each bullet is ONE to TWO lines. If a bullet runs to three lines, it is doing too much — split the real result into its own bullet or trim the setup words. No bullet is a paragraph.
- The SUMMARY is 2-3 sentences. Not a paragraph. Not five sentences. It states who they are, their strongest relevant skills, and nothing else.
- PROJECT descriptions are 1-2 sentences each. A project is not a second job history; it is a short proof point.
- Cut filler openers: "Responsible for", "Worked on", "Tasked with", "Helped to". Start bullets with the verb.
- For older or less relevant roles, fewer bullets (2-3) is correct. Weight the bullets toward the most recent and most relevant experience.
The goal is a dense, scannable resume. A recruiter spends seconds per resume; every padded line is a line they skim past.

═══ RULE 5 — DO NOT INVENT THE WORK ═══
They confirmed a tool. They did not confirm what role it played, at what scale, or with what result.
- Not fine: "with Azure SQL Server as a secondary target for reporting queries." They never said secondary, or reporting.
- Not fine: "processing 5TB daily across 200-node clusters." Numbers they have never seen and cannot defend in an interview.
Never invent metrics, data volumes, team sizes, or achievements.

═══ RULE 6 — DO NOT UPGRADE RESPONSIBILITY, ANYWHERE ═══
"Set up" does not become "owned". "Helped with" does not become "led". "Contributed to" does not become "drove".
This applies to the professional summary exactly as much as to bullets. A summary claiming they are "comfortable owning pipelines end to end" while the bullet says "set up" is the same inflation, just relocated.

═══ RULE 7 — A CONFIRMED SKILL MUST NEVER SILENTLY DISAPPEAR ═══
If a confirmed skill has no obvious home, do not drop it silently, but the fallback is the skills list, and that is a legitimate home even for a skill central to the posting. A skills-list mention of a central requirement is not dodging; it is the honest truth that their experience does not yet cover it, which the feedback must state plainly.
Reframe an existing bullet to carry it, joining only facts the candidate has given you.
- Fine: they wrote "Built ETL pipelines in Python" and confirmed Databricks, so it becomes "Built ETL pipelines in Python, running in Databricks." Both halves came from them: they built the pipelines, they have used Databricks.
- Fine: they wrote "Set up Airflow DAGs to schedule the nightly loads" and confirmed data-quality tests, so it becomes "Set up Airflow DAGs to schedule the nightly loads, with data-quality tests to catch bad data before it reached analysts."
- Not fine: "with Azure SQL Server as a secondary target for reporting queries." The tool came from their checkbox, but "secondary target for reporting" came from nowhere.
The test: every part of the sentence must trace back to something they told you. The tool came from their checkbox. The work came from their resume. Nothing else gets added.
ORDER OF PREFERENCE: (a) reframe an existing bullet, (b) failing that, place it under a category header in the skills section, (c) never drop it silently. If a skill ends up in the skills section only, say so plainly in the feedback.

═══ RULE 8 — SKILLS: INLINE CATEGORIES, ONE LINE EACH, 5-6 MAX ═══
Format the skills section as category lines. Each category is ONE line: the label, a colon, then the skills. Like this, exactly:

Languages: Python, SQL, Java, Scala
Data platforms: Databricks, Spark, Snowflake, BigQuery, Azure Synapse
Cloud and DevOps: Azure, AWS, GCP, Terraform, Docker, Kubernetes, CI/CD
Orchestration and streaming: Airflow, Kafka, Structured Streaming
BI and reporting: Power BI, Tableau

HARD RULES for this section, they matter for layout:
- Each category is a SINGLE line. Never put the label on one line and the skills on the next line. Label, colon, skills, all on one line.
- MAXIMUM 5-6 categories. Not nine. Merge related ones: languages together, all cloud/devops together, all orchestration/streaming together. A resume with nine skill categories looks bloated and runs onto extra pages.
- Put the most job-relevant category first.
- Do not write the category labels in ALL CAPS. Write them like "Data platforms", not "DATA PLATFORMS".
A flat comma dump has no shape and a recruiter's eye slides past it. But nine stacked headers is the opposite problem: it wastes half a page. Five tight inline lines is the target.

═══ RULE 9 — VOICE. THIS IS HALF THE JOB ═══
It must read like the candidate wrote it. Recruiters screen hundreds of resumes and AI-written ones are obvious on sight.
- FIX WHAT ALREADY READS AS AI. Many candidates ran their resume through ChatGPT before coming here, so the input may already be full of AI tells. Rewrite those into plain, human phrasing. This applies to their existing bullets, not just the ones you touch.
- Keep their real voice: their words, phrasing, and sentence rhythm.
- Never inflate. Keep plain verbs. "Wrote scripts to clean data" does not become "spearheaded data integrity initiatives".
- Banned vocabulary: spearheaded, leveraged, synergy, robust, seamless, cutting-edge, innovative, passionate, dynamic, results-driven, proven track record, wide array, myriad, delve, tapestry, "not only X but also Y", "responsible for driving", "utilized".
- Banned punctuation: em-dashes, en-dashes, and double hyphens. Use commas, full stops, or semicolons. There is ONE exception: the official name of a certification or credential. These names often contain a dash, for example "AWS Certified Data Engineer - Associate" or "Databricks Certified Data Engineer - Professional". Keep that dash as a plain hyphen with a space on each side. Never replace it with a comma, because "Data Engineer, Associate, Amazon Web Services" reads as three separate things instead of one credential.
- Never address the reader. No "you", "your", "we". A resume is not a sales page.
- Bullets must vary in length and shape. Real resumes are uneven. Uniform ones read as generated.
- Keep verb tense consistent within each role. A current role (its dates end in "Present") uses present tense throughout its ongoing work: do not mix "Design and deploy" with "Built" and "Optimized" in the same role. Past roles use past tense throughout. Flipping tense inside one role is the clearest sign the resume was never proofread.
- Keep every number exactly as written. Never round, never invent.
- Fix clear grammatical errors, but do not homogenize their voice into generic corporate English. Many of these candidates are non-native English speakers. Their phrasing is theirs, and it is part of why the resume reads as real.

═══ RULE 10 — STRUCTURE THE OUTPUT CONSISTENTLY (a downstream parser reads this) ═══
The rewritten resume is parsed by formatting code. Follow this structure exactly so it renders correctly every time:
- Section headers on their own line, in ALL CAPS, short: SUMMARY, SKILLS, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS. Nothing else on that line. No punctuation.
- Keep sections in this order: SUMMARY, then SKILLS, then EXPERIENCE, then PROJECTS, then EDUCATION, then CERTIFICATIONS. Put SKILLS near the top, not at the bottom.
- A job title goes on its own line in Title Case (e.g. "Senior Azure Data Engineer"). Do NOT put it in ALL CAPS — ALL CAPS is only for section headers.
- The line under a job title is the company, location, and dates joined with " | ", exactly: "Company Name | City, ST | Jan 2024 - Present".
- Bullets start with "- " (a hyphen and a space). One bullet per line.
- Skills use the inline category format from Rule 8: "Label: skill, skill, skill" — one category per line.
- Do not use markdown (no ##, no **bold**, no backticks). Plain text only.

Resume:
${resumeText}

Job Description:
${jobText}

Respond in this exact JSON format with no extra text:
{
  "feedback": "<2-3 sentences: what you added, where, and what still isn't covered>",
  "optimizedResume": "<the full rewritten resume>"
}`

    // ── CODE GATE: verify the draft, and on a real violation send it back
    // naming the exact problem. Retry at most twice, then ship the best effort.
    const messages = [{ role: 'user', content: basePrompt }]
    let parsed, out, gateNote = ''
    for (let attempt = 0; attempt <= 2; attempt++) {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        temperature: 0.3,
        messages,
      })
      const cleaned = message.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
      out = parsed.optimizedResume || ''

      const invented = inventedBullets(out, resumeText, confirmed)
      const dashes = findBannedDashes(out)
      if (!invented.length && !dashes.length) break
      if (attempt === 2) {
        if (invented.length) gateNote = ' (Please review the experience section: one or more bullets may describe work not in your original resume.)'
        console.warn('optimize gate unresolved after retries: invented=' + invented.length + ' dashes=' + dashes.length)
        break
      }
      console.warn('optimize gate retry ' + (attempt + 1) + ': invented=' + invented.length + ' dashes=' + dashes.length)
      let corrections = 'Your draft breaks the rules below. Fix ONLY these problems and return the same JSON format.\n'
      if (invented.length) {
        corrections += '\nINVENTED EXPERIENCE. These bullets describe work that is NOT in the original resume, which is fabrication and is forbidden:\n' + invented.map(b => '  - "' + b + '"').join('\n') + '\nDelete each one. If a bullet exists only to carry a confirmed skill, remove the bullet and place that skill in the skills section instead. Do not write a replacement bullet.\n'
      }
      if (dashes.length) {
        corrections += '\nBANNED DASHES (em-dash, en-dash, or --) on these lines:\n' + dashes.map(l => '  - "' + l + '"').join('\n') + '\nReplace each with a comma, a full stop, or a plain hyphen. Keep a plain hyphen only inside a certification name.\n'
      }
      messages.push({ role: 'assistant', content: message.content[0].text })
      messages.push({ role: 'user', content: corrections })
    }

    // Only count a skill if it actually made it into the text. The score should be
    // checkable against the document, not a promise that the rewrite worked.
    const landed = confirmed.filter(k => out.toLowerCase().includes(k.toLowerCase()))

    const total = matchedKeywords.length + missingKeywords.length
    const scoreBefore = total ? Math.round((matchedKeywords.length / total) * 100) : 0
    const scoreAfter = total ? Math.round(((matchedKeywords.length + landed.length) / total) * 100) : 0

    res.json({
      matchedKeywords,
      missingKeywords,
      addedKeywords: landed,
      feedback: (parsed.feedback || '') + gateNote,
      optimizedResume: out,
      scoreBefore,
      scoreAfter,
      score: scoreBefore,   // keeps the existing Resume Tool working
    })
  } catch (error) {
    console.error('AI API error:', error)
    if (error.status === 401) return res.status(401).json({ error: 'Invalid API key.' })
    if (error.status === 402) return res.status(402).json({ error: 'No API credits remaining.' })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ── JOB DETAIL — Fetch full description from Greenhouse
// ── LIST jobs (search + filters + pagination)
// The board calls this with: page, query, workType, experienceLevel, time_posted, state.
// It expects back { jobs, total, pages }. Page size is decided here, not by the client.
app.get('/jobs', async (req, res) => {
  try {
    const PAGE_SIZE = 20
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)

    const filter = {}

    // Search box: partial, case-insensitive match on title OR company.
    // Escaped so a query like "c++" or "node.js" can't break the regex.
    const q = (req.query.query || '').trim()
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = new RegExp(safe, 'i')
      filter.$or = [{ title: rx }, { company: rx }]
    }

    // Straight pass-through filters — the dropdown values match what fetchJobs stored.
    if (req.query.workType)        filter.workType = req.query.workType
    if (req.query.experienceLevel) filter.experienceLevel = req.query.experienceLevel
    if (req.query.state)           filter.state = req.query.state

    // Time posted: a rolling window on postedAt. Jobs with no postedAt are excluded
    // from a time filter, which is the right call — an undated job isn't "from this week".
    const windows = { today: 1, '3days': 3, week: 7, month: 30 }
    const days = windows[req.query.time_posted]
    if (days) {
      filter.postedAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    }

    const total = await Job.countDocuments(filter)
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    // The list cards never read `description` (only the detail view fetches it), and
    // descriptions are large HTML blobs, so drop it here to keep the payload light.
    const jobs = await Job.find(filter)
      .select('-description')
      .sort({ postedAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean()

    res.json({ jobs, total, pages })

  } catch (error) {
    console.error('Job list error:', error)
    res.status(500).json({ error: 'Failed to load jobs. Please try again.' })
  }
})

app.get('/jobs/:id', async (req, res) => {
  const { id } = req.params

  try {
    const job = await Job.findOne({ id }).lean()
    if (!job) return res.status(404).json({ error: 'Job not found.' })

    let fullDescription = job.description || ''
    if (job.ats === 'greenhouse' && job.companySlug) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${job.companySlug}/jobs/${id}?questions=false`
        const ghRes = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (ghRes.ok) {
          const data = await ghRes.json()
          fullDescription = data.content ? decodeHtmlEntities(data.content) : fullDescription
        }
      } catch {
        // Fall back to stored description
      }
    }

    res.json({ ...job, description: fullDescription })

  } catch (error) {
    console.error('Job detail error:', error)
    res.status(500).json({ error: 'Failed to fetch job details. Please try again.' })
  }
})

// ── PARSE resume text
function parseResume(text) {
  const lines = text.split('\n').map(l => l.trim())

  // Known section names — the common ones. We also fall back to a structural check
  // below, so a header the AI phrases slightly differently ("PROFESSIONAL SUMMARY",
  // "SKILLS & TOOLS") still renders as a section instead of going flat.
  const KNOWN = new Set([
    'SUMMARY', 'PROFESSIONAL SUMMARY', 'SKILLS', 'TECHNICAL SKILLS', 'SKILLS & TOOLS',
    'EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'WORK EXPERIENCE', 'EDUCATION',
    'CERTIFICATIONS', 'CERTIFICATIONS & LICENSES', 'PROJECTS', 'KEY PROJECTS',
    'ACHIEVEMENTS', 'AWARDS', 'LANGUAGES', 'INTERESTS', 'OBJECTIVE',
    'TECHNICAL PROFICIENCY', 'NOTABLE PROJECTS', 'STRATEGIC PROJECTS',
    'CORE COMPETENCIES', 'AREAS OF EXPERTISE', 'PUBLICATIONS', 'VOLUNTEER EXPERIENCE',
  ])

  const isBullet   = l => l.startsWith('•') || l.startsWith('-') || l.startsWith('–')
  const isRoleLine = l => l.includes(' | ') && (l.includes('Present') || /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(l) || /\b(19|20)\d{2}\b/.test(l))

  const isSkillLine = l => {
    // Label can contain letters, spaces, & / + and hyphens ("Streaming and real-time analytics").
    const m = l.match(/^([A-Za-z][A-Za-z /&+-]{1,48}):\s+(.+)$/)
    if (!m) return null
    if (l.includes(' | ')) return null
    if (/https?:|www\.|@/.test(l)) return null
    const label = m[1].trim()
    if (label.split(/\s+/).length > 6) return null   // a category label is short-ish
    // guard: the value part should look like a list of skills, not a sentence.
    // if the "label" is really the start of a sentence, the value often ends with a period
    // and contains many words — but skill lists rarely do. keep it permissive though.
    return { label, values: m[2].trim() }
  }

  // A line is a section header if it's a known name, OR it looks structurally like one:
  // short, no sentence-ending punctuation, not a bullet/role/skill line, and either
  // ALL CAPS or a short Title Case heading of 1-4 words.
  const isSection = l => {
    if (!l) return false
    const upper = l.toUpperCase()
    if (KNOWN.has(upper)) return true
    if (isBullet(l) || isRoleLine(l) || isSkillLine(l)) return false
    if (l.length > 32) return false                 // headers are short
    if (/[.,;:]/.test(l)) return false              // headers have no sentence punctuation
    if (l.includes('|')) return false               // that's a role/contact line
    const words = l.split(/\s+/)
    if (words.length > 4) return false              // headers are 1-4 words
    // ALL CAPS line (allowing & and spaces) is almost always a header
    if (l === upper && /[A-Z]/.test(l)) return true
    return false
  }

  // Line 0 is always the name. The following lines are title/contact until the first
  // real section header. We skip line 0 when hunting for the section break, so an
  // ALL-CAPS name like "ARAVIND MANTRI" can't be mistaken for a section.
  let bodyStart = lines.length
  for (let i = 1; i < lines.length; i++) {
    if (isSection(lines[i])) { bodyStart = i; break }
  }
  const header = []
  for (let i = 0; i < bodyStart; i++) {
    if (lines[i]) header.push(lines[i])
  }

  // A job TITLE is a line immediately followed by a role line (company | dates).
  // e.g.  "Senior Azure Data Engineer"   <- title (this line)
  //       "New York Life | NY | 2024 -"  <- role line (next line)
  // These should render bold/prominent — more than the company. We detect them by
  // look-ahead here and expose the set, since a single-line test can't see the next line.
  const body = lines.slice(bodyStart)
  const titleLines = new Set()
  for (let i = 0; i < body.length - 1; i++) {
    const cur = body[i]
    const nxt = body[i + 1]
    if (!cur) continue
    if (isSection(cur) || isBullet(cur) || isRoleLine(cur) || isSkillLine(cur)) continue
    if (isRoleLine(nxt)) titleLines.add(cur)   // a plain line sitting right above a company/date line
  }
  const isTitleLine = l => titleLines.has(l)

  return { header, bodyLines: body, isSection, isBullet, isRoleLine, isSkillLine, isTitleLine }
}

// One accent color for everyone. The user picks a FONT, not a fake company theme.
const ACCENT_HEX = '2563EB'   // Word (docx) wants hex without the #
const ACCENT_CSS = '#2563EB'  // PDF (HTML) wants the #

// Web-safe fonts only — these render identically on the PDF server AND on whatever
// machine opens the Word file. Trendy fonts (Inter, Roboto) would silently fall back.
const FONT_STACKS = {
  calibri: { word: 'Calibri',          css: "Calibri, 'Segoe UI', sans-serif" },
  arial:   { word: 'Arial',            css: 'Arial, Helvetica, sans-serif' },
  georgia: { word: 'Georgia',          css: 'Georgia, serif' },
  times:   { word: 'Times New Roman',  css: "'Times New Roman', Times, serif" },
}
function fontFor(id) { return FONT_STACKS[id] || FONT_STACKS.calibri }

// ── DOWNLOAD WORD
app.post('/download-word', async (req, res) => {
  const { resumeText, font, length } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  try {
    const { header, bodyLines, isSection, isBullet, isRoleLine, isSkillLine, isTitleLine } = parseResume(resumeText)
    const FONT      = fontFor(font).word
    const isCompact = length === 'concise'
    const children  = []

    const sp        = isCompact ? { before: 40, after: 30 } : { before: 60, after: 50 }
    const nameSize  = isCompact ? 44 : 52
    const titleSize = isCompact ? 22 : 26
    const bodySize  = isCompact ? 17 : 19
    const align     = AlignmentType.LEFT

    if (header[0]) {
      children.push(new Paragraph({
        alignment: align, spacing: { after: 40 },
        children: [new TextRun({ text: header[0], bold: true, size: nameSize, color: '111827', font: FONT })]
      }))
    }

    let contactStart = 1
    if (header[1] && !header[1].includes('|') && !header[1].includes('@')) {
      children.push(new Paragraph({
        alignment: align, spacing: { after: 30 },
        children: [new TextRun({ text: header[1], size: titleSize, color: ACCENT_HEX, font: FONT })]
      }))
      contactStart = 2
    }

    for (let i = contactStart; i < header.length; i++) {
      children.push(new Paragraph({
        alignment: align, spacing: { after: 20 },
        children: [new TextRun({ text: header[i], size: 18, color: '6B7280', font: FONT })]
      }))
    }

    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_HEX } },
      spacing: { before: 60, after: 120 }
    }))

    for (const line of bodyLines) {
      if (!line) { children.push(new Paragraph({ spacing: { after: 20 } })); continue }
      if (isSection(line)) {
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: ACCENT_HEX } },
          spacing: { before: sp.before + 60, after: 80 },
          children: [new TextRun({ text: line.toUpperCase(), bold: true, size: 22, color: ACCENT_HEX, font: FONT })]
        }))
        continue
      }
      if (isBullet(line)) {
        const clean = line.replace(/^[•\-–]\s*/, '').trim()
        children.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { after: sp.after - 20 },
          children: [new TextRun({ text: clean, size: bodySize, font: FONT, color: '1F2937' })]
        }))
        continue
      }
      if (isRoleLine(line)) {
        const parts = line.split(' | ')
        const company = parts[0]
        const rest = parts.length >= 2 ? parts.slice(1).join(' | ') : ''
        // Company medium weight + italic meta. The bold job TITLE renders above this.
        children.push(new Paragraph({
          spacing: { before: 20, after: 40 },
          children: rest
            ? [
                new TextRun({ text: company, size: bodySize - 1, color: '333333', font: FONT }),
                new TextRun({ text: `  |  ${rest}`, size: bodySize - 1, italics: true, color: ACCENT_HEX, font: FONT }),
              ]
            : [new TextRun({ text: line, bold: true, size: bodySize, color: ACCENT_HEX, font: FONT })]
        }))
        continue
      }
      const skill = isSkillLine(line)
      if (skill) {
        children.push(new Paragraph({
          spacing: { after: 30 },
          children: [
            new TextRun({ text: `${skill.label}: `, bold: true, size: bodySize, color: '111827', font: FONT }),
            new TextRun({ text: skill.values, size: bodySize, color: '1F2937', font: FONT }),
          ]
        }))
        continue
      }
      // A job TITLE (line above a company/date line) → bold, prominent, more than company.
      if (isTitleLine(line)) {
        children.push(new Paragraph({
          spacing: { before: sp.before, after: 20 },
          children: [new TextRun({ text: line, bold: true, size: bodySize + 3, color: '111827', font: FONT })]
        }))
        continue
      }
      children.push(new Paragraph({
        spacing: { after: sp.after },
        children: [new TextRun({ text: line, size: bodySize, font: FONT, color: '1F2937' })]
      }))
    }

    const doc = new Document({
      numbering: {
        config: [{
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 180 } } } }]
        }]
      },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children
      }]
    })

    const buffer = await Packer.toBuffer(doc)
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="optimized-resume.docx"',
      'Content-Length': buffer.length
    })
    res.send(buffer)

  } catch (error) {
    console.error('Word error:', error)
    res.status(500).json({ error: 'Failed to generate Word document. Please try again.' })
  }
})

// ── BUILD HTML for PDF
function buildResumeHTML(resumeText, font, length) {
  const cfg       = { accent: ACCENT_CSS, font: fontFor(font).css }
  const isCompact = length === 'concise'
  const fs        = isCompact ? '8.5pt' : '9.5pt'
  const lh        = isCompact ? '1.35'  : '1.5'
  const gap       = isCompact ? '5pt'   : '9pt'
  const sgap      = isCompact ? '7pt'   : '12pt'
  const pad       = isCompact ? '0.45in' : '0.55in'
  const align     = 'left'

  const { header, bodyLines, isSection, isBullet, isRoleLine, isSkillLine, isTitleLine } = parseResume(resumeText)

  let body = ''
  const name = header[0] || ''
  let titleLine = '', contactStart = 1
  if (header[1] && !header[1].includes('|') && !header[1].includes('@')) {
    titleLine = header[1]; contactStart = 2
  }

  body += `<div style="text-align:${align};padding-bottom:10pt;margin-bottom:14pt;border-bottom:2pt solid ${cfg.accent}">`
  body += `<div style="font-size:${isCompact ? '20pt' : '24pt'};font-weight:900;color:#111;letter-spacing:0.02em;text-transform:uppercase">${esc(name)}</div>`
  if (titleLine) body += `<div style="font-size:${isCompact ? '10pt' : '12pt'};font-weight:600;color:${cfg.accent};margin-top:4pt;letter-spacing:0.01em">${esc(titleLine)}</div>`
  for (let i = contactStart; i < header.length; i++) {
    body += `<div style="font-size:8pt;color:#555;margin-top:5pt">${esc(header[i])}</div>`
  }
  body += `</div>`

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]
    if (!line) { body += `<div style="height:${isCompact ? '3pt' : '5pt'}"></div>`; continue }

    if (isSection(line)) {
      body += `
        <div style="margin-top:${sgap};margin-bottom:5pt">
          <div style="font-size:9.5pt;font-weight:800;color:${cfg.accent};letter-spacing:0.08em;text-transform:uppercase;display:flex;align-items:center;gap:8pt">
            <span style="width:3pt;height:14pt;background:${cfg.accent};display:inline-block;border-radius:1pt;flex-shrink:0"></span>
            ${esc(line)}
          </div>
          <div style="height:1pt;background:${cfg.accent};opacity:0.25;margin-top:3pt"></div>
        </div>`
      continue
    }

    if (isBullet(line)) {
      const clean = line.replace(/^[•\-]\s*/, '')
      body += `<div style="display:flex;gap:6pt;font-size:${fs};line-height:${lh};margin-bottom:${isCompact ? '2pt' : '3.5pt'};color:#222"><span style="flex-shrink:0;margin-top:1pt;color:${cfg.accent};font-weight:700">•</span><span>${esc(clean)}</span></div>`
      continue
    }

    if (isRoleLine(line)) {
      const parts = line.split(' | ')
      if (parts.length >= 2) {
        const company = parts[0]
        const rest = parts.slice(1).join(' | ')
        // Company + dates on one line. The bold job TITLE renders above this (see
        // isTitleLine), so here the company is medium weight and the meta is italic —
        // the title leads, the company supports.
        body += `
          <div style="font-size:${isCompact ? '8.5pt' : '9pt'};color:#333;margin-bottom:2pt">
            <span style="font-weight:600;color:#222">${esc(company)}</span><span style="color:${cfg.accent};font-style:italic"> | ${esc(rest)}</span>
          </div>`
      } else {
        body += `<div style="font-size:${fs};font-weight:700;color:${cfg.accent};margin-top:${gap};margin-bottom:2pt">${esc(line)}</div>`
      }
      continue
    }

    // "Languages: Python, SQL" → bold label, inline skills, tight spacing
    const skill = isSkillLine(line)
    if (skill) {
      body += `<div style="font-size:${fs};line-height:${lh};color:#222;margin-bottom:${isCompact ? '1.5pt' : '2.5pt'}"><span style="font-weight:700;color:#111">${esc(skill.label)}:</span> ${esc(skill.values)}</div>`
      continue
    }

    // A job TITLE (line sitting right above a company/date line) → bold and prominent,
    // more weight than the company below it. This is the thing a recruiter scans for.
    if (isTitleLine(line)) {
      body += `<div style="font-size:${isCompact ? '10.5pt' : '11.5pt'};font-weight:800;color:#111;margin-top:${gap};margin-bottom:1pt">${esc(line)}</div>`
      continue
    }

    body += `<div style="font-size:${fs};line-height:${lh};color:#222;margin-bottom:2pt">${esc(line)}</div>`
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter; margin: ${pad}; }
  body { font-family: ${cfg.font}; color: #222; background: #fff; font-size: ${fs}; line-height: ${lh}; }
</style>
</head>
<body>${body}</body>
</html>`
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── DOWNLOAD PDF via PDFShift
app.post('/download-pdf', async (req, res) => {
  const { resumeText, font, length } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  try {
    const html = buildResumeHTML(resumeText, font || 'calibri', length || 'standard')

    const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`api:${process.env.PDFSHIFT_API_KEY}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: html,
        format: 'Letter',
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('PDFShift error:', err)
      return res.status(500).json({ error: 'Failed to generate PDF. Please try again.' })
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer())
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="optimized-resume.pdf"',
      'Content-Length': pdfBuffer.length
    })
    res.send(pdfBuffer)

  } catch (error) {
    console.error('PDF error:', error)
    res.status(500).json({ error: 'Failed to generate PDF. Please try again.' })
  }
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})