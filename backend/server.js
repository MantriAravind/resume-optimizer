import dns from 'dns'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { CATEGORIES, categorizeJob } from './jobCategory.mjs'
import multer from 'multer'
import { extractText, assessExtraction } from './resumeExtract.mjs'
import mongoose from 'mongoose'
import crypto from 'crypto'
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// One place where every model call goes through, so a model swap is an env change
// and not a code change. Returns the assistant's text directly — callers never
// touch the response shape.
//
// Three OpenAI quirks are handled here rather than at each call site:
//   1. `max_tokens` is deprecated; reasoning models want `max_completion_tokens`,
//      and that budget covers INVISIBLE REASONING TOKENS as well as the reply.
//      Too low a number returns an empty string with finish_reason 'length'.
//   2. `reasoning_effort` turns that thinking down. Extraction tasks do not need
//      it; the rewrite does.
//   3. Models differ on which optional params they accept at all (gpt-5-nano
//      refuses temperature: 0). Rather than hard-code who supports what, a
//      rejected param is dropped and the call retried, with a warning so you
//      can see it happening instead of guessing.
async function askModel({ model, maxTokens, temperature, reasoningEffort, messages }) {
  const params = { model, messages, max_completion_tokens: maxTokens }
  if (typeof temperature === 'number') params.temperature = temperature
  if (reasoningEffort) params.reasoning_effort = reasoningEffort

  const optional = ['temperature', 'reasoning_effort']
  let completion
  for (let tries = 0; ; tries++) {
    try {
      completion = await openai.chat.completions.create(params)
      break
    } catch (err) {
      const blamed = optional.find(p => p in params &&
        (err?.param === p || new RegExp(p, 'i').test(String(err?.message || ''))))
      if (!blamed || tries >= optional.length) throw err
      console.warn(`askModel: ${model} rejected ${blamed}=${params[blamed]}, retrying without it`)
      delete params[blamed]
    }
  }

  const text = completion?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    const reason = completion?.choices?.[0]?.finish_reason || 'unknown'
    throw new Error(`${model} returned no text (finish_reason: ${reason})`)
  }
  return text
}

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://resume-optimizer-delta-dusky.vercel.app',
    'https://optyply.com',
    'https://www.optyply.com',
  ]
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
  // Job field, written by the pipeline from the title via jobCategory.mjs.
  field:           String,
  needsLicense:    Boolean,
  fetchedAt:       Date,
  experienceLevel: String,
  workType:        String,
  state:           String,
  salaryMin:       Number,
  salaryMax:       Number,
  employmentType:  String,
  yearsMin:        Number,
  yearsMax:        Number,
  // Set when Greenhouse tells us the posting is gone (404). The 6-hour sweep deletes
  // these, but a job can close minutes after a refresh, so the first person to open it
  // flags it for everyone else in the meantime.
  closed:          { type: Boolean, default: false },
})

// ── INDEXES
// Without these, every board load scans all ~55K documents and sorts them in memory.
// Each index below matches a query the app actually runs; we do not add speculative
// ones, because every index costs write time on the 6-hour refresh and storage on a
// 512MB free tier.

// The backbone. Every list query filters on `closed` and sorts by `postedAt`, so this
// single index serves the default board with no filters applied.
jobSchema.index({ closed: 1, postedAt: -1 })

// One per dropdown. MongoDB can only use a compound index when the query matches its
// leading fields, so a filter on workType cannot ride the experienceLevel index. Three
// separate indexes is the honest cost of three independent filters.
jobSchema.index({ closed: 1, workType: 1, postedAt: -1 })
jobSchema.index({ closed: 1, experienceLevel: 1, postedAt: -1 })
jobSchema.index({ closed: 1, state: 1, postedAt: -1 })
// The field dropdown is the biggest single cut on the board — Tech alone takes
// 26,133 down to ~3,900 — so it earns an index of its own.
jobSchema.index({ closed: 1, field: 1, postedAt: -1 })
// Every board query now carries needsLicense, so it belongs in the compound index
// rather than forcing a scan on 26,000 documents.
jobSchema.index({ closed: 1, needsLicense: 1, postedAt: -1 })

// Used by the pipeline's stale sweep, which asks "which jobs from these companies did
// I not see this run?" over the whole collection. Unindexed, that is a full scan on
// every refresh.
jobSchema.index({ ats: 1, companySlug: 1, fetchedAt: 1 })

// ── ANALYZE CACHE
// extractKeywords is deterministic (temperature 0), so the same resume + same job
// always yields the same skills. Re-running it on a repeat click just burns an API
// call for an identical answer. We store results keyed by a hash of the two inputs.
//
// Why MongoDB and not an in-memory Map: the free Render instance sleeps and restarts
// constantly, which would wipe an in-memory cache on every cold start. The database
// survives restarts, so the cache actually pays off.
//
// The `expireAfterSeconds` TTL lets Mongo delete old entries on its own. 30 days is a
// balance: long enough that a user revisiting a job days later still hits cache, short
// enough that the collection cannot grow without bound on a 512MB tier.
const analyzeCacheSchema = new mongoose.Schema({
  key:       { type: String, unique: true },
  matched:   [String],
  missing:   [String],
  createdAt: { type: Date, default: Date.now, expires: '30d' },
})
const AnalyzeCache = mongoose.model('AnalyzeCache', analyzeCacheSchema)

// The key is a hash of both inputs, so any change to either produces a different key
// and a cache miss. A user editing their resume in Profile therefore does NOT get a
// stale result: the new resume text hashes differently and re-runs the model. This is
// the whole reason we hash the inputs rather than keying on something like a job id.
function analyzeCacheKey(resumeText, jobText) {
  return crypto.createHash('sha256').update(resumeText + '\u0000' + jobText).digest('hex')
}

// Removed, and why. Every index has to be rewritten on all ~55K upserts each refresh,
// so an index that serves no query is a pure tax on the pipeline and on storage:
//   { sponsorBadge: 1 }  the field is never queried, and is hardcoded false on every
//                        job, so the index has exactly one value in it
//   { isRemote: 1 }      never queried anywhere; workType covers this in the UI
//   { postedAt: -1 }     every list query also filters `closed`, so the compound
//                        index above already serves it
//   { state / workType / experienceLevel: 1 }  superseded by the compound versions,
//                        which also cover the sort instead of leaving it in memory
//   { title: 'text', company: 'text' }  search uses a case-insensitive regex, not
//                        $text, so this was built and maintained but never read


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

  // Read out of the resume by Haiku at upload time, not on every page load.
  // Every one of these may be empty — a resume states some and not others.
  //
  // Graduation date and visa status were here and were dropped. Nothing in the
  // product read either one: the board filters on `field`, the optimizer uses the
  // resume text. They were two boxes no resume can answer, sitting behind an
  // "incomplete profile" banner, collected for nothing. Add a field the day a
  // feature reads it — the extraction prompt takes one more key.
  profile: {
    firstName:      { type: String, default: '' },
    lastName:       { type: String, default: '' },
    // From the RESUME, not the Clerk account. A student often applies with a
    // different address to the one they signed up with, and the resume is what an
    // employer will see. Falls back to the account email when the resume has none.
    email:          { type: String, default: '' },
    field:          { type: String, default: '' },   // one of CATEGORIES
    targetRole:     { type: String, default: '' },
    degree:         { type: String, default: '' },
    major:          { type: String, default: '' },
    yearsExperience:{ type: String, default: '' },
    location:       { type: String, default: '' },
    phone:          { type: String, default: '' },
    linkedin:       { type: String, default: '' },
    github:         { type: String, default: '' },
    graduationDate: { type: String, default: '' },
  },
  updatedAt:      { type: Date, default: Date.now },
})

const User = mongoose.models.User || mongoose.model('User', userSchema)

// ── APPLICATIONS (Tracker)
//
// A row is written the moment the student opens an employer's posting from this app.
//
// Everything about the job is SNAPSHOTTED rather than referenced. The pipeline prunes
// postings on a 30-day window, so a stored jobId alone would mean applications quietly
// disappearing from the tracker weeks later — the one thing a tracker must never do.
// These few fields are cheap; a vanished application is not recoverable.
//
// resumeText, not a PDF. The download endpoints already rebuild a PDF and a Word file
// from text, so storing the text gives an identical download for a few kilobytes
// instead of a binary blob and a 16MB document ceiling.
const applicationSchema = new mongoose.Schema({
  clerkUserId: { type: String, index: true, required: true },
  jobId:       { type: String, required: true },

  // Snapshot — must survive the job being pruned.
  title:       String,
  company:     String,
  location:    String,   // the variant they actually picked on a grouped posting
  applyUrl:    String,

  // 'opened' is the truth: we saw them click through to the employer, nothing more.
  // Only the student can move it to 'applied', and only they know.
  status:      { type: String, enum: ['opened', 'applied'], default: 'opened' },

  // Null for a direct apply from the board. Kept as text; the PDF and Word endpoints
  // regenerate the file on demand.
  resumeText:  { type: String, default: null },
  optimized:   { type: Boolean, default: false },
  // Whether that resume existed AT THE MOMENT they clicked through to the employer.
  //
  // Someone can apply straight from the board and optimize the same job afterwards.
  // The optimized file is worth keeping — they did the work — but it is NOT what the
  // employer received, and a tracker whose promise is "the exact version you sent"
  // cannot quietly show it as though it were. False makes the row say so.
  resumeWasSent: { type: Boolean, default: false },
  scoreBefore: { type: Number, default: null },
  scoreAfter:  { type: Number, default: null },
  confirmedSkills: { type: [String], default: [] },

  appliedAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
})
// One row per job per user. A second apply to the same posting updates the row rather
// than creating a duplicate the student then has to tidy up.
applicationSchema.index({ clerkUserId: 1, jobId: 1 }, { unique: true })

const Application = mongoose.models.Application || mongoose.model('Application', applicationSchema)

// Direct applies are NOT recorded. Only an application made through the optimizer
// reaches the tracker.
//
// Tried the other way first. Recording every "Apply →" click meant rows with no resume
// attached, and worse, rows the product then had to describe: someone clicks Apply to
// READ a posting, comes back, optimizes, and applies properly — at which point any copy
// about "the employer received the earlier version" is simply false. The click proves
// they opened a page and nothing more, so every sentence built on it was a guess.
//
// With this off, every row carries the resume that was on screen when they clicked
// through. The cost is real: an application made straight from the board leaves no
// trace. Set back to true to record those again — nothing else needs changing.
const TRACK_DIRECT_APPLIES = false

// ── TRACKER: record an application
app.post('/applications', requireUser, async (req, res) => {
  try {
    const { jobId, title, company, location, applyUrl,
            resumeText, scoreBefore, scoreAfter, confirmedSkills,
            // Sent by the optimizer when a rewrite finishes for a job the student has
            // ALREADY applied to. Attaches the resume without claiming it was sent.
            attachOnly } = req.body || {}
    if (!jobId) return res.status(400).json({ error: 'jobId is required.' })

    const optimized = Boolean(resumeText)
    if (!optimized && !TRACK_DIRECT_APPLIES) {
      return res.json({ tracked: false, reason: 'direct applies are not recorded' })
    }
    // attachOnly never creates a row. Optimizing is not applying, and a tracker full of
    // jobs someone merely looked at would stop meaning anything.
    if (attachOnly && !(await Application.exists({ clerkUserId: req.userId, jobId }))) {
      return res.json({ tracked: false, reason: 'no application to attach to' })
    }

    // A repeat apply must not wipe a resume that is already attached: someone who
    // optimizes, applies, then later clicks the plain Apply link should keep the
    // version they actually sent.
    const existing = await Application.findOne({ clerkUserId: req.userId, jobId })
    const set = {
      clerkUserId: req.userId, jobId,
      title:    title    || existing?.title    || '',
      company:  company  || existing?.company  || '',
      location: location || existing?.location || '',
      applyUrl: applyUrl || existing?.applyUrl || '',
      updatedAt: new Date(),
    }
    if (optimized) {
      set.resumeText  = resumeText
      set.optimized   = true
      // Only an apply can mark a resume as sent, and a later attach must never
      // downgrade one that genuinely was.
      set.resumeWasSent = attachOnly ? Boolean(existing?.resumeWasSent) : true
      set.scoreBefore = Number.isFinite(scoreBefore) ? scoreBefore : null
      set.scoreAfter  = Number.isFinite(scoreAfter) ? scoreAfter : null
      set.confirmedSkills = Array.isArray(confirmedSkills) ? confirmedSkills : []
    }
    if (!existing) set.appliedAt = new Date()

    const doc = await Application.findOneAndUpdate(
      { clerkUserId: req.userId, jobId },
      { $set: set, $setOnInsert: { status: 'opened' } },
      { upsert: true, returnDocument: 'after' }
    )
    res.json({ tracked: true, application: doc })
  } catch (err) {
    console.error('POST /applications failed:', err)
    res.status(500).json({ error: 'Could not save this application.' })
  }
})

// ── TRACKER: list
app.get('/applications', requireUser, async (req, res) => {
  try {
    // resumeText is excluded — it is large and the list never renders it. The download
    // route fetches the single row it needs.
    const rows = await Application
      .find({ clerkUserId: req.userId })
      .select('-resumeText')
      .sort({ appliedAt: -1 })
      .lean()
    res.json({ applications: rows })
  } catch (err) {
    console.error('GET /applications failed:', err)
    res.status(500).json({ error: 'Could not load your applications.' })
  }
})

// ── TRACKER: the resume actually sent, for re-download
app.get('/applications/:id/resume', requireUser, async (req, res) => {
  try {
    const doc = await Application.findOne({ _id: req.params.id, clerkUserId: req.userId }).lean()
    if (!doc) return res.status(404).json({ error: 'Not found.' })
    if (!doc.resumeText) return res.status(404).json({ error: 'No optimized resume was saved for this application.' })
    res.json({ resumeText: doc.resumeText, title: doc.title, company: doc.company })
  } catch (err) {
    console.error('GET /applications/:id/resume failed:', err)
    res.status(500).json({ error: 'Could not load that resume.' })
  }
})

// ── TRACKER: mark applied / not applied
app.patch('/applications/:id', requireUser, async (req, res) => {
  try {
    const { status } = req.body || {}
    if (!['opened', 'applied'].includes(status)) {
      return res.status(400).json({ error: 'status must be "opened" or "applied".' })
    }
    const doc = await Application.findOneAndUpdate(
      { _id: req.params.id, clerkUserId: req.userId },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (!doc) return res.status(404).json({ error: 'Not found.' })
    res.json({ application: doc })
  } catch (err) {
    console.error('PATCH /applications failed:', err)
    res.status(500).json({ error: 'Could not update this application.' })
  }
})

// ── TRACKER: remove
app.delete('/applications/:id', requireUser, async (req, res) => {
  try {
    const r = await Application.deleteOne({ _id: req.params.id, clerkUserId: req.userId })
    if (!r.deletedCount) return res.status(404).json({ error: 'Not found.' })
    res.json({ deleted: true })
  } catch (err) {
    console.error('DELETE /applications failed:', err)
    res.status(500).json({ error: 'Could not remove this application.' })
  }
})

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
      // The board reads profile.field from here to decide which jobs to show, so
      // it must come back on the same call the resume gate already makes — a
      // second round trip would mean the board renders unfiltered first and then
      // visibly jumps.
      profile:        user?.profile        || {},
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
// Two models, on purpose.
// Extraction is a mechanical read-and-list task, so the cheap model is enough.
// The rewrite is the part that has to sound human and never fabricate, so it stays
// on the stronger model. Both /analyze and /optimize call extractKeywords, so they
// always agree and the score cannot drift between the two calls.
// Configurable so a model change is an env edit and a restart, not a deploy.
// Defaults match what is documented; override in .env / Render to A/B test.
const MODEL_EXTRACT  = process.env.OPENAI_ANALYSIS_MODEL     || 'gpt-5-nano'
const MODEL_REWRITE  = process.env.OPENAI_OPTIMIZATION_MODEL || 'gpt-5.6-luna'
const MODEL_FALLBACK = process.env.OPENAI_FALLBACK_MODEL     || 'gpt-5.6-terra'

async function extractKeywords(resumeText, jobText) {
  const cacheKey = analyzeCacheKey(resumeText, jobText)

  // Cache read is best-effort. If Mongo hiccups we must NOT fail the whole analyze,
  // so a lookup error just falls through to calling the model as normal.
  try {
    const hit = await AnalyzeCache.findOne({ key: cacheKey }).lean()
    if (hit) return { matchedKeywords: hit.matched, missingKeywords: hit.missing }
  } catch (e) {
    console.warn('analyze cache read failed:', e.message)
  }

  const replyText = await askModel({
    model: MODEL_EXTRACT,
    // Budget covers invisible reasoning tokens too. Sized generously on purpose:
    // if reasoning_effort is refused outright the model thinks at full effort, and
    // a starved budget returns an empty string rather than a short answer.
    maxTokens: 8000,
    // gpt-5-nano refuses temperature: 0, so the determinism this call used to have
    // is gone. 'minimal' keeps it as close to stable as we can get — this is
    // mechanical matching, not a task that benefits from thinking. ('none' is
    // refused by this model; minimal is its floor.)
    reasoningEffort: 'minimal',
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
  const cleaned = replyText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  const result = {
    matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords.filter(keepAsSkill) : [],
    // Certifications are removed before the checkbox list is ever built. The box says
    // "Tap if you have", and next to Kubernetes that means "I have used this" while
    // next to VMCE it means "I passed this exam" — a claim a recruiter verifies in one
    // search. The two are indistinguishable in a list of chips, and the person who
    // wrote this product's anti-fabrication rule still ticked VMCE and VMCSE by
    // mistake. A student will not do better. So the option is not offered.
    missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords.filter(keepAsSkill) : [],
  }

  // Store for next time. upsert so a race between two identical requests cannot throw
  // a duplicate-key error. Best-effort again: a write failure must not fail the call
  // the user is waiting on, it just means the next identical click pays for the model.
  try {
    await AnalyzeCache.updateOne(
      { key: cacheKey },
      { key: cacheKey, matched: result.matchedKeywords, missing: result.missingKeywords, createdAt: new Date() },
      { upsert: true }
    )
  } catch (e) {
    console.warn('analyze cache write failed:', e.message)
  }

  return result
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


// Certification names legitimately contain a dash (e.g. "AWS Certified Data
// Engineer - Associate"). The model sometimes writes them with an em/en-dash,
// which the dash gate would then flag, triggering a retry that GARBLES the name
// (e.g. turning it into a comma). So we fix cert dashes in CODE (deterministic)
// instead of trusting the model: inside the CERTIFICATIONS section, or on any line
// that clearly names a credential with a level, collapse em/en/-- to a plain " - ".
function normalizeCertDashes(text) {
  const CERT_WORD  = /\b(certified|certificate|certification|credential|aws|azure|gcp|google\s+cloud|databricks|comptia|cissp|pmp|scrum|snowflake|kubernetes|terraform|oracle|salesforce|tableau)\b/i
  const CERT_LEVEL = /\b(associate|professional|expert|specialty|foundational|practitioner|fundamentals|advanced|architect|master)\b/i
  let inCerts = false
  return String(text).split('\n').map(raw => {
    const line = raw.trim()
    const isHeader = /^[A-Z][A-Z &/]{2,40}$/.test(line) && line.split(' ').length <= 4
    if (isHeader) { inCerts = /CERTIF/.test(line); return raw }
    const hasDash  = /[\u2014\u2013]|--/.test(raw)
    const looksCert = hasDash && (inCerts || (CERT_WORD.test(raw) && CERT_LEVEL.test(raw)))
    return looksCert ? raw.replace(/\s*(?:[\u2014\u2013]|--)\s*/g, ' - ') : raw
  }).join('\n')
}

// Tense backstop: the prompt (Rule 9) already tells the model current-role bullets
// stay present tense, but it occasionally slips. Here we find bullets in the CURRENT
// role (its date line ends in "Present") that OPEN with a past-tense verb and bounce
// them back. Detection is deliberately generous (regular -ed + common irregulars); the
// retry note tells the model to leave anything that is actually an adjective or already
// present tense, so correct lines are never broken.
const PAST_IDENTICAL = new Set(['set','cut','put','read','cost','hit','let','bet','spread','split','shut','burst','forecast','broadcast'])
const IRREGULAR_PAST = new Set(['led','built','ran','drove','oversaw','wrote','made','chose','began','brought','bought','taught','sought','held','kept','left','met','sent','spent','won','stood','understood','grew','drew','flew','knew','threw','gave','took','saw','went','came','found','got','spoke','broke','rose','rebuilt','upheld','overcame','undertook'])
function bulletOpensPast(bulletText) {
  const first = String(bulletText).trim().replace(/^[•\-–]\s*/, '').split(/\s+/)[0] || ''
  const w = first.toLowerCase().replace(/[^a-z]/g, '')
  if (!w || PAST_IDENTICAL.has(w)) return false
  if (IRREGULAR_PAST.has(w)) return true
  return /ed$/.test(w)
}
function findCurrentRolePastTense(text) {
  const isRole   = l => /\s\|\s[^|]*\|\s/.test(l)
  const isBullet = l => /^\s*[•\-–]\s+/.test(l)
  const isHeader = l => { const t = l.trim(); return /^[A-Z][A-Z &/]{2,40}$/.test(t) && t.split(' ').length <= 4 }
  const hits = []
  let inExp = false, inCurrent = false
  for (const raw of String(text).split('\n')) {
    const t = raw.trim()
    if (isHeader(t)) { inExp = /EXPERIENCE/.test(t); inCurrent = false; continue }
    if (!inExp) continue
    if (isRole(t)) { inCurrent = /\bpresent\b/i.test(t); continue }
    if (inCurrent && isBullet(t) && bulletOpensPast(t)) hits.push(t)
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
// ── STRAY PROSE AFTER THE RESUME ───────────────────────────────────────────
//
// A real failure: the model appended a paragraph to the bottom of a finished resume —
// "Note: Grailed sits at the intersection of fashion, community, and commerce... I
// recently bought a pair of Needles track pants through a peer-to-peer sale on Depop."
// None of that was in the resume. It read the job description, invented a personal
// anecdote, and attached it to the candidate's CV.
//
// inventedBullets() did not catch it because that only inspects EXPERIENCE bullets, and
// this was loose text after CERTIFICATIONS. A resume ends at its last section; anything
// after it is not a resume.
const RESUME_SECTIONS = /^(SUMMARY|PROFESSIONAL SUMMARY|OBJECTIVE|SKILLS|TECHNICAL SKILLS|TECHNICAL PROFICIENCY|CORE COMPETENCIES|EXPERIENCE|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT|PROJECTS|KEY PROJECTS|NOTABLE PROJECTS|EDUCATION|CERTIFICATIONS|CERTIFICATIONS & LICENSES|LICENSES|PUBLICATIONS|AWARDS|VOLUNTEER EXPERIENCE|LANGUAGES|INTERESTS)\s*$/i

/**
 * Returns lines that appear after the last legitimate section and read as prose rather
 * than resume content.
 *
 * A bullet or a short entry after CERTIFICATIONS is fine — that is the section's own
 * content. What is not fine is a paragraph, especially one opening "Note:" or written
 * in the first person, which no resume contains.
 */
function strayProse(text) {
  const lines = String(text || '').split(/\r?\n/)
  let lastSection = -1
  lines.forEach((l, i) => { if (RESUME_SECTIONS.test(l.trim())) lastSection = i })
  if (lastSection === -1) return []

  const flagged = []
  for (const raw of lines.slice(lastSection + 1)) {
    const l = raw.trim()
    if (!l) continue
    if (/^[-•*]/.test(l)) continue                 // a bullet is section content
    if (l.length < 120) continue                   // short lines are entries, not prose
    // First person or a note label. A resume is written about the candidate, never by
    // them in conversation.
    if (/^note\s*:/i.test(l) || /\b(I|I'm|I've|my|me)\b/.test(l)) flagged.push(l)
  }
  return flagged
}

// ── YEARS OF EXPERIENCE, COMPUTED ──────────────────────────────────────────
//
// The model cannot do this. It was asked twice, in the prompt, with today's date
// supplied — and still wrote "4+ years" for a resume totalling 68 months. It has no
// reliable sense of what day it is, and an instruction buried in a list of rules is a
// suggestion. So the arithmetic happens here and the answer is handed over as a fact.
//
// Matches the date ranges resumes actually use:
//   Jan 2024 - Present     Jan 2024 – Present     01/2024 - Present
//   Nov 2022 - Dec 2023    Oct 2020 – Dec 2021
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }
const DATE_RANGE = new RegExp(
  '\\b(?:(' + Object.keys(MONTHS).join('|') + ')[a-z]*\\.?\\s+|(\\d{1,2})[\\/\\-])?' +  // start month
  '((?:19|20)\\d{2})' +                                                            // start year
  '\\s*[-–—]{1,2}\\s*' +                                                              // separator
  '(?:(present|current|now)|' +                                                   // or an end date
  '(?:(' + Object.keys(MONTHS).join('|') + ')[a-z]*\\.?\\s+|(\\d{1,2})[\\/\\-])?((?:19|20)\\d{2}))',
  'gi',
)

/**
 * Total months of work experience across every role in the resume.
 *
 * Sums each range separately rather than measuring first-start to today, because gaps
 * are real: this resume has a four-month gap in 2022, and counting straight through
 * would overstate by that much.
 *
 * Overlapping ranges are summed too. That overstates for someone holding two jobs at
 * once, which is rare on a student resume — and overstating slightly is a smaller
 * problem than the current bug, which understates by nearly two years.
 *
 * Returns null when nothing parses, and the caller then leaves the number out
 * entirely. A missing figure is better than a wrong one.
 */
function totalExperienceMonths(resumeText) {
  // Only the EXPERIENCE section. Education dates ("May 2024") and certification years
  // would otherwise be counted as jobs.
  const upper = String(resumeText || '')
  // Header wording varies more than you would think. "WORK EXPERIENCE:" with a
  // trailing colon silently failed to match and a 10-year candidate lost their
  // years line entirely, so the colon is optional and the synonyms are listed.
  const expStart = upper.search(/^\s*(?:PROFESSIONAL\s+|WORK\s+|RELEVANT\s+)?(?:EXPERIENCE|EMPLOYMENT(?:\s+HISTORY)?|CAREER\s+HISTORY)\s*:?\s*$/mi)
  // No EXPERIENCE section means no work history to count. Scanning the whole document
  // as a fallback read "BS | 2018 - 2022" as five years of employment — which is a
  // fresh graduate, exactly the person who must not have their experience overstated.
  if (expStart === -1) return null
  const after = upper.slice(expStart)
  // Same colon problem here: "EDUCATION:" not matching meant the section never
  // ended and education dates got counted as jobs.
  const expEnd = after.slice(1).search(/^\s*(?:[A-Z][A-Za-z]*\s+)?(PROJECTS|EDUCATION|CERTIFICATIONS?|SKILLS|AWARDS|PUBLICATIONS)\s*:?\s*$/mi)
  const section = expEnd === -1 ? after : after.slice(0, expEnd + 1)

  const now = new Date()
  let total = 0
  let found = 0

  DATE_RANGE.lastIndex = 0
  for (const m of section.matchAll(DATE_RANGE)) {
    const [, sMonName, sMonNum, sYear, present, eMonName, eMonNum, eYear] = m
    const startY = parseInt(sYear, 10)
    const startM = sMonName ? MONTHS[sMonName.toLowerCase().slice(0, 3)]
                 : sMonNum  ? parseInt(sMonNum, 10)
                 : 1
    let endY, endM
    if (present) {
      endY = now.getFullYear()
      endM = now.getMonth() + 1
    } else {
      endY = parseInt(eYear, 10)
      endM = eMonName ? MONTHS[eMonName.toLowerCase().slice(0, 3)]
           : eMonNum  ? parseInt(eMonNum, 10)
           : 12
    }
    // Inclusive of both endpoints: Jan–Dec is twelve months, not eleven.
    const months = (endY * 12 + endM) - (startY * 12 + startM) + 1
    if (months > 0 && months < 600) { total += months; found++ }
  }

  return found ? total : null
}

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

/**
 * Section headers present in a resume, uppercased and stripped of punctuation.
 *
 * A header is a short standalone line in caps. Deliberately loose about the
 * trailing colon and about wording ("WORK EXPERIENCE" vs "EXPERIENCE"), because
 * the point is to compare two documents to each other, not to validate a format.
 */
function sectionHeaders(text) {
  const lines = String(text || '').split('\n')
  const out = []
  // The name at the top is usually in caps too ("ARAVIND M"), and reporting it as an
  // invented section would burn a retry on every single request. The contact block is
  // never more than a few lines, so headers are only looked for after it.
  let seen = 0
  for (const raw of lines) {
    const line = raw.trim().replace(/[:：]\s*$/, '')
    if (!line) continue
    seen++
    if (seen <= 3) continue
    if (line.length > 40) continue
    if (!/^[A-Z][A-Z\s&/]*$/.test(line)) continue   // all caps, no lowercase
    if (line.split(/\s+/).length > 4) continue      // headers are short
    out.push(line.replace(/\s+/g, ' '))
  }
  return out
}

/**
 * Section headers the model added that were not in the original.
 *
 * This exists because the model invented an entire PROJECTS section — real-looking
 * header, plausible project names, a fabricated scale claim — on two separate runs
 * of the same resume. inventedBullets() could not see it: that only inspects
 * EXPERIENCE bullets, and strayProse() only fires on loose first-person prose after
 * the last section. A well-formed section with a proper header looked legitimate to
 * both of them.
 *
 * Comparing header sets is mechanical. There is no judgement for the model to argue
 * with: a section that was not in the input has no business being in the output.
 *
 * Synonyms are folded so a rename ("PROFESSIONAL SUMMARY" to "SUMMARY", "TECHNICAL
 * SKILLS" to "SKILLS") is not reported as an invention — that is a wording change,
 * not fabricated content, and flagging it would burn a retry on nothing.
 */
const SECTION_ALIASES = [
  [/^(PROFESSIONAL |EXECUTIVE |CAREER )?(SUMMARY|PROFILE|OBJECTIVE)$/, 'SUMMARY'],
  [/^(TECHNICAL |CORE |KEY )?(SKILLS|PROFICIENCY|COMPETENCIES|EXPERTISE)$/, 'SKILLS'],
  [/^(PROFESSIONAL |WORK |RELEVANT )?(EXPERIENCE|EMPLOYMENT|EMPLOYMENT HISTORY|CAREER HISTORY)$/, 'EXPERIENCE'],
  [/^(STRATEGIC |KEY |SELECTED |ACADEMIC )?PROJECTS?$/, 'PROJECTS'],
  [/^(EDUCATION|ACADEMIC BACKGROUND|EDUCATION TRAINING)$/, 'EDUCATION'],
  [/^(CERTIFICATIONS?|LICENSES?|CERTIFICATIONS LICENSES)$/, 'CERTIFICATIONS'],
]
function canonicalSection(h) {
  for (const [re, name] of SECTION_ALIASES) if (re.test(h)) return name
  return h
}
function inventedSections(optimized, original) {
  const had = new Set(sectionHeaders(original).map(canonicalSection))
  const now = sectionHeaders(optimized).map(canonicalSection)
  return [...new Set(now.filter(h => !had.has(h)))]
}

/**
 * True when the rewrite dropped a large share of the original's bullets.
 *
 * A five-page resume came back with 28 bullets collapsed into 6 under one employer.
 * That is not a rewrite, it is a summary, and the work that disappeared was the
 * candidate's real work. The threshold is deliberately generous: merging two related
 * bullets is legitimate editing, gutting three quarters of them is not.
 */
// Marker-agnostic on purpose. Word list formatting does not survive extraction — the
// uploaded resume arrives with no "-" or "•" at all — so counting markers reported
// zero bullets for the original and the gate never fired. What both documents DO
// have is one long content line per point, so those are what get counted.
function bulletCount(text) {
  return String(text || '').split('\n')
    .map(l => l.trim().replace(/^[-•*▪]\s*/, ''))
    .filter(l =>
      l.length >= 40 &&                    // long enough to be a real point
      !/^[A-Z][A-Z\s&/:]*$/.test(l) &&     // not a section header
      !/^Environment\s*:/i.test(l) &&      // tech-stack line, counted separately
      /\s/.test(l)
    ).length
}
function bulletsLost(optimized, original) {
  const before = bulletCount(original)
  const after = bulletCount(optimized)
  if (before < 8) return null            // short resumes: condensing is not the concern
  if (after >= before * 0.75) return null
  return { before, after }
}

/**
 * The SUMMARY paragraph, as sentences.
 *
 * A draft cut a three-sentence summary to two, deleting the sentence about the
 * candidate's real Vertex AI work to make room for tools lifted from the posting.
 * Sections and bullets were both intact, so neither structural gate saw it: a
 * summary is one paragraph INSIDE a section, not a section.
 */
function summarySentences(text) {
  const m = String(text || '').match(/^[ \t]*(?:PROFESSIONAL\s+|EXECUTIVE\s+|CAREER\s+)?(?:SUMMARY|PROFILE|OBJECTIVE)[ \t]*:?[ \t]*$/mi)
  if (!m) return null
  const after = String(text).slice(String(text).indexOf(m[0]) + m[0].length)
  const nextHdr = after.search(/^[ \t]*[A-Z][A-Z\s&/]{2,39}:?[ \t]*$/m)
  const body = (nextHdr === -1 ? after : after.slice(0, nextHdr)).trim()
  if (!body) return null
  return body.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 15)
}
/**
 * Summary sentence count that moved in EITHER direction.
 *
 * The first version of this only caught shrinking, because the observed failure was a
 * three-sentence summary cut to two. The fallback model then satisfied "do not drop a
 * sentence" by writing ten, and this gate passed it: seven invented sentences, none of
 * them traceable to the resume, including "Known for diagnosing production data issues,
 * communicating clearly under deadline" — a character claim, not experience.
 *
 * Guarding one direction of a two-directional constraint is not guarding it.
 */
function summaryDrifted(optimized, original) {
  const a = summarySentences(original)
  const b = summarySentences(optimized)
  if (!a || !b || a.length < 2) return null
  if (b.length === a.length) return null
  return { before: a.length, after: b.length, dir: b.length < a.length ? 'cut' : 'padded' }
}

/**
 * "Environment: GCP, BigQuery, ..." lines that the original had and the draft dropped.
 * These are the densest keyword lines in the whole document — an ATS reads every word
 * — and one draft deleted all five of them while the score went UP.
 */
function droppedEnvironmentLines(optimized, original) {
  const grab = t => String(t || '').split('\n')
    .map(l => l.trim()).filter(l => /^Environment\s*:/i.test(l))
  const had = grab(original)
  if (!had.length) return []
  const now = String(optimized || '').toLowerCase()
  return had.filter(l => !now.includes(l.slice(0, 40).toLowerCase()))
}

/**
 * Certification codes appearing outside a CERTIFICATIONS section.
 *
 * A draft put "VMCE, and VMCSE" in the summary under "Hands-on expertise with" —
 * two Veeam exam credentials the candidate does not hold, in the first line a
 * recruiter reads. Confirmed-skill handling treated them as tools, because nothing
 * in the pipeline knows a credential from a product.
 *
 * Matched by shape rather than by a fixed list, so a cert this code has never heard
 * of is still caught. A token already present in the original is never flagged.
 */
/**
 * False for anything that is a credential rather than a skill, so it never reaches
 * the "Tap if you have" checkbox list. Products stay (Veeam Data Platform is a tool
 * someone can genuinely have used); exam codes and anything containing "certified"
 * or "certification" go.
 */
function keepAsSkill(entry) {
  const s = String(entry || '').trim()
  if (!s) return false
  if (/\b(certified|certification|certificate|credential|licen[sc]e|associate|practitioner|specialty)\b/i.test(s)) return false
  // An exam code embedded in a longer name: "Azure Data Engineer Associate (DP-203)".
  if (/\b[A-Z]{2,4}-?\d{2,3}\b/.test(s)) return false
  // Well-known credentials that are plain words, not shapes.
  if (/^(PMP|CISSP|CISA|CISM|CCNA|CCNP|CCIE|CEH|CSM|CAPM|ITIL|PRINCE2|SAFE|OSCP|RHCE|RHCSA|MCSE|MCSA|VCP|VCAP|CKA|CKAD|CKS)$/i.test(s.replace(/[-\s]/g, ''))) return false
  const bare = s.toUpperCase().replace(/[-\s]/g, '')
  if (CERT_SAFE.has(bare)) return true
  // A single all-caps token that looks like an exam code and nothing else.
  if (!/\s/.test(s) && CERT_SHAPED.test(s) && s === s.toUpperCase()) { CERT_SHAPED.lastIndex = 0; return false }
  CERT_SHAPED.lastIndex = 0
  return true
}

const CERT_SHAPED = /\b(?:[A-Z]{2,3}CE|[A-Z]{4,6}|(?:AWS|AZ|GCP|MS|CCNA|CCNP|PMP|CISSP|CISA|CSM|SAA|DP|AI|DVA)[- ]?\d{2,3})\b/g
const CERT_SAFE = new Set(['SQL','ETL','ELT','API','APIS','REST','JSON','HTTP','HTTPS','AWS','GCP','SAAS','PAAS','IAAS','CI','CD','CICD','NOSQL','OLAP','OLTP','CRUD','SDLC','AGILE','SCRUM','JIRA','HDFS','YARN','SPARK','KAFKA','LINUX','UNIX','BASH','JAVA','HTML','GRPC','SOAP','RBAC','IAM','SSO','MFA','TLS','SSL','VPC','CDN','DNS','GPU','CPU','RAM','ML','AI','LLM','MLOPS','DEVOPS','DATAOPS','ITIL'])
function certsOutsideCertSection(optimized, original) {
  const origUpper = String(original || '').toUpperCase()
  // Only look before a CERTIFICATIONS header; inside one, codes are expected.
  const cut = optimized.search(/^[ \t]*CERTIFICATIONS?[ \t]*:?[ \t]*$/mi)
  const body = (cut === -1 ? optimized : optimized.slice(0, cut))
    // Section headers are all-caps words too — an early draft of this gate flagged
    // "SKILLS" as a credential and would have deleted the header.
    .split('\n').filter(l => !/^[ \t]*[A-Z][A-Z\s&/]{2,39}:?[ \t]*$/.test(l)).join('\n')
  const found = new Set()
  for (const tok of body.match(CERT_SHAPED) || []) {
    const t = tok.toUpperCase().replace(/[- ]/g, '')
    if (CERT_SAFE.has(t)) continue
    if (origUpper.includes(t)) continue        // they already claimed it themselves
    found.add(tok)
  }
  return [...found]
}

/**
 * Two bullets welded together with no line break ("...transformations.• Develop...").
 * Purely mechanical, and it has survived three separate outputs.
 */
function mergedBullets(text) {
  return (String(text || '').match(/^.*[a-z0-9][.)]\s*[•▪]\s*[A-Z].*$/gm) || [])
    .map(l => l.trim().slice(0, 140))
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

    // Computed here, not asked of the model — see totalExperienceMonths above.
    const expMonths = totalExperienceMonths(resumeText)
    const expYears = expMonths === null ? null : Math.floor(expMonths / 12)
    const yearsRule = expYears === null
      ? '- YEARS OF EXPERIENCE. The work history could not be read reliably, so do NOT state a number of years in the summary. Describe the experience without counting it.'
      : `- YEARS OF EXPERIENCE. This candidate has ${expYears}+ years of experience. That number is calculated from the dates in their resume and is correct. If the summary states a number of years it MUST say "${expYears}+ years". Do not recalculate it and do not copy a different number from the original resume, which may be out of date.`

    const basePrompt = `You are an expert resume editor and ATS specialist. Rewrite the resume below so it is targeted at this specific job.

${confirmedBlock}

═══ RULE 1 — EVERY CONFIRMED SKILL MUST APPEAR, HONESTLY ═══
Every confirmed skill must end up in the resume. There is an order of preference for how:
(a) Attach it to an EXISTING bullet, but only when the work that bullet already describes genuinely involved this skill. You are naming a tool inside work they already did, not writing new work. This is the best outcome.
    WORK FOR THIS OUTCOME. Before sending any confirmed skill to the skills list, scan EVERY existing bullet, the summary, and every project description for a genuine home. The candidate confirmed they have used this skill, so in most resumes some described work plausibly involved it: an orchestration tool fits a bullet about scheduling or pipelines; a warehouse fits a bullet about reporting tables; a data-quality tool fits a bullet about validation checks. Attach it there, in their wording. A resume where every confirmed skill sits only in the skills list reads weak and is almost always the result of not looking hard enough.
(b) Only when a genuine home truly does not exist, list it in the skills section as a plain category-line entry. This is honest and expected. A skills-list entry claims "I know this tool", nothing more, and that is a true, defensible claim.
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

═══ RULE 4 — PRESERVE THE RESUME'S STRUCTURE EXACTLY ═══
You are rewriting wording. You are not editing, curating, or shortening the document.
- SAME SECTIONS. Every section in the original appears in your output, and NO section that is not in the original.
- EXACTLY ONE SKILLS SECTION. If the original names it differently (TECHNICAL PROFICIENCY, TECHNICAL SKILLS, CORE COMPETENCIES), that is the same section: output it ONCE, under the header SKILLS, in the position Rule 10 gives it. Never leave a second copy under the old name at the old position. A resume with two skills sections is a structural defect, not extra coverage. If the original has no PROJECTS section, you do not create one. If it has no CERTIFICATIONS section, you do not add the header. Inventing a section is the single worst thing you can do here.
- SAME BULLETS, ONE FOR ONE. If a role has 28 bullets, your output has 28 bullets for that role. Never drop one. Never merge two into one. Never decide a bullet is weak and cut it — that judgement is not yours to make, and the work you would be deleting is real work the candidate actually did.
- SAME SUMMARY LENGTH. If the summary is three sentences, yours is three sentences. Rewrite the wording; never drop a sentence. A dropped summary sentence deletes real experience — one draft cut "developing AI-ready data products and integrating Generative AI use cases using Vertex AI" and replaced it with a list of tools from the posting. That is trading the candidate's true work for the employer's wish list, and it is forbidden.
- KEEP EVERY "Environment:" LINE VERBATIM. Some resumes end a role with "Environment: GCP, BigQuery, Airflow, ...". Reproduce that line exactly as written, under the same role. It is not filler — it is the densest keyword line in the document and an ATS reads every word of it. Never delete it, never reword it, never merge it into a bullet.
- SAME ROLES, SAME ORDER, SAME DATES, SAME EMPLOYERS.
- Rewrite the WORDING of each bullet to align with the posting. That is the whole job.
The candidate can delete a bullet themselves in one keystroke after they see it. They cannot recover one you deleted, because they no longer know what it said. When in doubt, keep it.

LINE DISCIPLINE (tightens wording — it does NOT license deleting anything):
- Each bullet is ONE to TWO lines. If a bullet runs to three lines, trim the setup words. Tighten the sentence; do not delete the bullet.
- The SUMMARY keeps the SAME NUMBER OF SENTENCES as the original. Rewrite each sentence; never drop one and never add one. It states who they are and their strongest relevant skills. It is prose, not a keyword list: never let a sentence become a run of comma-separated product names.
- NEVER put a certification code in the summary or the skills section. VMCE, VMCSE, AWS SAA, PMP, CCNA and anything shaped like them are exam credentials, not tools. Claiming one the candidate does not hold is the single most checkable lie on a resume — a recruiter verifies it in one search. A certification appears ONLY inside a CERTIFICATIONS section that the original already had, and only if the original already listed it.
${yearsRule}
- THE RESUME ENDS AT ITS LAST SECTION. Do not append notes, commentary, a cover letter, a message to the employer, or anything written in the first person. Never write a sentence beginning "Note:" or containing "I". The output is a resume and nothing else.
- If the original HAS a projects section, keep each description to 1-2 sentences. If it does not have one, do not create one.
- Cut filler openers: "Responsible for", "Worked on", "Tasked with", "Helped to". Start bullets with the verb.
Tighten every line. Delete no line.

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
- TENSE IS A HARD RULE, NOT A PREFERENCE. Every bullet in a CURRENT role (its dates end in "Present") MUST be present tense: "Design", "Build", "Operate", "Optimize", "Lead". Never past tense in a current role: not "Designed", "Built", "Led", "Optimized". Past roles are entirely past tense. Do not mix tenses inside one role. Before returning, re-read every current-role bullet and confirm its opening verb is present tense. This is checked automatically, and a mismatch is sent back to you.
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
  "feedback": "<2-3 sentences: what you added and where. If any confirmed skill ended up in the skills section ONLY, name it and say plainly: be ready to speak to where you used it, because your experience bullets do not show it.>",
  "optimizedResume": "<the full rewritten resume>"
}`

    // ── CODE GATE: verify the draft, and on a real violation send it back
    // naming the exact problem. Attempts 0-2 use the cheap rewrite model. If it is
    // still failing the gate after two corrections, attempt 3 escalates to the
    // stronger fallback model — the cheap model has had three tries by then and
    // paying more is better than shipping a resume with fabricated work in it.
    const messages = [{ role: 'user', content: basePrompt }]
    const LAST_ATTEMPT = 3
    let parsed, out, gateNote = ''
    for (let attempt = 0; attempt <= LAST_ATTEMPT; attempt++) {
      const modelForAttempt = attempt === LAST_ATTEMPT ? MODEL_FALLBACK : MODEL_REWRITE
      if (attempt === LAST_ATTEMPT) console.warn('optimize gate: escalating to ' + MODEL_FALLBACK)
      const replyText = await askModel({
        model: modelForAttempt,
        // A full resume plus JSON wrapper is long, and reasoning tokens come out of
        // the same budget. 4000 was sized for a non-reasoning model and truncates here.
        maxTokens: 12000,
        reasoningEffort: 'low',
        // No temperature. This model rejects any explicit value and the fallback in
        // askModel then re-sends the request, so passing one cost a wasted paid call
        // on every attempt. Note this is a real loss: the rewrite used to run at 0.3
        // deliberately, and it now runs at the model's default.
        messages,
      })
      const cleaned = replyText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
      out = parsed.optimizedResume || ''
      out = normalizeCertDashes(out)

      const invented = inventedBullets(out, resumeText, confirmed)
      const dashes = findBannedDashes(out)
      const pastT = findCurrentRolePastTense(out)
      const stray = strayProse(out)
      const newSecs = inventedSections(out, resumeText)
      const lost = bulletsLost(out, resumeText)
      const sumCut = summaryDrifted(out, resumeText)
      const envGone = droppedEnvironmentLines(out, resumeText)
      const certs = certsOutsideCertSection(out, resumeText)
      const merged = mergedBullets(out)
      if (!invented.length && !dashes.length && !pastT.length && !stray.length && !newSecs.length && !lost
          && !sumCut && !envGone.length && !certs.length && !merged.length) break
      if (attempt === LAST_ATTEMPT) {
        if (invented.length) gateNote = ' (Please review the experience section: one or more bullets may describe work not in your original resume.)'
        // Last resort: strip it. A fabricated paragraph reaching a student's resume is
        // worse than a slightly shorter document, and this is the point where retries
        // have run out.
        if (stray.length) {
          for (const p of stray) out = out.replace(p, '').trim()
          console.warn('optimize gate: stripped ' + stray.length + ' stray paragraph(s)')
        }
        // Same reasoning as the stray-prose strip above: an invented section reaching
        // a student is worse than a shorter resume. Cut from the header to the next
        // header, or to the end if it was the last section.
        if (newSecs.length) {
          for (const h of newSecs) {
            const re = new RegExp('^[ \\t]*' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*:?[ \\t]*$', 'mi')
            const m = out.match(re)
            if (!m) continue
            const from = out.indexOf(m[0])
            const rest = out.slice(from + m[0].length)
            const nextIdx = rest.search(/^[ \t]*[A-Z][A-Z\s&/]{2,39}:?[ \t]*$/m)
            out = (out.slice(0, from) + (nextIdx === -1 ? '' : rest.slice(nextIdx))).trim()
          }
          console.warn('optimize gate: stripped invented section(s): ' + newSecs.join(', '))
        }
        // Mechanical repairs that need no model cooperation. A welded bullet pair is
        // fixed by inserting the missing newline; a cert code the candidate never
        // claimed is cut rather than shipped, because a false credential is the most
        // checkable lie on a resume.
        if (merged.length) {
          out = out.replace(/([a-z0-9][.)])\s*([•▪]\s*[A-Z])/g, '$1\n$2')
          console.warn('optimize gate: split ' + merged.length + ' merged bullet(s)')
        }
        if (certs.length) {
          for (const c of certs) {
            out = out.replace(new RegExp('[,;]?\\s*\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '')
          }
          out = out.replace(/,\s*,/g, ',').replace(/,\s*\./g, '.').replace(/\s{2,}/g, ' ')
          console.warn('optimize gate: stripped unclaimed certification code(s): ' + certs.join(', '))
        }
        console.warn('optimize gate unresolved after retries: invented=' + invented.length + ' dashes=' + dashes.length + ' pastTense=' + pastT.length + ' stray=' + stray.length + ' newSections=' + newSecs.length + ' bulletsLost=' + (lost ? lost.before + '->' + lost.after : 'no') + ' summaryCut=' + (sumCut ? sumCut.before + '->' + sumCut.after : 'no') + ' envDropped=' + envGone.length + ' certs=' + certs.length + ' merged=' + merged.length)
        break
      }
      console.warn('optimize gate retry ' + (attempt + 1) + ': invented=' + invented.length + ' dashes=' + dashes.length + ' pastTense=' + pastT.length + ' stray=' + stray.length + ' newSections=' + newSecs.length + ' bulletsLost=' + (lost ? lost.before + '->' + lost.after : 'no') + ' summaryCut=' + (sumCut ? sumCut.before + '->' + sumCut.after : 'no') + ' envDropped=' + envGone.length + ' certs=' + certs.length + ' merged=' + merged.length)
      let corrections = 'Your draft breaks the rules below. Fix ONLY these problems and return the same JSON format.\n'
      // Every rule you have already satisfied must STAY satisfied. Without this line
      // the model treats each correction as the only constraint and trades one for
      // another: run #3 fixed the certification claim and paid for it by deleting 73
      // bullets and four Environment lines, then fixed those and broke the dashes.
      corrections += 'Everything else in your draft was correct. Keep it exactly as it is — same sections, same number of bullets, same summary length, same Environment lines. Fixing the problems below must not undo anything you already got right.\n'
      if (invented.length) {
        corrections += '\nINVENTED EXPERIENCE. These bullets describe work that is NOT in the original resume, which is fabrication and is forbidden:\n' + invented.map(b => '  - "' + b + '"').join('\n') + '\nDelete each one. If a bullet exists only to carry a confirmed skill, remove the bullet and place that skill in the skills section instead. Do not write a replacement bullet.\n'
      }
      if (dashes.length) {
        corrections += '\nBANNED DASHES (em-dash, en-dash, or --) on these lines:\n' + dashes.map(l => '  - "' + l + '"').join('\n') + '\nReplace each with a comma, a full stop, or a plain hyphen. Keep a plain hyphen only inside a certification name.\n'
      }
      if (stray.length) {
        corrections += '\nTEXT THAT IS NOT PART OF A RESUME. You appended prose after the last section:\n' + stray.map(l => '  - "' + l.slice(0, 120) + '…"').join('\n') + '\nDelete it entirely. A resume ends at its final section. Never add notes, commentary, or anything written in the first person.\n'
      }
      if (newSecs.length) {
        corrections += '\nINVENTED SECTIONS. The original resume has no ' + newSecs.join(' and no ') + ' section, and you created one:\n' + newSecs.map(h => '  - "' + h + '"').join('\n') + '\nDelete the header and everything under it. Never add a section the original does not have. If a confirmed skill has nowhere to go, put it in the skills section — do not build a project or an entry around it.\n'
      }
      if (lost) {
        corrections += '\nDELETED WORK. The original resume has ' + lost.before + ' bullet points and your draft has only ' + lost.after + '. You are removing the candidate\'s real experience.\nReturn EVERY bullet from the original, one for one, in the same order and under the same employer. Rewrite the wording of a bullet if it helps, but never drop one, and never merge two into one.\n'
      }
      if (sumCut && sumCut.dir === 'cut') {
        corrections += '\nDELETED SUMMARY CONTENT. The original summary has ' + sumCut.before + ' sentences and yours has ' + sumCut.after + '. You deleted the candidate\'s real experience to make room for terms from the posting.\nRestore every sentence. Rewrite the wording if it helps, but each original sentence must still be represented. The summary is prose, not a list of product names.\n'
      }
      if (sumCut && sumCut.dir === 'padded') {
        corrections += '\nINVENTED SUMMARY CONTENT. The original summary has ' + sumCut.before + ' sentences and yours has ' + sumCut.after + '. You added ' + (sumCut.after - sumCut.before) + ' sentences that are not in the original resume.\nCut it back to exactly ' + sumCut.before + ' sentences. Delete the added ones outright — do not merge them into the remaining sentences. Sentences like "Known for..." or "Effective communicator who..." are character claims, not experience, and nothing in the resume supports them.\n'
      }
      if (envGone.length) {
        corrections += '\nDELETED ENVIRONMENT LINES. The original ends ' + envGone.length + ' role(s) with an "Environment:" line and you removed them:\n' + envGone.map(l => '  - "' + l.slice(0, 100) + '…"').join('\n') + '\nPut each one back, verbatim, under the same role. It is the densest keyword line in the resume and an ATS reads all of it.\n'
      }
      if (certs.length) {
        corrections += '\nFALSE CERTIFICATION CLAIM. These look like exam credentials and the original resume does not contain them:\n' + certs.map(c => '  - "' + c + '"').join('\n') + '\nRemove every one. A certification is not a skill and cannot be claimed because it appears in the posting. This is the most easily verified lie a resume can contain.\n'
      }
      if (merged.length) {
        corrections += '\nMERGED BULLETS. These lines contain two bullets joined with no line break:\n' + merged.map(l => '  - "' + l + '"').join('\n') + '\nPut each bullet on its own line.\n'
      }
      if (pastT.length) {
        corrections += '\nTENSE. Your CURRENT role (its dates end in "Present") must be present tense throughout. These bullets open in PAST tense:\n' + pastT.map(l => '  - "' + l + '"').join('\n') + '\nRewrite each opening verb to present tense (Managed to Manage, Led to Lead, Built to Build, Optimized to Optimize). If a flagged word is actually an adjective or already present tense, leave it unchanged.\n'
      }
      messages.push({ role: 'assistant', content: replyText })
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
// ── RESUME UPLOAD (PDF / Word) ──────────────────────────────────────────────
//
// The login gate made adding a resume the mandatory door into the product. Asking
// a stranger to open their resume, select all, copy and paste is the highest-friction
// version of the highest-friction step, so this accepts a file instead.
//
// WE STORE THE TEXT, NOT THE FILE. Keeping people's CVs on disk means object
// storage, retention rules and a real privacy obligation, and nothing downstream
// needs the original bytes. The buffer lives in memory for the length of one request.
//
// NOTHING HERE BLOCKS. A file that fails the checks still comes back with its text
// and a warning; the client decides. If the checks are wrong even 2% of the time,
// blocking locks a real student out permanently with no way to argue, while letting
// a wrong file through costs them ten seconds — they see the wrong jobs and know.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx|doc)$/i.test(file.originalname)
    cb(ok ? null : new Error('Please upload a PDF or Word file.'), ok)
  },
})

// Asks Haiku for the profile fields in one call. Returns nulls rather than guesses:
// a wrong graduation date shown as fact is worse than an empty box the student fills.
async function readProfileFromResume(resumeText) {
  const allowed = CATEGORIES.join(', ')
  // The model has no idea what day it is, so "Jan 2022 - Present" is unresolvable
  // and it guesses. A resume reading 5+ years came back as 3 for exactly this.
  const today = new Date().toISOString().slice(0, 10)
  try {
  const replyText = await askModel({
    model: MODEL_EXTRACT,
    maxTokens: 8000,
    reasoningEffort: 'minimal',   // straight field extraction; full reasoning starved the reply
    messages: [{
      role: 'user',
      content: `Read this resume and return ONLY a JSON object. No preamble, no markdown fences.

Keys, all required, use null when the resume does not say:
  firstName, lastName, email, targetRole, degree, major, yearsExperience, location,
  phone, linkedin, github, graduationDate
  field  - must be exactly one of: ${allowed}
  isResume - true only if this is genuinely a resume or CV

Rules:
- Never guess. If the resume does not state something, use null.
- yearsExperience: TODAY IS ${today}. Work it out by adding up every role's date
  range, treating "Present" or "Current" as today. Do not copy a number stated in
  a summary if the dates disagree with it. Round to a whole number. null if there
  is no work history at all.
- field: the field this person WORKS IN, from their most recent roles. If there is
  no work history, fall back to the degree and major.
- linkedin/github: full URLs if present, otherwise null.
- graduationDate: as "MMM YYYY" if the education section gives one.

RESUME:
${resumeText.slice(0, 12000)}`,
    }],
  })

  const raw = replyText.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(raw)
    const clean = v => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') ? v.trim() : ''
    return {
      isResume:        parsed.isResume !== false,
      firstName:       clean(parsed.firstName),
      lastName:        clean(parsed.lastName),
      email:           clean(parsed.email),
      targetRole:      clean(parsed.targetRole),
      degree:          clean(parsed.degree),
      major:           clean(parsed.major),
      yearsExperience: clean(parsed.yearsExperience),
      location:        clean(parsed.location),
      phone:           clean(parsed.phone),
      linkedin:        clean(parsed.linkedin),
      github:          clean(parsed.github),
      graduationDate:  clean(parsed.graduationDate),
      // Anything outside the known list is dropped. A made-up field would filter the
      // board down to zero jobs and look like a broken search.
      field: CATEGORIES.includes(parsed.field) ? parsed.field : '',
    }
  } catch (err) {
    // Covers BOTH a bad JSON response and the API call itself failing — an
    // outage, a rate limit, a revoked key. None of those may block onboarding:
    // the text is already extracted and is the part that matters, so the student
    // continues with empty fields and fills them in. Losing the AI should cost
    // six auto-filled boxes, not the ability to create an account.
    console.error('profile extraction failed:', err.message)
    return null
  }
}

app.post('/me/resume/upload', requireUser, (req, res) => {
  upload.single('resume')(req, res, async err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is over 10MB. Please upload a smaller one.'
        : err.message || 'Could not read that file.'
      return res.status(400).json({ error: msg })
    }
    if (!req.file) return res.status(400).json({ error: 'No file received.' })

    try {
      const { text, pages, method } = await extractText(req.file.buffer, req.file.originalname)
      const assessment = assessExtraction(text)

      // No text at all, or barely any. Returned as 200 with a status the client can
      // act on — this is an expected outcome for a scanned PDF, not a server error.
      if (assessment.status === 'empty' || assessment.status === 'short') {
        return res.json({
          status: assessment.status,
          message: assessment.message,
          text,
          fileName: req.file.originalname,
        })
      }

      const profile = await readProfileFromResume(text)

      // Two independent opinions on whether this is a resume: the regex checks and
      // the model. Either objecting is enough to warn, because they fail on different
      // things — the checks miss an unusual layout, the model misses a bank statement
      // that happens to contain an email address.
      const suspect = assessment.status === 'not_resume' || profile?.isResume === false

      res.json({
        status: suspect ? 'not_resume' : 'ok',
        message: suspect
          ? "This doesn't look like a resume. We read the text but couldn't find the things a resume normally has."
          : null,
        checks: assessment.checks || null,
        text,
        pages,
        method,
        fileName: req.file.originalname,
        profile: profile || null,
      })
    } catch (error) {
      console.error('Resume upload error:', error)
      res.status(500).json({ error: 'Could not read that file. Please try another, or paste the text instead.' })
    }
  })
})

// ── ANALYSE PASTED TEXT ──────────────────────────────────────
// The paste box is the fallback when a PDF holds no text at all — a scan or a photo.
// Those students must get the same profile extraction as everyone else, or the one
// group already having a bad time is also the group whose board cannot be filtered.
// Same response shape as the upload endpoint so the client handles one format.
app.post('/me/resume/analyze', requireUser, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim()
    const assessment = assessExtraction(text)

    if (assessment.status === 'empty' || assessment.status === 'short') {
      return res.json({ status: assessment.status, message: assessment.message, text })
    }

    const profile = await readProfileFromResume(text)
    const suspect = assessment.status === 'not_resume' || profile?.isResume === false

    res.json({
      status: suspect ? 'not_resume' : 'ok',
      message: suspect
        ? "This doesn't look like a resume. We read the text but couldn't find the things a resume normally has."
        : null,
      checks: assessment.checks || null,
      text,
      profile: profile || null,
    })
  } catch (error) {
    console.error('Resume analyse error:', error)
    res.status(500).json({ error: 'Could not read that. Please try again.' })
  }
})

// ── SAVE THE CONFIRMED RESUME + PROFILE ─────────────────────────────────────
// Separate from the upload on purpose. Upload reads and returns; this saves what the
// student has actually seen and approved. Nothing reaches the database until they
// have looked at the extracted text — which is the point of the review step, since
// scrambled extraction produces bad matches with no visible cause.
app.post('/me/profile', requireUser, async (req, res) => {
  try {
    const { resumeText, resumeFileName, profile } = req.body || {}
    if (!resumeText || !String(resumeText).trim()) {
      return res.status(400).json({ error: 'Resume text is required.' })
    }

    const p = profile || {}
    const str = v => (typeof v === 'string' ? v.trim() : '')

    // The role is the single source of truth for the board. There is no field control
    // on the profile any more, so whatever the student types as their target role is
    // run through the same categoriser that labelled all 26,976 jobs — "Data Engineer"
    // becomes Tech, and the board filters on that.
    //
    // Why the board cannot just match the role text: "Data Engineer" as a title search
    // returns a couple of jobs. Backend, Analytics, ML and Platform Engineer all vanish,
    // and every one of those is a job this student would take. The role is a narrow
    // match; the field is the net.
    //
    // categorizeJob returns 'Other' when a title gives no clear signal — "Consultant",
    // say. Storing that would filter the board down to the Other bucket, which is not
    // what an unclear role means, so it is left empty and the board shows everything.
    const role = str(p.targetRole)
    let derivedField = ''
    if (role) {
      const guess = categorizeJob(role)
      if (guess && guess !== 'Other') derivedField = guess
    }

    const update = {
      clerkUserId:    req.userId,
      resumeText:     String(resumeText),
      resumeFileName: str(resumeFileName),
      updatedAt:      new Date(),
      profile: {
        firstName:       str(p.firstName),
        lastName:        str(p.lastName),
        email:           str(p.email),
        field:           derivedField,
        targetRole:      str(p.targetRole),
        degree:          str(p.degree),
        major:           str(p.major),
        yearsExperience: str(p.yearsExperience),
        location:        str(p.location),
        phone:           str(p.phone),
        linkedin:        str(p.linkedin),
        github:          str(p.github),
        graduationDate:  str(p.graduationDate),
      },
    }

    const user = await User.findOneAndUpdate(
      { clerkUserId: req.userId },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()

    // Drives the board banner. These are things a resume DOES normally state, so an
    // empty one means extraction went wrong — a scrambled two-column PDF, say — not
    // that the student skipped a form. The banner is a fault report, not a nag.
    const missing = ['field', 'targetRole', 'degree']
      .filter(k => !user.profile?.[k])

    res.json({ saved: true, profile: user.profile, missing, updatedAt: user.updatedAt })
  } catch (error) {
    console.error('Save profile error:', error)
    res.status(500).json({ error: 'Could not save your profile. Please try again.' })
  }
})

// ── BOARD STATS (public) ────────────────────────────────────
// The landing page reads its job count from here. It used to be hardcoded, drifted
// to more than double the real figure, and sat directly above a line claiming every
// number on the page was real. A live count cannot go stale.
//
// Cached for 5 minutes: every visitor to a public page hits this, and the number only
// changes when the pipeline runs — every 6 hours.
let statsCache = { total: null, at: 0 }
const STATS_TTL_MS = 5 * 60 * 1000

app.get('/stats', async (req, res) => {
  try {
    // ?field=Tech returns the count for that field alone. The profile page shows it
    // beside the sentence, so changing the field visibly changes the number — the
    // control proves what it does instead of describing it. It also exposes a thin
    // field for free: pick Engineering & Science and 281 appears, which tells a
    // student more than any caption could.
    const field = req.query.field
    if (field && CATEGORIES.includes(field)) {
      const total = await Job.countDocuments({ closed: { $ne: true }, field })
      return res.json({ total, field })
    }

    const now = Date.now()
    if (statsCache.total === null || now - statsCache.at > STATS_TTL_MS) {
      // Same condition the board applies, so the advertised number matches what a
      // student actually sees rather than counting rows they can never reach.
      statsCache = { total: await Job.countDocuments({ closed: { $ne: true } }), at: now }
    }
    res.json({ total: statsCache.total })
  } catch (err) {
    // A failed count must never break the landing page. The client renders an em dash
    // when total is missing, which is better than showing a wrong number.
    console.error('stats failed:', err.message)
    res.status(500).json({ error: 'could not read stats' })
  }
})

// ── LIST jobs (search + filters + pagination)
// The board calls this with: page, query, workType, experienceLevel, time_posted, state.
// It expects back { jobs, total, pages }. Page size is decided here, not by the client.
app.get('/jobs', async (req, res) => {
  try {
    const PAGE_SIZE = 20
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)

    // Never list a posting we already know is closed.
    const filter = { closed: { $ne: true } }

    // Search box: every WORD typed must appear somewhere in the title or company —
    // "data engineer" therefore also finds "Data Platform Engineer", not just the exact
    // phrase. Results are then ranked (see the aggregation below) so the closest title
    // matches come first, newest first within each tier.
    // Escaped so a query like "c++" or "node.js" can't break the regex.
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // When the student has not searched, their TARGET ROLE becomes the query. The
    // board is not filtered by it — every job is still there — it is only RANKED, so
    // a Data Engineer opens the board and sees today's Data Engineer roles first, then
    // today's related ones, then yesterday's.
    //
    // Filtering on the role text instead would be far worse: "Senior Data Engineer" as
    // a title match returns a couple of jobs, and Backend, Analytics, ML and Platform
    // Engineer all disappear — every one of them a job this student would take.
    // Ranking keeps them, just lower down.
    const searched = (req.query.query || '').trim()
    const q = searched || (req.query.role || '').trim()
    const words = q ? q.split(/\s+/).filter(Boolean).slice(0, 6) : []
    // Seniority/filler words are weak signals — "Senior Software Engineer" should NOT
    // rank alongside "Data Engineer" for the search "senior data engineer" just because
    // both matched two words. Only the real role words decide relevance; seniority still
    // adds to the score, so "Senior Data Engineer" beats "Data Engineer" on an exact ask.
    const GENERIC = new Set(['senior','sr','junior','jr','staff','lead','principal','entry',
      'mid','level','i','ii','iii','iv','associate','head','chief','director','manager',
      'intern','internship','of','the','and','a','an','in','for','at'])
    const coreWords = words.filter(w => !GENERIC.has(w.toLowerCase()))
    const tierWords = coreWords.length ? coreWords : words
    if (words.length) {
      // ANY word is enough to be included — partial matches ("Analytics Engineer" for
      // "data engineer") still appear, but the scoring below pushes them to the bottom.
      filter.$or = words.flatMap(w => {
        const rx = new RegExp(esc(w), 'i')
        return [{ title: rx }, { company: rx }]
      })
    }

    // Straight pass-through filters — the dropdown values match what fetchJobs stored.
    if (req.query.workType)        filter.workType = req.query.workType
    if (req.query.experienceLevel) filter.experienceLevel = req.query.experienceLevel
    if (req.query.state)           filter.state = req.query.state
    // Field: validated against CATEGORIES rather than passed straight through, so a
    // stale or hand-edited URL cannot filter on a value no job carries and silently
    // return an empty board. An unknown value is ignored, showing everything.
    // Roles needing a US state licence or bar admission are hidden. The board header
    // promises these are not here, and until now that promise was only half true: the
    // 173-pattern filter catches postings that SAY "citizens only", but a Registered
    // Nurse posting never says it — the barrier is the licence.
    //
    // `$ne: true` rather than `false` on purpose: jobs saved before this field existed
    // have no value at all, and a strict false would hide the entire back catalogue.
    filter.needsLicense = { $ne: true }

    // The field filter is deliberately no longer applied. Hiding four fifths of the
    // board on an inferred category meant a wrong inference was invisible and had no
    // manual fix. Relevance ranking does the same work honestly: everything is present,
    // the right things are at the top.
    //
    // The parameter is still accepted so old links and bookmarks do not break.
    if (req.query.field && CATEGORIES.includes(req.query.field)) {
      filter.field = req.query.field
    }

    // Time posted: a rolling window on postedAt. Jobs with no postedAt are excluded
    // from a time filter, which is the right call — an undated job isn't "from this week".
    // The pipeline deletes anything older than 30 days (MAX_AGE_DAYS in FetchJobs.mjs),
    // so a month is the widest window the board holds. Keep these two numbers in step:
    // a window longer than MAX_AGE_DAYS would advertise jobs that no longer exist.
    const windows = { today: 1, '3days': 3, week: 7, '2weeks': 14, month: 30 }
    const days = windows[req.query.time_posted]
    if (days) {
      filter.postedAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    }

    // Companies post the SAME role once per location (Roku "Senior Data Engineer" in
    // San Jose and Austin are two Greenhouse rows). For a student scanning the board
    // that is noise, so identical title+company rows are folded into ONE card that
    // carries every location. Nothing is lost: each location keeps its own id and
    // applyUrl, and the detail pane lets the student pick which one to apply to.
    // NOTE: this means `total` counts GROUPS, not raw postings.
    // Only the fields the list cards and detail header actually use. Sorting or grouping
    // whole documents blows MongoDB's memory caps (32MB for $sort, 100MB for $group) at
    // this collection size, and an inclusion projection is far smaller than merely
    // dropping `description`. The full description is fetched separately by /jobs/:id.
    const CARD_FIELDS = {
      id: 1, title: 1, company: 1, companySlug: 1, location: 1, applyUrl: 1,
      postedAt: 1, workType: 1, experienceLevel: 1, state: 1, isRemote: 1,
      salaryMin: 1, salaryMax: 1, yearsMin: 1, yearsMax: 1, closed: 1,
    }

    // Grouping is done in Node (see groupDuplicates below) rather than with a $group
    // stage: this collection is large enough that a full-collection $group/$sort blows
    // MongoDB's in-memory aggregation caps on this Atlas tier. Duplicate postings sort
    // next to each other (same company, same title, same timestamp), so folding them
    // within the fetched page catches effectively all of them at a fraction of the cost.
    // Trade-off: a job whose locations straddle a page boundary can still appear twice.
    function groupDuplicates(rows) {
      const out = []
      const byKey = new Map()
      for (const j of rows) {
        const key = `${(j.title || '').toLowerCase()}|||${(j.company || '').toLowerCase()}`
        const variant = {
          id: j.id, location: j.location, applyUrl: j.applyUrl,
          state: j.state, workType: j.workType, closed: j.closed,
        }
        const existing = byKey.get(key)
        if (existing) {
          existing.locations.push(variant)
          existing.locationCount = existing.locations.length
        } else {
          const card = { ...j, locations: [variant], locationCount: 1 }
          byKey.set(key, card)
          out.push(card)
        }
      }
      return out
    }

    // The list cards never read `description` (only the detail view fetches it), and
    // descriptions are large HTML blobs, so drop it here to keep the payload light.
    let jobs
    let sortStage
    if (words.length) {
      // Ranked search. Score is title-focused, because a student scanning results cares
      // about the ROLE matching, not the company name happening to contain a word:
      //   +100  title contains the whole phrase ("Data Engineer")
      //   +60   title STARTS with the phrase (the most on-the-nose match)
      //   +10   per individual word found in the title
      // Everything that merely matched on company scores 0 and sinks to the bottom.
      // Ties break on postedAt, so within equally-relevant jobs the newest come first.
      const phrase = esc(q)
      const titleHas = w => ({ $regexMatch: { input: '$title', regex: esc(w), options: 'i' } })
      // Whole-word match: "engineer" should count for "Data Engineer" but NOT for
      // "Data Engineering Manager", which is a different job. \\b would also fire on
      // "engineering", so we require the word to end at a non-letter (or end of title).
      const anyHas = w => ({
        $or: [
          { $regexMatch: { input: '$title', regex: esc(w), options: 'i' } },
          { $regexMatch: { input: { $ifNull: ['$company', ''] }, regex: esc(w), options: 'i' } },
        ]
      })
      const titleHasWord = w => ({
        $regexMatch: { input: '$title', regex: '(^|[^a-z])' + esc(w) + '([^a-z]|$)', options: 'i' }
      })
      const score = [
        // Exact title, nothing else: "Data Engineer" for "data engineer".
        { $cond: [{ $regexMatch: { input: '$title', regex: '^' + phrase + '$', options: 'i' } }, 400, 0] },
        // Every word present as a WHOLE word — separates "Data Engineer II" from
        // "Data Engineering Manager".
        { $cond: [{ $and: words.map(titleHasWord) }, 250, 0] },
        // Every word present at all (partial forms still count here).
        { $cond: [{ $and: words.map(titleHas) }, 200, 0] },
        { $cond: [{ $regexMatch: { input: '$title', regex: phrase, options: 'i' } }, 100, 0] },
        { $cond: [{ $regexMatch: { input: '$title', regex: '^' + phrase, options: 'i' } }, 60, 0] },
        ...words.map(w => ({ $cond: [titleHas(w), 10, 0] })),
      ]
      // Order: DAY first, relevance second. Today's postings come before yesterday's,
      // and within a single day the closest title matches lead. This suits a student on
      // an OPT clock — fresh listings first, best match at the top of each day — rather
      // than a month-old exact match camping above everything posted today.
      // Jobs with no postedAt sort last (null is lowest in a descending sort).
      sortStage = { _tier: -1, _day: -1, _score: -1, postedAt: -1 }
      jobs = await Job.aggregate([
        { $match: filter },
        { $project: CARD_FIELDS },
        { $addFields: {
            _score: { $add: score },
            _day: { $dateToString: { format: '%Y-%m-%d', date: '$postedAt' } },
            // Relevance tiers, strongest first. A plain word count treated "Senior
            // DataOps Engineer" as an equal match for "data engineer" — DataOps merely
            // CONTAINS "data" — and then a few hours of freshness decided the order.
            // A better title should outrank a fresher one.
            //   4  title IS the query               "Data Engineer"
            //   3  title contains the whole phrase  "Senior Data Engineer"
            //   2  all core words as WHOLE words    "Data Platform Engineer"
            //   1  all core words, substring only   "Senior DataOps Engineer"
            //   0  only some words                  "Analytics Engineer"
            _tier: { $switch: { branches: [
              { case: { $regexMatch: { input: '$title', regex: '^\\s*' + phrase + '\\s*$', options: 'i' } }, then: 4 },
              // Phrase must end on a word boundary, so "Data Engineering" does not count
              // as containing "data engineer".
              { case: { $regexMatch: { input: '$title', regex: '(^|[^a-z])' + phrase + '([^a-z]|$)', options: 'i' } }, then: 3 },
              { case: { $and: tierWords.map(titleHasWord) }, then: 2 },
              { case: { $and: tierWords.map(titleHas) }, then: 1 },
            ], default: 0 } },
        } },
        { $sort: sortStage },
        { $skip: (page - 1) * PAGE_SIZE },
        { $limit: PAGE_SIZE },
        { $project: { _score: 0, _day: 0, _tier: 0 } },
      ])
    } else {
      // No search term: newest first.
      sortStage = { postedAt: -1 }
      jobs = await Job.find(filter)
        .select('-description')
        .sort({ postedAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
    }

    jobs = groupDuplicates(jobs)

    // Counts raw postings, not folded cards — an exact group count would need the same
    // full-collection aggregation we just avoided. Only used for pagination, and the
    // jobs-found number is not shown in the UI.
    const total = await Job.countDocuments(filter)
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
    let closed = job.closed === true

    if (job.ats === 'greenhouse' && job.companySlug) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${job.companySlug}/jobs/${id}?questions=false`
        const ghRes = await fetch(url, { signal: AbortSignal.timeout(8000) })

        if (ghRes.ok) {
          const data = await ghRes.json()
          fullDescription = data.content ? decodeHtmlEntities(data.content) : fullDescription
          // It answered and the posting is live, so clear any stale closed flag.
          if (closed) {
            closed = false
            await Job.updateOne({ id }, { closed: false })
          }
        } else if (ghRes.status === 404) {
          // ONLY a 404 means the posting is genuinely gone. A 500 or a timeout means
          // we could not reach Greenhouse, which is not the same thing and must never
          // mark a live job dead.
          closed = true
          if (!job.closed) await Job.updateOne({ id }, { closed: true })
        }
      } catch {
        // Network failure. Not authoritative: fall back to the stored description
        // and leave the closed flag exactly as it was.
      }
    }

    if (job.ats === 'ashby' && job.companySlug) {
      // Ashby publishes a whole board at a time, not one posting, so the board is
      // fetched and the job found inside it. That costs a slightly larger response and
      // buys the closed check for free: a posting that has been taken down simply stops
      // appearing in the board's list.
      //
      // The stored id carries an "ashby_" prefix — Ashby ids are UUIDs and Greenhouse's
      // are numeric, so they are namespaced to keep the collection unambiguous. The
      // prefix has to come off before matching against the API.
      try {
        const boardUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(job.companySlug)}`
        const aRes = await fetch(boardUrl, { signal: AbortSignal.timeout(8000) })

        if (aRes.ok) {
          const data = await aRes.json()
          const rawId = String(id).replace(/^ashby_/, '')
          const posting = (data.jobs || []).find(j => String(j.id) === rawId)

          if (posting) {
            // descriptionHtml, not descriptionPlain.
            //
            // Ashby produces the "plain" field by flattening everything — headings,
            // list items and paragraphs all collapse into one run of text, with raw
            // URLs left mid-sentence. On screen that is an unreadable wall, and worse,
            // it looked nothing like the Greenhouse jobs beside it on the same board.
            // The HTML carries the real structure, and the frontend already sanitises
            // it and styles bold-only paragraphs as headings.
            fullDescription = posting.descriptionHtml || posting.descriptionPlain || fullDescription
            if (closed) {
              closed = false
              await Job.updateOne({ id }, { closed: false })
            }
          } else {
            // The board answered and this posting is not in it. Same authority as a
            // Greenhouse 404: the employer took it down.
            closed = true
            if (!job.closed) await Job.updateOne({ id }, { closed: true })
          }
        }
        // A non-OK response says nothing about this posting. The whole board being
        // unreachable is not evidence that one job within it has closed.
      } catch {
        // Network failure. Fall back to the stored description, leave closed as it was.
      }
    }

    if (job.ats === 'smartrecruiters' && job.companySlug) {
      // SmartRecruiters is the one source with a real per-posting endpoint — Greenhouse
      // needs the job id and Ashby makes you pull the whole board — so this is a single
      // cheap request.
      //
      // The ad arrives in four separate sections and all four matter. Sponsorship
      // refusals found in testing were almost always in additionalInformation, not in
      // jobDescription, so reading only the obvious one would miss exactly the sentences
      // this product exists to catch.
      try {
        const rawId = String(id).replace(/^sr_/, '')
        const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(job.companySlug)}/postings/${rawId}`
        const sRes = await fetch(url, { signal: AbortSignal.timeout(8000) })

        if (sRes.status === 404) {
          // Authoritative, same as a Greenhouse 404: the employer took it down.
          closed = true
          if (!job.closed) await Job.updateOne({ id }, { closed: true })
        } else if (sRes.ok) {
          const d = await sRes.json()
          const sections = d?.jobAd?.sections || {}
          // Kept as HTML — the frontend sanitises it and styles headings, and the plain
          // alternative would arrive as one unreadable run the way Ashby's did.
          const html = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
            .map(k => sections[k]?.text || '')
            .filter(Boolean)
            .join('<br><br>')
          if (html) fullDescription = html
          if (closed) {
            closed = false
            await Job.updateOne({ id }, { closed: false })
          }
        }
        // Any other status says nothing about this posting, so nothing changes.
      } catch {
        // Network failure. Fall back to the stored description, leave closed as it was.
      }
    }

    res.json({ ...job, description: fullDescription, closed })

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

// Monochrome. No accent color at all: text is black, rules are a light gray hairline.
// Rules get their own value because a full-black horizontal line reads as a heavy bar,
// not a divider. Word wants hex without the #, the PDF's HTML wants it with.
const ACCENT_HEX = '000000'   // Word text
const RULE_HEX   = 'BFBFBF'   // Word borders
const MUTED_HEX  = '595959'   // Word secondary text (company, dates)
const ACCENT_CSS = '#000000'  // PDF text
const RULE_CSS   = '#D4D4D4'  // PDF rules
const MUTED_CSS  = '#595959'  // PDF secondary text

// Web-safe fonts only — these render identically on the PDF server AND on whatever
// machine opens the Word file. Trendy fonts (Inter, Roboto) would silently fall back.
const FONT_STACKS = {
  calibri: { word: 'Calibri',          css: "Calibri, 'Segoe UI', sans-serif" },
  arial:   { word: 'Arial',            css: 'Arial, Helvetica, sans-serif' },
  georgia: { word: 'Georgia',          css: 'Georgia, serif' },
  times:   { word: 'Times New Roman',  css: "'Times New Roman', Times, serif" },
}
// The client sends a display name ("Times New Roman"), not the internal key ("times").
// A plain lookup misses, falls back to Calibri, and every download comes out identical
// no matter what the user picked. Normalise and alias so that cannot happen silently.
const FONT_ALIASES = {
  calibri: 'calibri',
  arial: 'arial', helvetica: 'arial',
  georgia: 'georgia',
  times: 'times', timesnewroman: 'times', timesroman: 'times',
}
function fontFor(id) {
  if (!id) return FONT_STACKS.calibri
  const key = String(id).toLowerCase().replace(/[^a-z]/g, '')
  const resolved = FONT_ALIASES[key]
  if (!resolved) console.warn(`fontFor: unknown font "${id}", using Calibri`)
  return FONT_STACKS[resolved] || FONT_STACKS.calibri
}

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
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_HEX } },
      spacing: { before: 60, after: 120 }
    }))

    for (const line of bodyLines) {
      if (!line) { children.push(new Paragraph({ spacing: { after: 20 } })); continue }
      if (isSection(line)) {
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: RULE_HEX } },
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
                new TextRun({ text: `  |  ${rest}`, size: bodySize - 1, italics: true, color: MUTED_HEX, font: FONT }),
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
          spacing: { before: sp.before, after: 20 }, keepNext: true,
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
  const cfg       = { accent: ACCENT_CSS, rule: RULE_CSS, muted: MUTED_CSS, font: fontFor(font).css }
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

  body += `<div style="text-align:${align};padding-bottom:10pt;margin-bottom:14pt;border-bottom:1pt solid ${cfg.rule}">`
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
            
            ${esc(line)}
          </div>
          <div style="height:0.75pt;background:${cfg.rule};margin-top:3pt"></div>
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
            <span style="font-weight:600;color:#222">${esc(company)}</span><span style="color:${cfg.muted};font-style:italic"> | ${esc(rest)}</span>
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
      body += `<div style="font-size:${isCompact ? '10.5pt' : '11.5pt'};font-weight:800;color:#111;break-after:avoid;page-break-after:avoid;break-inside:avoid;margin-top:${gap};margin-bottom:1pt">${esc(line)}</div>`
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

// ── PDF RENDERING
// We run Chrome ourselves instead of paying a service per page. PDFShift's cheapest
// paid tier is $9 for 500 conversions; a bigger Render instance is about $7 for an
// unlimited number, so self-hosting is cheaper from the first paid month. It also
// removes the 50/month free cap that blocked development, and because we control the
// machine we can install real fonts instead of watching Georgia silently become Arial.

// One browser for the whole process, not one per request. Launching Chrome costs
// roughly a second and a few hundred MB, so doing it per download would be slow and
// would eventually exhaust memory. Pages are cheap; the browser is not.
let browserPromise = null

async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise
      const alive = typeof b.connected === 'boolean' ? b.connected : b.isConnected?.()
      if (alive) return b
    } catch { /* fall through and relaunch */ }
    browserPromise = null
  }

  // Imported lazily and defensively. If the package or the Chrome binary is missing,
  // a top-level import would crash the entire server on boot and take the job board
  // down with it. This way a broken renderer only breaks PDFs, and the fallback covers
  // even that.
  const { default: puppeteer } = await import('puppeteer')

  browserPromise = puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Containers hand out a tiny /dev/shm. Without this Chrome runs out of shared
      // memory partway through rendering and dies with an opaque crash.
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--font-render-hinting=none',
    ],
  })
  return browserPromise
}

async function renderPdfLocally(html) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 })
    await page.emulateMediaType('print')
    return Buffer.from(await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    }))
  } finally {
    // Always close the page, even if the render threw. A leaked page holds memory
    // for the life of the process, and on a small instance that is fatal.
    await page.close().catch(() => {})
  }
}

// Kept only as a safety net while local rendering proves itself in production.
// Delete this and the PDFSHIFT_API_KEY once a week of real downloads has passed.
async function renderPdfViaPdfShift(html) {
  if (!process.env.PDFSHIFT_API_KEY) throw new Error('no PDFShift key configured')
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
  if (!response.ok) throw new Error(`PDFShift ${response.status}: ${await response.text()}`)
  return Buffer.from(await response.arrayBuffer())
}

app.post('/download-pdf', async (req, res) => {
  const { resumeText, font, length } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  const html = buildResumeHTML(resumeText, font || 'calibri', length || 'standard')
  let pdfBuffer = null

  try {
    pdfBuffer = await renderPdfLocally(html)
  } catch (localErr) {
    console.error('Local PDF render failed:', localErr.message)
    // Force a fresh browser next time: the current one may be wedged or dead.
    browserPromise = null
    try {
      pdfBuffer = await renderPdfViaPdfShift(html)
      console.warn('Served PDF via PDFShift fallback')
    } catch (fallbackErr) {
      console.error('PDFShift fallback also failed:', fallbackErr.message)
      return res.status(500).json({ error: 'Failed to generate PDF. Please try again.' })
    }
  }

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="optimized-resume.pdf"',
    'Content-Length': pdfBuffer.length
  })
  res.send(pdfBuffer)
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})