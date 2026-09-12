import dns from 'dns'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { CATEGORIES, categorizeJob } from './jobCategory.mjs'
import multer from 'multer'
import { extractText, assessExtraction } from './resumeExtract.mjs'
import { readPdfLayout } from './pdfLayout.mjs'
import { checkPdfCompat } from './pdfCompat.mjs'
import { extractBlocks } from './pdfBlocks.mjs'
import { renderWithLayout, buildLayoutPage, layoutSheetCss } from './layoutRender.mjs'
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
  junkClass:       String,   // C10: junk-for-F1 class label (retail/food/labor/...) — non-null is hidden
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
  // A5 rubric inputs, produced by the same extract call. Stored so a cache hit
  // returns the whole rubric, not just the keyword lists.
  latestTitle:     String,
  yearsRequired:   Number,
  bulletRelevance: Number,
  // true / false from the core-role check, null when there was no title to compare.
  roleMatch:       { type: Boolean, default: null },
  // Job-ad phrases the extract refused to offer, shown on the tap screen so the
  // student sees why "production data incidents" is not a checkbox.
  dropped:         [String],
  kinds:           { type: Map, of: String },
  postingWork:     String,
  resumeWork:      String,
  createdAt: { type: Date, default: Date.now, expires: '30d' },
})
const AnalyzeCache = mongoose.model('AnalyzeCache', analyzeCacheSchema)

// Facts that belong to the RESUME, not to a resume+job pair. The extract call reads
// the latest title on every job, and one run in four returned "" for a resume that
// plainly has one. That empty title scored the core-role row as "unknown" and awarded
// the full 20. So the first good answer is kept per resume and reused whenever a
// later call comes back blank. Keyed on the resume hash: edit the resume, new key.
const resumeFactsSchema = new mongoose.Schema({
  key:         { type: String, unique: true },
  latestTitle: String,
  createdAt:   { type: Date, default: Date.now, expires: '90d' },
})
const ResumeFacts = mongoose.model('ResumeFacts', resumeFactsSchema)
function resumeFactsKey(resumeText) {
  return crypto.createHash('sha256').update(String(resumeText || '')).digest('hex')
}
// One question, one answer, once per resume. Asked inside the extract call (which
// is also ranking keywords and grading bullets) nano returned "" for this title two
// times in seven. Asked alone it does not. Cached on the resume hash.
async function latestTitleFor(resumeText) {
  const key = resumeFactsKey(resumeText)
  try {
    const facts = await ResumeFacts.findOne({ key }).lean()
    if (facts?.latestTitle) return facts.latestTitle
  } catch (e) { console.warn('resume facts read failed:', e.message) }
  let title = ''
  try {
    const reply = await askModel({
      model: MODEL_EXTRACT, maxTokens: 2000, reasoningEffort: 'minimal',
      messages: [{ role: 'user', content: `Below is a resume. What is the job title of the candidate's MOST RECENT role (the one with the latest start date, usually the first listed under experience)? Copy it exactly as the resume writes it. If the resume has no work history, answer with an empty string.\n\nRespond in this exact JSON format with no extra text:\n{"latestTitle": "<title or empty string>"}\n\nRESUME:\n${resumeText}` }],
    })
    const parsed = JSON.parse(reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    title = typeof parsed.latestTitle === 'string' ? parsed.latestTitle.trim().slice(0, 120) : ''
  } catch (e) {
    console.error('latestTitleFor: MODEL CALL FAILED, role row will be unknown:', e.message)
    return ''
  }
  if (title) {
    try { await ResumeFacts.updateOne({ key }, { $setOnInsert: { key, latestTitle: title, createdAt: new Date() } }, { upsert: true }) }
    catch (e) { console.warn('resume facts write failed:', e.message) }
  } else {
    console.warn('latestTitleFor: model found no title in this resume; role row will be unknown')
  }
  return title
}

// The key is a hash of both inputs, so any change to either produces a different key
// and a cache miss. A user editing their resume in Profile therefore does NOT get a
// stale result: the new resume text hashes differently and re-runs the model. This is
// the whole reason we hash the inputs rather than keying on something like a job id.
//
// Versioned. A5 added rubric fields to the extract result; a v1 hit would return the
// keyword lists with every rubric field undefined and the score would silently be
// built from half the inputs. Bumping the prefix makes every old entry a miss, and
// the 30-day TTL cleans them up. The job title is part of the key because the
// core-role check depends on it.
const ANALYZE_CACHE_VERSION = 'v10'  // v8: dropped phrases; v9: kinds + work one-liners; v10: 'X models' dedupe
function analyzeCacheKey(resumeText, jobText, jobTitle = '') {
  return ANALYZE_CACHE_VERSION + ':' + crypto.createHash('sha256')
    .update(resumeText + '\u0000' + jobText + '\u0000' + jobTitle).digest('hex')
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

  // The file the student actually uploaded, bytes and all. Until this existed the PDF
  // or Word document lived in memory for one request, had its text pulled out, and was
  // gone. Everything downstream — the optimizer, both download endpoints — worked from
  // that text, so every optimized resume came back in our template, and a student who
  // spent hours on their layout got it replaced. Keeping the file is what makes
  // giving it back in their own format possible at all.
  //
  // Two slots, because upload and save are separate steps. The upload endpoint reads
  // the file and returns the text for the student to check; nothing is saved until
  // they approve it in /me/profile. So the upload parks the file in `pending`, and
  // /me/profile promotes it to `resumeFile` only when the approved text came from that
  // same file. The guarantee that buys: `resumeFile` always matches `resumeText`.
  // A student who uploads, abandons, and later pastes text instead never ends up with
  // last month's PDF sitting next to this month's words.
  //
  // Stored in the document rather than object storage on purpose. Free tier is 512MB,
  // the jobs use ~36MB, a resume is 100-300KB: roughly 2,000 students before this is
  // a question worth revisiting. Excluded from every read that does not need it.
  resumeFile: {
    data:       { type: Buffer },
    name:       { type: String, default: '' },
    mime:       { type: String, default: '' },
    size:       { type: Number, default: 0 },
    uploadedAt: { type: Date },
  },
  pendingResumeFile: {
    data:       { type: Buffer },
    name:       { type: String, default: '' },
    mime:       { type: String, default: '' },
    size:       { type: Number, default: 0 },
    uploadedAt: { type: Date },
  },
  // A7: the resume's own layout, read from the PDF at upload (pdfLayout.mjs). Lines
  // with alignment, indents, font, bold/italic, size, links. Follows the file:
  // pending until the profile is confirmed, then promoted.
  resumeLayout:        { type: mongoose.Schema.Types.Mixed },
  pendingResumeLayout: { type: mongoose.Schema.Types.Mixed },
  // A7-S2: can the PDF be edited in place? { mode: 'surgical' | 'html', reason,
  // message, fonts[] } from pdfCompat.mjs. Independent of resumeLayout on purpose:
  // the surgical path does not need the pdfjs layout read to have succeeded.
  resumeCompat:        { type: mongoose.Schema.Types.Mixed },
  pendingResumeCompat: { type: mongoose.Schema.Types.Mixed },
  // A7-S3: the resume as blocks (pdfBlocks.mjs) — the units S4 rewrites and S5
  // replaces. ~120 KB for two pages, so it must NEVER be returned by /me/resume
  // (which the board calls on every load); it is read only by the optimize path.
  // Only extracted when compat.mode is 'surgical' — the html fallback doesn't use it.
  resumeBlocks:        { type: mongoose.Schema.Types.Mixed },
  pendingResumeBlocks: { type: mongoose.Schema.Types.Mixed },

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

// ── SAVED / HIDDEN JOBS (Tracker sections)
//
// Same snapshot principle as applications: the pipeline prunes postings on a
// 30-day window, so a saved job stored as a bare jobId would silently vanish
// from the tracker — the one thing a tracker must never do. The few snapshot
// fields keep the row readable (and the apply link clickable) after the prune.
//
// One row per (user, job): saving a hidden job un-hides it and vice versa.
// The two states are mutually exclusive on purpose — a job cannot sensibly be
// both "I want this later" and "never show me this".
const jobMarkSchema = new mongoose.Schema({
  clerkUserId: { type: String, index: true, required: true },
  jobId:       { type: String, required: true },
  state:       { type: String, enum: ['saved', 'hidden'], required: true },
  // Snapshot — must survive the job being pruned.
  title:       String,
  company:     String,
  location:    String,
  applyUrl:    String,
  postedAt:    Date,
  markedAt:    { type: Date, default: Date.now },
})
jobMarkSchema.index({ clerkUserId: 1, jobId: 1 }, { unique: true })
const JobMark = mongoose.models.JobMark || mongoose.model('JobMark', jobMarkSchema)

app.get('/me/job-marks', requireUser, async (req, res) => {
  try {
    const rows = await JobMark.find({ clerkUserId: req.userId }).sort({ markedAt: -1 }).lean()
    res.json({
      saved:  rows.filter(r => r.state === 'saved'),
      hidden: rows.filter(r => r.state === 'hidden'),
    })
  } catch (err) {
    console.error('GET /me/job-marks failed:', err)
    res.status(500).json({ error: 'Could not load your saved jobs.' })
  }
})

app.post('/me/job-marks', requireUser, async (req, res) => {
  try {
    const { jobId, state } = req.body || {}
    if (!jobId || !['saved', 'hidden'].includes(state)) {
      return res.status(400).json({ error: 'jobId and a valid state are required.' })
    }
    // Snapshot is taken server-side from the live posting — the client is not
    // trusted to describe the job it is saving.
    const job = await Job.findOne({ id: String(jobId) }).lean()
    if (!job) return res.status(404).json({ error: 'Job not found.' })
    await JobMark.updateOne(
      { clerkUserId: req.userId, jobId: String(jobId) },
      { $set: {
          state,
          title: job.title, company: job.company, location: job.location,
          applyUrl: job.applyUrl, postedAt: job.postedAt,
          markedAt: new Date(),
      } },
      { upsert: true }
    )
    res.json({ ok: true, state })
  } catch (err) {
    console.error('POST /me/job-marks failed:', err)
    res.status(500).json({ error: 'Could not save that job.' })
  }
})

app.delete('/me/job-marks/:jobId', requireUser, async (req, res) => {
  try {
    await JobMark.deleteOne({ clerkUserId: req.userId, jobId: String(req.params.jobId) })
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /me/job-marks failed:', err)
    res.status(500).json({ error: 'Could not update that job.' })
  }
})

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

// ── COMPANY BRANDING ─────────────────────────────────────────────────────────
// Logos live in the `companies` collection (built by enrichCompanies.mjs).
// ~5,900 small records, so the whole thing is held in memory and refreshed
// every 10 minutes — one query per TTL instead of a join on every board page.
// A job whose company has no record (brand-new company, or needs_review)
// gets no `brand` and the card renders its initials fallback; nothing breaks.
const Company = mongoose.models.Company || mongoose.model('Company', new mongoose.Schema({}, { strict: false, collection: 'companies' }))
let brandCache = { map: new Map(), at: 0 }
const BRAND_TTL_MS = 10 * 60 * 1000
async function getBrandMap() {
  if (Date.now() - brandCache.at > BRAND_TTL_MS) {
    const rows = await Company.find(
      { logoStatus: 'provider' },
      { ats: 1, slug: 1, officialDomain: 1, 'branding.logoUrl': 1, fallbackInitials: 1 }
    ).lean()
    const map = new Map()
    for (const r of rows) {
      map.set(`${r.ats}|${r.slug}`, {
        logoUrl: r.branding?.logoUrl || null,
        domain: r.officialDomain || null,
        initials: r.fallbackInitials || null,
      })
    }
    brandCache = { map, at: Date.now() }
  }
  return brandCache.map
}
function attachBrand(jobList, map) {
  for (const j of jobList) {
    const b = map.get(`${j.ats}|${j.companySlug}`)
    if (b) j.brand = b
  }
  return jobList
}

app.get('/', (req, res) => {
  res.json({ message: 'Resume Optimizer backend is running.' })
})

// ── ME / RESUME — the logged-in user's saved resume
app.get('/me/resume', requireUser, async (req, res) => {
  try {
    const userId = req.userId
    // The file buffers are excluded: this is called on every board load and a resume
    // PDF is a few hundred KB. There is a separate endpoint for the file itself.
    const user = await User.findOne({ clerkUserId: userId })
      // blocks: exclude the heavy array but keep the small header, so hasBlocks
      // below can still see that extraction happened
      .select('-resumeFile.data -pendingResumeFile.data -resumeBlocks.blocks -pendingResumeBlocks.blocks')
      .lean()
    res.json({
      hasResume:      Boolean(user?.resumeText),
      resumeText:     user?.resumeText     || '',
      resumeFileName: user?.resumeFileName || '',
      hasResumeFile:  Boolean(user?.resumeFile?.size),
      resumeLayout:   user?.resumeLayout || null,
      resumeCompat:   user?.resumeCompat || null,
      // blocks themselves are ~120 KB — the board never needs them; a boolean is enough
      hasBlocks:      Boolean(user?.resumeBlocks?.extractedAt),
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

// ── JUNK GUARD (A5 change 1) ───────────────────────────────────────────────
//
// "production data incidents" reached the checkbox list even though the prompt said
// "only concrete, checkable things". A prompt instruction is a suggestion. So the
// model now labels every entry with a kind, code drops the phrases, and this guard
// catches the ones it mislabels. A student is never asked "have you used
// stakeholder requirements?".
const JUNK_WORDS = /\b(incidents?|issues?|requirements?|stakeholders?|environments?|processe?s?|experience|ability|understanding|knowledge|skills?|practices?|principles?|concepts?|fundamentals?|best|strong|excellent|proven|curated|collaboration|cross-functional|capabilit(?:y|ies)|solutions?|workflows?|tasks?|activities|services?|systems?)\b/i
// Seen in real output: "Snowflake (data platform) specifically", "Cloud Platform
// emphasis on Snowflake + dbt", "data ingestion pipelines in Snowflake/dbt-centric
// stack". A parenthetical or one of these words means the model pasted a clause.
// A parenthetical is fine when it is an acronym, "(ADLS)"; it is a pasted clause when
// it holds words, "(data platform)".
const JUNK_SHAPE = /\((?![A-Z0-9]{2,8}\))|\b(specifically|emphasis|centric|stack|focus(?:ed)?|preferably|including)\b/i
const TITLE_NOUN = /\b(manager|engineer|analyst|developer|scientist|architect|director|specialist|consultant|administrator|coordinator)$/i
function looksLikeJunk(term) {
  const t = String(term || '').trim()
  const words = t.split(/\s+/)
  if (JUNK_SHAPE.test(t)) return true
  // "Product Manager" is a title, not a skill. Nobody can tap "I have used Product
  // Manager".
  if (words.length <= 4 && TITLE_NOUN.test(t)) return true
  // A multi-word term ending in a filler noun is a clause: "SAP solutions",
  // "stakeholder requirements", "Distribution & Transportation capabilities".
  if (words.length >= 2 && JUNK_WORDS.test(words[words.length - 1])) return true
  // Four or more words is a clause unless it is a product name, and product names are
  // Title Case: "Azure Data Lake Storage" keeps, "data ingestion pipelines in" drops.
  if (words.length >= 4) {
    const caps = words.filter(w => /^[A-Z0-9]/.test(w)).length
    return caps < words.length / 2
  }
  // A product token has a capital, a digit, or a symbol (dbt is the exception below).
  const hasProductToken = words.some(w => /[A-Z0-9.+#\/]/.test(w)) || /^(dbt|kafka|spark|airflow|snowflake|redshift|bigquery|databricks|terraform|docker|kubernetes|k8s)$/i.test(t)
  if (words.length === 3 && !hasProductToken && JUNK_WORDS.test(t)) return true
  return false
}
// "Snowflake" and "Snowflake (data platform) specifically" are one keyword. Dedupe on
// the base: parenthetical stripped, lowercased, trailing qualifier words removed.
function keywordBase(term) {
  return String(term || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(specifically|platform)\b/g, '').replace(/\s+/g, ' ').trim()
}
// "Glue" and "AWS Glue" are one skill; the posting said both and the resume said
// "Glue", so the student would have been asked to tap AWS Glue. The vendor prefix is
// stripped for comparison only. "GitHub" vs "GitHub Actions" is not a prefix case and
// stays as two skills.
const VENDOR_PREFIX = /^(aws|amazon|azure|microsoft|google|gcp|apache)\s+/
function keywordCore(term) {
  // "SQLMesh models" is SQLMesh; "dbt jobs" is dbt. Only when what is left is a
  // single token, so "data models" (a practice) stays itself.
  const core = keywordBase(term).replace(VENDOR_PREFIX, '')
  const m = core.match(/^(\S+)\s+(models?|pipelines?|jobs?|scripts?)$/)
  if (!m) return core
  // Only when the head looks like a product: "SQLMesh models" yes, "data models" no.
  const head = String(term || '').trim().split(/\s+/)[0]
  const productShaped = /[A-Z0-9]/.test(head) || /^(dbt|kafka|spark|airflow|snowflake|redshift|bigquery|databricks|terraform|docker|kubernetes|k8s|fivetran|airbyte)$/i.test(head)
  return productShaped ? m[1] : core
}

// ── CORE ROLE (A5 scoring law) ─────────────────────────────────────────────
//
// "Senior Data Engineer" and "Data Engineer II" are the same job. "Data Analyst" and
// "Data Engineer" are not, however many keywords overlap. Seniority words are
// stripped, then the cores are compared; equal or one-contains-the-other is a match
// with no model call ("azure data engineer" contains "data engineer"). Only a real
// disagreement asks the nano model a yes/no, and that answer is cached with the rest
// of the extract so it is paid for once per resume+job.
const SENIORITY_TOKENS = /\b(senior|sr|junior|jr|lead|staff|principal|associate|entry[- ]level|mid[- ]level|intern|internship|i|ii|iii|iv|1|2|3)\b/g
function coreRole(title) {
  return String(title || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[-–—,/|:]/g, ' ')
    .replace(SENIORITY_TOKENS, ' ')
    .replace(/\s+/g, ' ').trim()
}
// When the cores differ, the model does not get a yes/no it can wave through: it
// files each title under one family from this fixed list and code compares the two
// strings. The first version asked "same job family?" and nano said YES to Data
// Engineer vs Product Manager. Classification is harder to get wrong than agreement.
const ROLE_FAMILIES = [
  'data engineering', 'data analysis / BI', 'data science / ML', 'software engineering',
  'devops / infrastructure / SRE', 'security', 'QA / testing', 'product management',
  'project / program management', 'design / UX', 'sales', 'marketing', 'finance / accounting',
  'HR / recruiting', 'operations / supply chain', 'customer support', 'legal', 'healthcare',
  'education', 'other',
]
async function roleMatch(resumeTitle, jobTitle) {
  const a = coreRole(resumeTitle), b = coreRole(jobTitle)
  if (!a || !b) return null
  if (a === b || a.includes(b) || b.includes(a)) return true
  try {
    const reply = await askModel({
      // Budget covers nano's invisible reasoning tokens; 5 starved it and every call
      // came back empty and scored as "unknown". Same lesson as the extract call.
      model: MODEL_EXTRACT, maxTokens: 2000, reasoningEffort: 'minimal',
      messages: [{ role: 'user', content: `Classify each job title into exactly one family from this list:\n${ROLE_FAMILIES.map(f => '- ' + f).join('\n')}\n\nTitle A: ${resumeTitle}\nTitle B: ${jobTitle}\n\nRespond in this exact JSON format with no extra text:\n{"a": "<family>", "b": "<family>"}` }],
    })
    const cleaned = reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const fa = String(parsed.a || '').toLowerCase().trim()
    const fb = String(parsed.b || '').toLowerCase().trim()
    if (!fa || !fb) throw new Error('empty family in reply: ' + cleaned)
    const verdict = fa === fb
    console.log(`roleMatch: "${resumeTitle}" [${fa}] vs "${jobTitle}" [${fb}] -> ${verdict ? 'same family' : 'different'}`)
    return verdict
  } catch (e) {
    // Loud on purpose. Unknown awards the full 20, so a silent failure here inflates
    // every score for every job. If this line shows up in the logs, fix the call.
    console.error('roleMatch: MODEL CALL FAILED, scoring role as unknown (full credit):', e.message)
    return null
  }
}

// ── SCORE RUBRIC (A5 changes 4 + 5) ────────────────────────────────────────
//
// One function, one law, both screens. keywords 60 · core role 30 · years 10.
// Three rows, every one decided by code: a keyword is on the resume or it is not, the
// title matches or it does not, the years add up or they do not. Bullet relevance
// (2026-09-09 to 09-10) was the one row a model judged; it wobbled a point between
// runs, a student could not check it against their document, and a true match
// capped at 93. Dropped 2026-09-10 (Aravind): honest means checkable. The tap screen calls it with the skills tapped so far; the result
// screen calls it with the skills that landed; step 3's gate makes those the same set,
// so the preview and the delivery are the same number by construction.
//
// Missing data never penalizes. A posting that states no years is not asking for
// any; a resume with no title has nothing to mismatch; a grade the model failed to
// return is not a 1. Each such row is awarded in full and labelled so the modal can
// say why. The student cannot fix data we failed to read, so they are not charged
// for it.
function scoreRubric({ matched = [], missing = [], confirmed = [], roleMatch = null, resumeTitle = '', jobTitle = '', yearsRequired = null, expMonths = null }) {
  const total = matched.length + missing.length
  const have  = matched.length + confirmed.filter(k => missing.includes(k)).length
  const kwPts = total ? Math.round(60 * have / total) : 0

  const rolePts = roleMatch === false ? 0 : 30

  const haveYears = expMonths === null ? null : Math.round(expMonths / 12 * 10) / 10
  const yrPts = yearsRequired === null || haveYears === null ? 10 : (haveYears >= yearsRequired ? 10 : 0)

  return {
    total: kwPts + rolePts + yrPts,
    rows: {
      keywords: { pts: kwPts,   max: 60, have, total },
      role:     { pts: rolePts, max: 30, match: roleMatch, resumeTitle, jobTitle, note: roleMatch === null ? 'no title to compare' : null },
      years:    { pts: yrPts,   max: 10, required: yearsRequired, have: haveYears,
                  note: yearsRequired === null ? 'posting states no minimum' : haveYears === null ? 'could not read your dates' : null },
    },
  }
}

// ── PRESENT IS DECIDED IN CODE ─────────────────────────────────────────────
//
// Two runs of the extract on the same resume and posting disagreed on whether "dbt"
// was present. The model's `present` flag is the honesty gate: a skill marked present
// is never offered for tapping and the rewrite treats it as fact, so a false present
// is a fabrication with no checkbox in front of it. A false missing costs one tap.
// So the model proposes and this decides: present means the term literally appears
// in the resume. Punctuation is flattened on both sides ("CI/CD" ~ "ci cd") and a
// trailing plural is tolerated ("APIs" ~ "API"); nothing looser.
function flattenForMatch(text) {
  return ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '
}
function resumeHas(resumeFlat, term) {
  const t = flattenForMatch(term).trim()
  if (!t) return false
  // "AWS Glue" in the posting, "Glue" in the resume: same skill. Try the
  // vendor-stripped form as well (keywordCore is defined above).
  const core = flattenForMatch(keywordCore(term)).trim()
  if (core && core !== t && resumeHas(resumeFlat, core)) return true
  // Whole words only: "Java" must not match "JavaScript", "SQL" must not match
  // "sqlite". The only slack is a plural or gerund on the last word, so "APIs" finds
  // "API" and "data models" finds "data modeling".
  const stems = [t]
  if (t.endsWith('s') && t.length > 3) stems.push(t.slice(0, -1))
  for (const c of stems) {
    if (resumeFlat.includes(' ' + c + ' ')) return true
    if (resumeFlat.includes(' ' + c + 's ')) return true
    if (resumeFlat.includes(' ' + c + 'ing ')) return true
  }
  return false
}

// The model ignores "12 words"; cut at a word boundary, never mid-token, and drop a
// dangling separator.
function oneLiner(v, max = 100) {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  if (t.length <= max) return t
  return t.slice(0, max).replace(/\s+\S*$/, '').replace(/[;,:\-–—\s]+$/, '') + '…'
}

// jobTitle is optional: the standalone /optimize fallback path does not have it, and
// the core-role check then simply reports unknown.
async function extractKeywords(resumeText, jobText, jobTitle = '') {
  const cacheKey = analyzeCacheKey(resumeText, jobText, jobTitle)

  // Cache read is best-effort. If Mongo hiccups we must NOT fail the whole analyze,
  // so a lookup error just falls through to calling the model as normal.
  try {
    const hit = await AnalyzeCache.findOne({ key: cacheKey }).lean()
    if (hit) return {
      matchedKeywords: hit.matched,
      missingKeywords: hit.missing,
      latestTitle:     hit.latestTitle || '',
      yearsRequired:   typeof hit.yearsRequired === 'number' ? hit.yearsRequired : null,
      bulletRelevance: typeof hit.bulletRelevance === 'number' ? hit.bulletRelevance : null,
      roleMatch:       typeof hit.roleMatch === 'boolean' ? hit.roleMatch : null,
      dropped:         Array.isArray(hit.dropped) ? hit.dropped : [],
      kinds:           hit.kinds instanceof Map ? Object.fromEntries(hit.kinds) : (hit.kinds || {}),
      postingWork:     hit.postingWork || '',
      resumeWork:      hit.resumeWork || '',
    }
  } catch (e) {
    console.warn('analyze cache read failed:', e.message)
  }

  const prompt = `You are an ATS specialist.

You are screening ONE resume against ONE job posting. Work in this order and do not skip ahead.

STEP 1 — read the JOB POSTING below and list the 6-10 specific skills, technologies, tools, and qualifications IT screens for. Use the exact wording the posting uses (e.g. "PySpark", not "Spark"). This list comes from the posting only. Do not look at the resume yet. A list built from the resume is wrong: if every item you list turns out to be present in the resume, you read the wrong document.

Ignore generic filler. An ATS does not screen on "strong attention to detail", "good communication skills", "strong organizational skills", "team player", or "ability to work independently". Skip all of it. Only list concrete, checkable things: named technologies, named tools, named platforms, specific technical practices.

Label each entry with a kind:
- "tool": a named technology, product, platform, language, or library (dbt, Snowflake, PySpark, Terraform).
- "practice": a specific, nameable technical method someone can say they have done (data modeling, unit testing, CI/CD, dimensional modeling).
- "phrase": a duty or situation lifted from the posting that is not a skill anyone "has" (production data incidents, stakeholder requirements, cross-functional collaboration). A student cannot tick "I have used production data incidents". Label these honestly; they are dropped.

STEP 2 — now read the RESUME and mark each posting skill present or absent. Present means the resume actually names it.

STEP 3 — from the same read of both documents:
- yearsRequired: the minimum years of experience the POSTING asks for, as a whole number. null if the posting states no number. If it gives a range ("3-5 years") use the low end.
- postingWork: in at most 12 words, what this job's day-to-day work is, from the posting. Plain nouns, no adjectives ("production pipelines, governed metrics, self-serve data for analysts").
- resumeWork: in at most 12 words, what the candidate's day-to-day work has been, from the experience bullets ("Azure pipelines, validation and reconciliation, Spark tuning").
- bulletRelevance: an integer 1-5 grading how closely the WORK described in the resume's experience bullets matches the core duties of THIS POSTING. Judge the work, not the vocabulary: a bullet about building ELT pipelines is relevant to a pipeline job even if it never says "ELT". Calibration: 5 = the bullets describe this exact job; 4 = most of its duties; 3 = an adjacent role with real overlap (data engineer bullets for an analytics engineer posting); 2 = a different role that touches this one (data engineer bullets for a BI analyst posting); 1 = a different profession (data engineer bullets for a product manager or sales posting). A candidate whose whole history is in another job family cannot score above 2. Grade the bullets as written, not the summary.

JOB POSTING:
${jobText}

RESUME:
${resumeText}

Respond in this exact JSON format with no extra text:
{
  "keywords": [{"term": "<exact wording from the posting>", "kind": "tool|practice|phrase", "present": true|false}],
  "yearsRequired": <number or null>,
  "bulletRelevance": <1-5>,
  "postingWork": "<string>",
  "resumeWork": "<string>"
}`

  // One extract, optionally repeated. nano ignores "6-10": across four real jobs it
  // returned 2, 3, 4 and 12. Two keywords make the 40-point row a coin flip, so a
  // thin list gets one more try and the fuller result wins.
  const runExtract = async (nudge = '') => {
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
      messages: [{ role: 'user', content: prompt + nudge }],
    })
    const cleaned = replyText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Certifications are removed before the checkbox list is ever built. The box says
    // "Tap if you have", and next to Kubernetes that means "I have used this" while
    // next to VMCE it means "I passed this exam" — a claim a recruiter verifies in one
    // search. The two are indistinguishable in a list of chips, and the person who
    // wrote this product's anti-fabrication rule still ticked VMCE and VMCSE by
    // mistake. A student will not do better. So the option is not offered.
    // Same filter drops phrases: the model's label first, the code guard second.
    const entries = Array.isArray(parsed.keywords) ? parsed.keywords : []
    const usable = []
    const dropped = []
    const overclaimed = []
    const notInPosting = []
    const resumeFlat = flattenForMatch(resumeText)
    const jobFlat = flattenForMatch(jobText)
    for (const e of entries) {
      const term = String(e?.term || '').trim()
      if (!term) continue
      if (e.kind === 'phrase' || looksLikeJunk(term) || !keepAsSkill(term)) { dropped.push(term); continue }
      // The same literal test in the other direction. The prompt asks for the
      // posting's exact wording, so a term that is not in the posting did not come
      // from it: it came from the resume, which is the anchoring bug again. On a Data
      // Scientist posting the model listed Airflow, Kubernetes and Azure Data Factory,
      // all from the candidate's resume. Dropped, logged.
      if (!resumeHas(jobFlat, term)) { notInPosting.push(term); continue }
      const present = resumeHas(resumeFlat, term)
      if (e.present === true && !present) overclaimed.push(term)
      const twin = usable.find(u => keywordCore(u.term) === keywordCore(term))
      if (twin) {
        // Keep the longer wording, present if either form is in the resume.
        if (term.length > twin.term.length) twin.term = term
        twin.present = twin.present || present
        continue
      }
      usable.push({ term, present, kind: e.kind === 'practice' ? 'practice' : 'tool' })
    }
    if (dropped.length) console.log('extract: dropped ' + dropped.length + ' non-skill(s): ' + dropped.join(' | '))
    if (notInPosting.length) console.log('extract: model listed ' + notInPosting.length + ' term(s) NOT in the posting (resume-anchored), dropped: ' + notInPosting.join(' | '))
    if (overclaimed.length) console.log('extract: model said present, not in resume, moved to missing: ' + overclaimed.join(' | '))
    // nano lists 15 on a long posting despite "6-10". The model orders by importance,
    // so the tail is the least important; 12 is enough for a tap list and keeps one
    // skill worth more than 2 points.
    if (usable.length > 12) { console.log('extract: capped ' + usable.length + ' keywords to 12'); usable.length = 12 }
    return { parsed, usable, dropped }
  }
  let { parsed, usable, dropped } = await runExtract()
  if (usable.length < 5) {
    console.log('extract: only ' + usable.length + ' usable keyword(s), retrying once')
    try {
      const again = await runExtract('\n\nYour previous answer listed fewer than 5 concrete skills. Read the JOB POSTING again and list every named tool, technology, platform and technical practice it mentions, up to 10.')
      if (again.usable.length > usable.length) ({ parsed, usable, dropped } = again)
    } catch (e) {
      console.warn('extract: retry failed, keeping first result:', e.message)
    }
  }

  // Resume fact, not a resume+job fact. Own call, own cache.
  const latestTitle = await latestTitleFor(resumeText)

  const rel = Number(parsed.bulletRelevance)
  // 0 is the model's way of saying "not stated" (a real posting never asks for zero
  // years), so it is read as null and the years row is awarded like any silent JD.
  const yrs = parsed.yearsRequired === null || parsed.yearsRequired === undefined ? null : Number(parsed.yearsRequired)
  const result = {
    matchedKeywords: usable.filter(u => u.present).map(u => u.term),
    missingKeywords: usable.filter(u => !u.present).map(u => u.term),
    latestTitle,
    // Out-of-range or unparseable grades become null, and the scorer treats null as
    // "could not read" rather than as a zero. A missing figure beats a wrong one.
    bulletRelevance: Number.isInteger(rel) && rel >= 1 && rel <= 5 ? rel : null,
    yearsRequired:   Number.isFinite(yrs) && yrs >= 1 && yrs <= 30 ? Math.floor(yrs) : null,
    roleMatch:       null,
    // Only the phrase-shaped ones, not certifications: the cert filter is a different
    // honesty rule with its own explanation.
    dropped:         dropped.filter(t => !/^[A-Z0-9-]{3,8}$/.test(t)).slice(0, 6),
    // tool | practice per keyword, so the tap screen can group them.
    kinds:           Object.fromEntries(usable.map(u => [u.term, u.kind])),
    postingWork:     oneLiner(parsed.postingWork),
    resumeWork:      oneLiner(parsed.resumeWork),
  }
  result.roleMatch = await roleMatch(result.latestTitle, jobTitle)

  // Store for next time. upsert so a race between two identical requests cannot throw
  // a duplicate-key error. Best-effort again: a write failure must not fail the call
  // the user is waiting on, it just means the next identical click pays for the model.
  try {
    await AnalyzeCache.updateOne(
      { key: cacheKey },
      { key: cacheKey, matched: result.matchedKeywords, missing: result.missingKeywords,
        latestTitle: result.latestTitle, yearsRequired: result.yearsRequired,
        bulletRelevance: result.bulletRelevance, roleMatch: result.roleMatch, dropped: result.dropped,
        kinds: result.kinds, postingWork: result.postingWork, resumeWork: result.resumeWork, createdAt: new Date() },
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
  const { resumeText, jobText, jobTitle = '', yearsMin = null } = req.body
  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }
  try {
    const found = await extractKeywords(resumeText, jobText, String(jobTitle || ''))
    const { matchedKeywords, missingKeywords } = found
    const total = matchedKeywords.length + missingKeywords.length

    // The pipeline's yearsMin (parsed from the posting at fetch time) wins when it
    // exists; the model's read of the same posting is the fallback.
    const yearsRequired = Number.isFinite(Number(yearsMin)) && yearsMin !== null ? Number(yearsMin) : found.yearsRequired
    const inputs = {
      matched: matchedKeywords, missing: missingKeywords,
      roleMatch: found.roleMatch,
      resumeTitle: found.latestTitle, jobTitle: String(jobTitle || ''),
      yearsRequired, expMonths: totalExperienceMonths(resumeText),
    }
    const rubric = scoreRubric(inputs)
    // What the student reaches if they tap every missing skill. When role or years
    // mismatch this is below 100, and the modal says so instead of pretending.
    const maxScore = scoreRubric({ ...inputs, confirmed: missingKeywords }).total

    res.json({
      matchedKeywords,
      missingKeywords,
      // Old keyword-only score. The shipped modal still reads this; step 5 switches
      // it to rubric.total and this line goes.
      scoreBefore: total ? Math.round((matchedKeywords.length / total) * 100) : 0,
      rubric,
      maxScore,
      droppedPhrases: found.dropped || [],
      keywordKinds:   found.kinds || {},
      postingWork:    found.postingWork || '',
      resumeWork:     found.resumeWork || '',
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
// ── DATE LINES ARE COPIED, NEVER RESTRUCTURED (A7) ────────────────────────
//
// The rewrite moved "Jan 2024 – Present" from the title line onto the company line
// and turned the en dash into a hyphen. Neither is its job: employers, titles,
// locations and dates are the student's facts in the student's format. Every
// original line that carries a date range must reappear verbatim; if the model
// still moves one, code puts it back where it was.
const DATE_RANGE_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\s*[–—-]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present|current|now)\b|\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|present|current)\b/i
function dateLines(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(l => l && DATE_RANGE_RE.test(l) && l.length < 160)
}
function movedDateLines(out, original) {
  const have = new Set(String(out || '').split('\n').map(l => l.trim()))
  return dateLines(original).filter(l => !have.has(l))
}
// Put a moved/altered date line back. Finds the output line that is the same line
// minus the date range (the title or company text), replaces it with the original,
// and removes the date range from a neighbouring line it was moved onto.
function restoreDateLines(out, original) {
  let lines = String(out || '').split('\n')
  for (const L of movedDateLines(out, original)) {
    const range = (L.match(DATE_RANGE_RE) || [''])[0]
    const stem = L.replace(DATE_RANGE_RE, '').replace(/[\s|,–—-]+$/, '').replace(/^[\s|,–—-]+/, '').trim()
    if (!stem) continue
    const stemN = stem.toLowerCase()
    let idx = lines.findIndex(l => { const t = l.trim().toLowerCase(); return t === stemN || t.startsWith(stemN + ' ') || t.startsWith(stemN + ' |') || t === stemN.replace(/\s*\|.*$/, '') })
    if (idx === -1) idx = lines.findIndex(l => l.toLowerCase().includes(stemN))
    if (idx === -1) continue
    lines[idx] = L
    // the range usually got appended to the next or previous line: strip it there
    for (const j of [idx + 1, idx - 1]) {
      if (j < 0 || j >= lines.length || j === idx) continue
      if (DATE_RANGE_RE.test(lines[j]) && !dateLines(original).includes(lines[j].trim())) {
        lines[j] = lines[j].replace(new RegExp('\\s*[|,–—-]?\\s*' + range.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[–—-]/g, '[–—-]'), 'i'), '').replace(/\s*\|\s*$/, '').trimEnd()
      }
    }
  }
  return lines.join('\n')
}

function findBannedDashes(text) {
  const hits = []
  for (const line of String(text).split('\n')) {
    if (DATE_RANGE_RE.test(line)) continue   // "Jan 2024 – Present" keeps its dash
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
 * The summary keeps its SHAPE. The original had one paragraph; a rewrite returned the
 * same sentences on three lines, and the sheet showed three paragraphs. Sentence count
 * is gated elsewhere; this restores line structure: if the original summary was N
 * lines and the draft has more, the draft's lines are re-joined to N (one line → one
 * paragraph). Code, deterministic, no model call. Returns the whole text.
 */
function keepSummaryShape(optimized, original) {
  const find = text => {
    const m = String(text || '').match(/^[ \t]*(?:PROFESSIONAL\s+|EXECUTIVE\s+|CAREER\s+)?(?:SUMMARY|PROFILE|OBJECTIVE)[ \t]*:?[ \t]*$/mi)
    if (!m) return null
    const start = String(text).indexOf(m[0]) + m[0].length
    const after = String(text).slice(start)
    const nextHdr = after.search(/^[ \t]*[A-Z][A-Z\s&/]{2,39}:?[ \t]*$/m)
    const end = nextHdr === -1 ? String(text).length : start + nextHdr
    return { start, end, body: String(text).slice(start, end) }
  }
  const a = find(original), b = find(optimized)
  if (!a || !b) return optimized
  const aLines = a.body.split('\n').map(l => l.trim()).filter(Boolean)
  const bLines = b.body.split('\n').map(l => l.trim()).filter(Boolean)
  if (aLines.length === 0 || bLines.length <= aLines.length) return optimized
  // Re-join into as many lines as the original had: the extra breaks become spaces.
  const per = Math.ceil(bLines.length / aLines.length)
  const joined = []
  for (let i = 0; i < bLines.length; i += per) joined.push(bLines.slice(i, i + per).join(' '))
  return String(optimized).slice(0, b.start) + '\n' + joined.join('\n') + '\n' + String(optimized).slice(b.end)
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

// ── PLACEMENTS (A5 changes 2 + 3) ──────────────────────────────────────────
//
// The model reports where each confirmed skill went. Nothing it reports is trusted:
// a "bullet" placement stands only if its fragment is literally in the output and
// the fragment names the skill. Anything else is downgraded to "skills", which the
// modal shows as a card with no ✕, because there is no verified fragment to remove.
// A confirmed skill the model did not report at all gets a "skills" card too.
// Where a fragment actually sits, read off the document: the section it is under and
// the nearest company line (EXPERIENCE) or title line (PROJECTS) above it. The model's
// "employer" said "New York Life" for a fragment that was in a project bullet; the
// document is the only source that cannot be wrong about this.
function locateFragment(out, fragment) {
  const lines = out.split('\n')
  const idx = lines.findIndex(l => l.includes(fragment))
  if (idx === -1) return { section: '', context: '' }
  let section = ''
  let context = ''
  for (let i = idx - 1; i >= 0; i--) {
    const l = lines[i].trim()
    if (!l) continue
    if (RESUME_SECTIONS.test(l.replace(/[:：]\s*$/, ''))) { section = canonicalSection(l) || l.toUpperCase(); break }
    if (!context) {
      const isBullet = /^[•\-–▪*]/.test(l)
      if (!isBullet) {
        // Company line "New York Life Insurance | Manhattan, NY | Jan 2024 - Present" -> company.
        // Project title line "Enterprise Data Platform Modernization" -> the title.
        if (l.includes(' | ')) context = l.split(' | ')[0].trim()
        else if (/\b(19|20)\d{2}\b/.test(l)) context = l.replace(/[|,]?\s*\b\w{3,9}\.?\s+(19|20)\d{2}\b.*$/, '').trim() || l
        else context = l
      }
    }
  }
  return { section, context }
}

function verifyPlacements(raw, out, confirmed, skillsHeader) {
  const list = Array.isArray(raw) ? raw : []
  const outFlat = flattenForMatch(out)
  const result = []
  for (const skill of confirmed) {
    const p = list.find(x => x && typeof x.skill === 'string' && keywordCore(x.skill) === keywordCore(skill))
    const fragment = typeof p?.fragment === 'string' ? p.fragment.trim() : ''
    const employer = typeof p?.employer === 'string' ? p.employer.trim() : ''
    const inBullet = p?.where === 'bullet' && fragment && out.includes(fragment) && resumeHas(flattenForMatch(fragment), skill)
      // The fragment must sit on a bullet line, not in the skills section or summary.
      && out.split('\n').some(l => l.includes(fragment) && /^\s*[•\-–▪]/.test(l))
    if (inBullet) {
      const loc = locateFragment(out, fragment)
      // The label the card shows: "New York Life Insurance" under EXPERIENCE, or the
      // project's title under PROJECTS. Falls back to the model's word only when the
      // document gives nothing.
      const label = loc.context || employer
      const kind = loc.section === 'PROJECTS' ? 'project' : loc.section === 'EXPERIENCE' ? 'experience' : (loc.section || '').toLowerCase()
      result.push({ skill, where: 'bullet', employer: label, section: kind, fragment, removable: true })
    } else {
      if (p && p.where === 'bullet') console.warn('optimize: placement for "' + skill + '" claimed a bullet but the fragment did not verify; downgraded to skills')
      result.push({ skill, where: 'skills', employer: '', fragment: '', removable: false, present: resumeHas(outFlat, skill) })
    }
  }
  return result
}

// The lines of the student's skills section, so "is it in the skills section" is a
// question about that section and not about the whole document.
function skillsSectionText(out, skillsHeader) {
  const lines = out.split('\n')
  const headerRe = new RegExp('^\\s*' + skillsHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*$', 'i')
  const start = lines.findIndex(l => headerRe.test(l))
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (RESUME_SECTIONS.test(lines[i].trim().replace(/[:：]\s*$/, ''))) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n')
}

// Rule 7 last resort. Appends the skills to the first "Label: a, b, c" line inside
// the student's skills section. Their own category, their own line; only the list
// after the colon grows. If the section has no such line, the skills go on one
// plain line at the end of the section rather than under an invented label.
function appendToSkills(out, skills, skillsHeader) {
  const lines = out.split('\n')
  const headerRe = new RegExp('^\\s*' + skillsHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*$', 'i')
  const start = lines.findIndex(l => headerRe.test(l))
  if (start === -1) return out.trimEnd() + '\n' + skillsHeader + '\n' + skills.join(', ') + '\n'
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (RESUME_SECTIONS.test(lines[i].trim().replace(/[:：]\s*$/, ''))) { end = i; break }
  }
  // Which category line. "Programming Languages" is usually first and is the wrong
  // shelf for dbt or Looker; a catch-all label (Tools, Technologies, Platforms,
  // Other) is preferred, then the last line, never blindly the first.
  const catLines = []
  for (let i = start + 1; i < end; i++) {
    if (/^[A-Za-z][A-Za-z /&+-]{1,48}:\s+\S/.test(lines[i].trim())) catLines.push(i)
  }
  if (catLines.length) {
    const pick = catLines.find(i => /\b(tools?|technolog\w*|platforms?|other|misc\w*|additional|software|frameworks?)\b/i.test(lines[i].split(':')[0])) ?? catLines[catLines.length - 1]
    lines[pick] = lines[pick].replace(/\s*$/, '') + ', ' + skills.join(', ')
    return lines.join('\n')
  }
  lines.splice(end, 0, skills.join(', '))
  return lines.join('\n')
}

app.post('/optimize', async (req, res) => {
  const { resumeText, jobText, confirmedSkills = [], jobTitle = '', yearsMin = null, resumeLayout = null } = req.body
  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }

  try {
    // The rubric needs the extract's grade, title and years, so the extract is always
    // consulted. When the modal sent the same jobTitle it sent to /analyze this is a
    // cache hit and costs nothing; the standalone Resume Tool pays one nano call.
    const found = await extractKeywords(resumeText, jobText, String(jobTitle || ''))
    // Use the lists the modal already has when it sent them: those are the chips the
    // student saw and tapped, and a re-extract could rank a different ten.
    const matchedKeywords = Array.isArray(req.body.matchedKeywords) ? req.body.matchedKeywords : found.matchedKeywords
    const missingKeywords = Array.isArray(req.body.missingKeywords) ? req.body.missingKeywords : found.missingKeywords

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

    // The student's own section names, in the student's own order. Until this existed,
    // Rule 10 imposed a fixed layout (SUMMARY, SKILLS, EXPERIENCE, PROJECTS, EDUCATION)
    // and renamed every header to match, so a resume that led with EDUCATION and called
    // its skills TECHNICAL SKILLS came back rearranged into ours. Rule 4 said "preserve
    // the structure exactly" three paragraphs above, and Rule 10 overrode it every time.
    //
    // parseResume is the same detector the renderer uses, so the order asked for here is
    // an order the renderer can follow. Falls back to the old fixed layout only when
    // nothing is detected, which means the extraction gave us something unreadable.
    const parsedOriginal = parseResume(resumeText)
    const originalSections = parsedOriginal.bodyLines.filter(parsedOriginal.isSection)
      .map(s => s.toUpperCase().replace(/[:：]\s*$/, '').trim())
    const sectionOrder = originalSections.length
      ? originalSections.join(', ')
      : 'SUMMARY, SKILLS, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS'
    const skillsHeader = originalSections.find(s => canonicalSection(s) === 'SKILLS') || 'SKILLS'

    // The student's own skill category labels, in order, from the lines under their
    // skills header. "Programming Languages", "Streaming & Messaging", whatever they
    // wrote. Rule 8 used to merge these down to 5-6 and rename them, so a student with
    // six carefully named categories got back four with different names. Same
    // principle as section order: their layout, not ours. Empty when the skills section
    // is a flat list with no labels, in which case Rule 8 asks for a flat list back.
    const skillLabels = []
    {
      let inSkills = false
      for (const line of parsedOriginal.bodyLines) {
        if (parsedOriginal.isSection(line)) {
          inSkills = canonicalSection(line.toUpperCase().replace(/[:：]\s*$/, '').trim()) === 'SKILLS'
          continue
        }
        if (!inSkills || !line) continue
        const sk = parsedOriginal.isSkillLine(line)
        if (sk) skillLabels.push(sk.label)
      }
    }

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
- EXACTLY ONE SKILLS SECTION. The original calls it "${skillsHeader}". Keep that exact header, in its original position. Never rename it, never move it, never leave a second copy under another name. A resume with two skills sections is a structural defect, not extra coverage. If the original has no PROJECTS section, you do not create one. If it has no CERTIFICATIONS section, you do not add the header. Inventing a section is the single worst thing you can do here.
- SAME BULLETS, ONE FOR ONE. If a role has 28 bullets, your output has 28 bullets for that role. Never drop one. Never merge two into one. Never decide a bullet is weak and cut it — that judgement is not yours to make, and the work you would be deleting is real work the candidate actually did.
- SAME SUMMARY LENGTH. If the summary is three sentences, yours is three sentences. Rewrite the wording; never drop a sentence. A dropped summary sentence deletes real experience — one draft cut "developing AI-ready data products and integrating Generative AI use cases using Vertex AI" and replaced it with a list of tools from the posting. That is trading the candidate's true work for the employer's wish list, and it is forbidden.
- KEEP EVERY "Environment:" LINE VERBATIM. Some resumes end a role with "Environment: GCP, BigQuery, Airflow, ...". Reproduce that line exactly as written, under the same role. It is not filler — it is the densest keyword line in the document and an ATS reads every word of it. Never delete it, never reword it, never merge it into a bullet.
- SAME ROLES, SAME ORDER, SAME DATES, SAME EMPLOYERS.
- Rewrite the WORDING of each bullet to align with the posting. That is the whole job.
The candidate can delete a bullet themselves in one keystroke after they see it. They cannot recover one you deleted, because they no longer know what it said. When in doubt, keep it.

LENGTH IS THE CANDIDATE'S, NOT YOURS:
- A bullet comes back the length the candidate wrote it. Rewrite the wording to carry the posting's terms; never trim it to fit a line count. The words you would call "setup" are usually the how, and the how is the part an interviewer asks about.
- The SUMMARY keeps the SAME NUMBER OF SENTENCES as the original. Rewrite each sentence; never drop one and never add one. It states who they are and their strongest relevant skills. It is prose, not a keyword list: never let a sentence become a run of comma-separated product names.
- NEVER put a certification code in the summary or the skills section. VMCE, VMCSE, AWS SAA, PMP, CCNA and anything shaped like them are exam credentials, not tools. Claiming one the candidate does not hold is the single most checkable lie on a resume — a recruiter verifies it in one search. A certification appears ONLY inside a CERTIFICATIONS section that the original already had, and only if the original already listed it.
${yearsRule}
- THE RESUME ENDS AT ITS LAST SECTION. Do not append notes, commentary, a cover letter, a message to the employer, or anything written in the first person. Never write a sentence beginning "Note:" or containing "I". The output is a resume and nothing else.
- If the original does not have a projects section, do not create one. If it does, every project keeps every sentence it has; rewrite wording, never shorten. A three-sentence project description comes back as three sentences.
- Cut filler openers: "Responsible for", "Worked on", "Tasked with", "Helped to". Start bullets with the verb.
Change wording. Change nothing else.

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

═══ RULE 8 — SKILLS: THE STUDENT'S OWN CATEGORIES, UNCHANGED ═══
${skillLabels.length
  ? `The original organises its skills under these category labels, in this order: ${skillLabels.map(l => `"${l}"`).join(', ')}.
Reproduce EXACTLY these labels, in EXACTLY this order, with EXACTLY this wording and capitalisation. Do not merge two categories into one. Do not split one into two. Do not rename "Streaming & Messaging" to "Streaming and messaging". Do not reorder them by relevance. The student chose these names and this order; keeping them is the whole point.
A confirmed skill that belongs in the skills list goes into the EXISTING category it fits best. Only if none of their categories can honestly hold it do you add ONE new category line at the END, after all of theirs, with a plain label.`
  : `The original lists its skills without category labels. Output them the same way: a flat list, no labels added. Add confirmed skills to that list.`}

Each category is ONE line: the label, a colon, then the skills. Never split the label from its skills across lines. Keep every skill already listed under each label; add to them, never remove.
WITHIN each line, put the skills this posting asks for first, then the rest. The categories do not move and the labels do not change; only the order of the words after the colon. "Cloud Platforms: Azure, AWS, GCP" for an Azure role, "Cloud Platforms: AWS, Azure, GCP" for an AWS one. Same list, first thing the eye lands on is the relevant one.

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
- Section headers on their own line, in ALL CAPS, exactly as the original names them. Nothing else on that line. No punctuation.
- THE ORIGINAL'S SECTIONS, IN THE ORIGINAL'S ORDER, WITH THE ORIGINAL'S NAMES: ${sectionOrder}. Output them in that order and no other. If the original puts EDUCATION second, EDUCATION is second. If it calls the skills section "${skillsHeader}", that is its name. The candidate chose this layout and it is not yours to improve.
- A job title goes on its own line in Title Case (e.g. "Senior Azure Data Engineer"). Do NOT put it in ALL CAPS — ALL CAPS is only for section headers.
- The line under a job title is the company, location, and dates joined with " | ", exactly: "Company Name | City, ST | Jan 2024 - Present".
- Bullets start with "- " (a hyphen and a space). One bullet per line.
- Skills use the inline category format from Rule 8: "Label: skill, skill, skill" — one category per line.
- Do not use markdown (no ##, no **bold**, no backticks). Plain text only.

Resume:
${resumeText}

Job Description:
${jobText}

═══ RULE 11b — DATE LINES ARE COPIED, NOT EDITED ═══
Every line of the original that contains a date or date range (a job title with dates, a company line with dates, a degree line with a date) is copied character for character: same line, same order, same dash, same spacing. Never move a date from one line to another. Never reformat "Jan 2024 – Present".

═══ RULE 12 — REPORT EVERY PLACEMENT, EXACTLY ═══
For EACH confirmed skill, one entry in "placements". If it went into a bullet: "where" is "bullet", "employer" is the company name of that role exactly as written, and "fragment" is the exact clause you added to that bullet, copied character for character from your own optimizedResume (so it can be found there and removed if the candidate disagrees). If it went into the skills section only: "where" is "skills", and "fragment" is the skill as you wrote it in the skills line. A skill placed in both gets ONE entry, the bullet one. Never report a placement you did not actually make.

Respond in this exact JSON format with no extra text:
{
  "feedback": "<${confirmed.length ? '2-3 sentences: what you added and where. If any confirmed skill ended up in the skills section ONLY, name it and say plainly: be ready to speak to where you used it, because your experience bullets do not show it.' : '1-2 sentences: what you reframed. The candidate confirmed NO new skills, so do not mention confirmed skills, additions, or the skills section.'}>",
  "placements": [{"skill": "<confirmed skill, exactly as given>", "where": "bullet|skills", "employer": "<company or empty>", "fragment": "<exact text from optimizedResume>"}],
  "changes": ["<2-4 short items, one line each, plain past tense, what you changed and where: e.g. 'Summary reframed toward production pipelines — same facts, this job's words'>"],
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
      // Rule 7 in code. The prompt says "never silently disappear"; the model still
      // dropped confirmed skills, the result score counted only what landed, and the
      // tap screen's promise was broken. Now a missing confirmed skill is a gate
      // violation like any other.
      const outFlat = flattenForMatch(out)
      const dropped7 = confirmed.filter(k => !resumeHas(outFlat, k))
      const movedDates = movedDateLines(out, resumeText)
      if (!invented.length && !dashes.length && !pastT.length && !stray.length && !newSecs.length && !lost
          && !sumCut && !envGone.length && !certs.length && !merged.length && !dropped7.length && !movedDates.length) break
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
        // Rule 7 last resort: the model would not carry the skill, so the code does,
        // into the first category line of the student's own skills section. The tap
        // screen promised this skill would be on the resume; that promise is kept here
        // or the score above it is a lie.
        if (dropped7.length) {
          out = appendToSkills(out, dropped7, skillsHeader)
          console.warn('optimize gate: code-appended to skills: ' + dropped7.join(', '))
        }
        console.warn('optimize gate unresolved after retries: invented=' + invented.length + ' dashes=' + dashes.length + ' pastTense=' + pastT.length + ' stray=' + stray.length + ' newSections=' + newSecs.length + ' bulletsLost=' + (lost ? lost.before + '->' + lost.after : 'no') + ' summaryCut=' + (sumCut ? sumCut.before + '->' + sumCut.after : 'no') + ' envDropped=' + envGone.length + ' certs=' + certs.length + ' merged=' + merged.length + ' confirmedDropped=' + dropped7.length)
        break
      }
      console.warn('optimize gate retry ' + (attempt + 1) + ': invented=' + invented.length + ' dashes=' + dashes.length + ' pastTense=' + pastT.length + ' stray=' + stray.length + ' newSections=' + newSecs.length + ' bulletsLost=' + (lost ? lost.before + '->' + lost.after : 'no') + ' summaryCut=' + (sumCut ? sumCut.before + '->' + sumCut.after : 'no') + ' envDropped=' + envGone.length + ' certs=' + certs.length + ' merged=' + merged.length + ' confirmedDropped=' + dropped7.length)
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
      if (movedDates.length) {
        corrections += '\nDATE LINES CHANGED. These lines from the original carry dates and must appear EXACTLY as written, same line, same order, same dash character:\n' + movedDates.map(l => '  - "' + l + '"').join('\n') + '\nDo not move a date onto another line or change its punctuation.\n'
      }
      if (dropped7.length) {
        corrections += '\nDROPPED CONFIRMED SKILLS. The candidate confirmed these and your draft does not contain them anywhere:\n' + dropped7.map(k => '  - "' + k + '"').join('\n') + '\nEach one must appear: reframe an existing bullet if the candidate\'s own work supports it, otherwise add it to the fitting category line in the skills section. Report each in "placements".\n'
      }
      if (pastT.length) {
        corrections += '\nTENSE. Your CURRENT role (its dates end in "Present") must be present tense throughout. These bullets open in PAST tense:\n' + pastT.map(l => '  - "' + l + '"').join('\n') + '\nRewrite each opening verb to present tense (Managed to Manage, Led to Lead, Built to Build, Optimized to Optimize). If a flagged word is actually an adjective or already present tense, leave it unchanged.\n'
      }
      messages.push({ role: 'assistant', content: replyText })
      messages.push({ role: 'user', content: corrections })
    }

    // Every confirmed skill is in the text now: the gate retried until it was, or
    // appended it. landed is computed anyway so the log shows if that ever fails.
    const finalFlat = flattenForMatch(out)
    const landed = confirmed.filter(k => resumeHas(finalFlat, k))
    if (landed.length !== confirmed.length) console.error('optimize: RULE 7 BROKEN after gate, missing: ' + confirmed.filter(k => !landed.includes(k)).join(', '))

    // The card says "Skills section + your <employer> bullet". The model wove dbt,
    // Looker and Superset into a bullet and never touched the skills section, so the
    // card lied. Now the skills-section half is done in code for every confirmed
    // skill the model left out of it: a plain string append to the student's own
    // category line, the same last resort Rule 7 already uses.
    out = keepSummaryShape(out, resumeText)
    // Dates back where the student put them, every time, model cooperation or not.
    const movedFinal = movedDateLines(out, resumeText)
    if (movedFinal.length) { out = restoreDateLines(out, resumeText); console.warn('optimize: restored ' + movedFinal.length + ' date line(s) by code') }

    const notInSkills = confirmed.filter(k => !resumeHas(flattenForMatch(skillsSectionText(out, skillsHeader)), k))
    if (notInSkills.length) {
      out = appendToSkills(out, notInSkills, skillsHeader)
      console.log('optimize: added to skills section by code (model placed in bullets only): ' + notInSkills.join(', '))
    }

    const placements = verifyPlacements(parsed.placements, out, confirmed, skillsHeader)

    const total = matchedKeywords.length + missingKeywords.length
    const scoreBefore = total ? Math.round((matchedKeywords.length / total) * 100) : 0
    const scoreAfter = total ? Math.round(((matchedKeywords.length + landed.length) / total) * 100) : 0

    // Same rubric as /analyze, scored on what landed. Until step 3's gate makes
    // landed === confirmed, this can come in under the tap-screen preview; that gap
    // is the A5-4 bug and step 3 closes it.
    const yearsRequired = Number.isFinite(Number(yearsMin)) && yearsMin !== null ? Number(yearsMin) : found.yearsRequired
    const rubricAfter = scoreRubric({
      matched: matchedKeywords, missing: missingKeywords, confirmed: landed,
      roleMatch: found.roleMatch,
      resumeTitle: found.latestTitle, jobTitle: String(jobTitle || ''),
      yearsRequired, expMonths,
    })

    res.json({
      matchedKeywords,
      missingKeywords,
      addedKeywords: landed,
      feedback: (parsed.feedback || '') + gateNote,
      optimizedResume: out,
      scoreBefore,
      scoreAfter,
      score: scoreBefore,   // keeps the existing Resume Tool working
      rubricAfter,
      // A5-2/3: one card per confirmed skill. where=bullet carries a code-verified
      // fragment the modal can remove with ✕; where=skills has nothing to remove.
      placements,
      // v2 modal: the sheet is rendered by the same code the PDF uses, so what the
      // student sees on screen is what downloads. Body markup only.
      optimizedHtml: resumeLayout ? renderWithLayout(out, resumeLayout).body : resumeBodyHtml(out, 'times'),
      sheet: resumeLayout ? layoutSheetCss(resumeLayout) : null,
      changes: Array.isArray(parsed.changes) ? parsed.changes.map(c => String(c).trim()).filter(Boolean).slice(0, 5) : [],
    })
  } catch (error) {
    console.error('AI API error:', error)
    if (error.status === 401) return res.status(401).json({ error: 'Invalid API key.' })
    if (error.status === 402) return res.status(402).json({ error: 'No API credits remaining.' })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ── COVER LETTER (A6) ──────────────────────────────────────────────────────
//
// Lazy: the modal calls this only when the Cover letter tab is opened, so a student
// who never wants one never pays for one. Resume-facts-only, enforced the same way
// the optimizer is: the model is told the rules, and then code checks the output.
//
// What code can check in prose: (1) a skill from the posting the candidate did NOT
// confirm appearing in the letter is a claim they never made; (2) a long run of the
// posting's own words is the letter parroting the ad; (3) dashes are house style.
// (1) and (2) get a correction round; the last resort for (1) cuts the sentence.

// Longest run of consecutive words shared between two texts, in words.
function longestSharedRun(a, b, minRun = 10) {
  const wa = flattenForMatch(a).trim().split(' ')
  const wb = flattenForMatch(b).trim().split(' ')
  const grams = new Set()
  for (let i = 0; i + minRun <= wb.length; i++) grams.add(wb.slice(i, i + minRun).join(' '))
  const hits = []
  for (let i = 0; i + minRun <= wa.length; i++) {
    const g = wa.slice(i, i + minRun).join(' ')
    if (grams.has(g)) hits.push(g)
  }
  return hits
}

function sentencesMentioning(text, terms) {
  const out = []
  for (const sent of String(text).split(/(?<=[.!?])\s+/)) {
    const f = flattenForMatch(sent)
    const hit = terms.find(t => resumeHas(f, t))
    if (hit) out.push({ sentence: sent.trim(), term: hit })
  }
  return out
}

app.post('/cover-letter', async (req, res) => {
  const { resumeText, jobText, jobTitle = '', company = '', confirmedSkills = [], missingKeywords = [], optimizedResume = '' } = req.body
  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }
  try {
    const facts = String(optimizedResume || resumeText)
    const confirmed = (Array.isArray(confirmedSkills) ? confirmedSkills : []).map(String)
    // Posting skills the candidate did not confirm. If the letter names one, it is
    // claiming something the candidate never said. This is the fabrication check.
    const unconfirmed = (Array.isArray(missingKeywords) ? missingKeywords : []).map(String)
      .filter(k => !confirmed.some(c => keywordCore(c) === keywordCore(k)))
    const expMonths = totalExperienceMonths(resumeText)
    const expYears = expMonths === null ? null : Math.floor(expMonths / 12)

    const basePrompt = `You are writing a cover letter for a real person applying to a real job. It will be read by a recruiter who will also read the resume, so anything the letter claims that the resume does not support ends the application.

═══ THE ONLY FACTS YOU MAY USE ═══
The resume below, and this list of skills the candidate has confirmed they have used: ${confirmed.length ? confirmed.join(', ') : '(none)'}.
Every sentence about the candidate must trace back to the resume or that list. No projects, employers, results, numbers, tools or traits that are not there. Do not guess at motivation ("I have long admired..."). Do not describe the company beyond what the posting says.
${expYears === null ? 'Do not state a number of years of experience.' : `If you state years of experience it must be "${expYears}+ years".`}
${unconfirmed.length ? `The posting also asks for these, and the candidate has NOT confirmed them, so the letter must not mention them at all: ${unconfirmed.join(', ')}.` : ''}

═══ FORM ═══
- 3 or 4 short paragraphs, 180 to 260 words total. No greeting line, no sign-off line, no addresses, no date: the letter body only.
- Paragraph 1: which role at which company, and in one sentence why this person fits, using the resume's own facts.
- Middle: two or three concrete things from the resume that match what the posting asks for. Name the tool or practice the posting names, only where the resume or the confirmed list actually has it. Reuse the resume's facts; do not reuse the posting's sentences.
- Last: one plain closing sentence.
- Plain voice. No "I am writing to express my interest". No "passionate", "dynamic", "leverage", "synergy", "spearheaded". No exclamation marks. No em-dashes or en-dashes; use commas and full stops.
- Write as the candidate, first person. Their name is not needed anywhere in the body.
- Never use the words "confirmed", "checkbox", "posting", "resume" or "job description" in the letter. Those are our words, not the candidate's.

Role: ${jobTitle || '(see posting)'}
Company: ${company || '(see posting)'}

RESUME:
${facts}

JOB POSTING:
${jobText}

Respond in this exact JSON format with no extra text:
{
  "coverLetter": "<the letter body, paragraphs separated by a blank line>"
}`

    const messages = [{ role: 'user', content: basePrompt }]
    let letter = ''
    let stripped = []
    for (let attempt = 0; attempt <= 2; attempt++) {
      const replyText = await askModel({ model: MODEL_REWRITE, maxTokens: 6000, reasoningEffort: 'low', messages })
      const parsed = JSON.parse(replyText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      letter = String(parsed.coverLetter || '').trim()
      // Dashes are house style and deterministic: fixed here, never retried.
      letter = letter.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s--\s/g, ', ')
      // Our vocabulary must not reach a recruiter. The prompt says so; the model still
      // wrote "confirmed experience using SEO" twice. Deterministic, so done in code.
      // Only runs of spaces are collapsed. \s{2,} here ate the blank lines between
      // paragraphs and shipped a 196-word wall of text.
      letter = letter.replace(/\b(confirmed|checkbox)\s+/gi, '').replace(/[ \t]{2,}/g, ' ')

      const claims = sentencesMentioning(letter, unconfirmed)
      const copied = longestSharedRun(letter, jobText)
      if (!claims.length && !copied.length) break
      if (attempt === 2) {
        // Last resort: a sentence claiming an unconfirmed skill is cut. A shorter
        // letter beats a letter that lies.
        for (const c of claims) letter = letter.replace(c.sentence, '').replace(/[ \t]{2,}/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim()
        stripped = claims.map(c => c.term)
        console.warn('cover-letter gate unresolved: stripped ' + claims.length + ' sentence(s) claiming ' + stripped.join(', ') + '; copied runs left: ' + copied.length)
        break
      }
      console.warn('cover-letter gate retry ' + (attempt + 1) + ': unconfirmedClaims=' + claims.length + ' copiedRuns=' + copied.length)
      let corrections = 'Your draft breaks the rules below. Fix ONLY these and return the same JSON format. Keep everything else as it is.\n'
      if (claims.length) corrections += '\nUNCONFIRMED SKILLS. These sentences name skills from the posting that the candidate has NOT confirmed and the resume does not contain:\n' + claims.map(c => '  - "' + c.sentence + '"  (names: ' + c.term + ')').join('\n') + '\nRewrite each sentence without that skill, or delete it. The candidate never claimed it.\n'
      if (copied.length) corrections += '\nCOPIED FROM THE POSTING. These runs of ten or more words are lifted from the job ad:\n' + copied.slice(0, 3).map(g => '  - "' + g + '"').join('\n') + '\nSay it in the candidate\'s own words, from the resume\'s facts, or leave it out.\n'
      messages.push({ role: 'assistant', content: replyText })
      messages.push({ role: 'user', content: corrections })
    }

    res.json({
      coverLetter: letter,
      letterHtml: letterBodyHtml(facts, letter, 'times', company),
      wordCount: letter.split(/\s+/).filter(Boolean).length,
      strippedSkills: stripped,
    })
  } catch (error) {
    console.error('Cover letter error:', error)
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
      // Park the file before reading it. If extraction fails the student may retry with
      // a different file, and this is simply overwritten. It is promoted to resumeFile
      // only when /me/profile receives approved text carrying this same file name.
      await User.updateOne(
        { clerkUserId: req.userId },
        { $set: { pendingResumeFile: {
          data:       req.file.buffer,
          name:       req.file.originalname,
          mime:       req.file.mimetype || '',
          size:       req.file.size,
          uploadedAt: new Date(),
        } } },
        { upsert: true },
      )

      const { text, pages, method } = await extractText(req.file.buffer, req.file.originalname)
      const assessment = assessExtraction(text)

      // A7: layout beside the text. PDF only for now; a failure here never blocks the
      // upload — the resume then renders in the default layout.
      let layout = null
      let compat = null
      let blocks = null
      if (/\.pdf$/i.test(req.file.originalname || '') || req.file.mimetype === 'application/pdf') {
        try { layout = await readPdfLayout(req.file.buffer) } catch (e) { console.warn('pdf layout read failed:', e.message) }
        // A7-S2: surgical or fallback, decided once here. checkPdfCompat never throws
        // on a bad file (it returns mode 'html' with a reason); the catch is for mupdf
        // itself failing to load.
        try { compat = checkPdfCompat(req.file.buffer) } catch (e) { console.warn('pdf compat check failed:', e.message) }
        if (compat) console.log(`pdf compat: ${compat.mode}${compat.reason ? ' (' + compat.reason + ': ' + compat.detail + ')' : ''} · ${compat.creator || ''}`)
        // A7-S3: blocks only make sense when the PDF will be edited in place
        if (compat?.mode === 'surgical') {
          try {
            blocks = extractBlocks(req.file.buffer)
            console.log(`pdf blocks: ${blocks.blocks.length} (${blocks.blocks.filter(b => b.editable).length} editable) · ${Math.round(JSON.stringify(blocks).length / 1024)} KB`)
          } catch (e) { console.warn('pdf block extraction failed:', e.message) }
        }
      }
      const pendSet = {
        ...(layout ? { pendingResumeLayout: layout } : {}),
        ...(compat ? { pendingResumeCompat: compat } : {}),
        ...(blocks ? { pendingResumeBlocks: blocks } : {}),
      }
      const pendUnset = {
        ...(layout ? {} : { pendingResumeLayout: 1 }),
        ...(compat ? {} : { pendingResumeCompat: 1 }),
        ...(blocks ? {} : { pendingResumeBlocks: 1 }),
      }
      await User.updateOne({ clerkUserId: req.userId }, {
        ...(Object.keys(pendSet).length ? { $set: pendSet } : {}),
        ...(Object.keys(pendUnset).length ? { $unset: pendUnset } : {}),
      })

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
        // A7-S2: the fallback sentence, if any, so the client can show it at upload
        compat: compat ? { mode: compat.mode, reason: compat.reason, message: compat.message } : null,
      })
    } catch (error) {
      console.error('Resume upload error:', error)
      res.status(500).json({ error: 'Could not read that file. Please try another, or paste the text instead.' })
    }
  })
})

// ── ME / RESUME FILE — the original upload, bytes intact
// Separate from /me/resume so the board's every-load call stays small. This is only
// hit when something needs the actual document: a "download my original" button, or
// the formatting path that rebuilds the optimized resume inside the student's own file.
app.get('/me/resume-file', requireUser, async (req, res) => {
  try {
    const user = await User.findOne({ clerkUserId: req.userId })
      .select('resumeFile')
      .lean()
    const f = user?.resumeFile
    if (!f?.data) return res.status(404).json({ error: 'No original file on record.' })
    const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data.buffer || f.data)
    res.setHeader('Content-Type', f.mime || 'application/octet-stream')
    res.setHeader('Content-Length', buf.length)
    res.setHeader('Content-Disposition', `attachment; filename="${(f.name || 'resume').replace(/"/g, '')}"`)
    res.send(buf)
  } catch (error) {
    console.error('Get resume file error:', error)
    res.status(500).json({ error: 'Failed to load your file. Please try again.' })
  }
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
    ).select('-resumeFile.data -pendingResumeFile.data').lean()

    // Promote the parked file if the text being saved came from it. The client sends
    // resumeFileName from the upload response, so a match means "this text is what we
    // extracted from that file". No match — they pasted text, or uploaded twice and
    // approved the first — and the stored file would not correspond to the stored
    // text, so it is cleared rather than kept wrong. A file we cannot trust to match
    // the words is worse than no file: the formatting path would rebuild their
    // resume from the wrong layout.
    const fileName = str(resumeFileName)
    const pending = await User.findOne({ clerkUserId: req.userId })
      .select('pendingResumeFile')
      .lean()
    const parked = pending?.pendingResumeFile
    if (fileName && parked?.data && parked.name === fileName) {
      const pl = await User.findOne({ clerkUserId: req.userId }).select('pendingResumeLayout pendingResumeCompat pendingResumeBlocks').lean()
      const setDoc = { resumeFile: parked }
      if (pl?.pendingResumeLayout) setDoc.resumeLayout = pl.pendingResumeLayout
      if (pl?.pendingResumeCompat) setDoc.resumeCompat = pl.pendingResumeCompat
      if (pl?.pendingResumeBlocks) setDoc.resumeBlocks = pl.pendingResumeBlocks
      await User.updateOne(
        { clerkUserId: req.userId },
        { $set: setDoc, $unset: {
          pendingResumeFile: 1, pendingResumeLayout: 1, pendingResumeCompat: 1, pendingResumeBlocks: 1,
          ...(pl?.pendingResumeLayout ? {} : { resumeLayout: 1 }),
          ...(pl?.pendingResumeCompat ? {} : { resumeCompat: 1 }),
          ...(pl?.pendingResumeBlocks ? {} : { resumeBlocks: 1 }),
        } },
      )
    } else {
      await User.updateOne(
        { clerkUserId: req.userId },
        { $unset: { resumeFile: 1, pendingResumeFile: 1, resumeLayout: 1, pendingResumeLayout: 1, resumeCompat: 1, pendingResumeCompat: 1, resumeBlocks: 1, pendingResumeBlocks: 1 } },
      )
    }

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
    // C10 (2026-09-04): jobs that pass every visa gate but are useless to an
    // F1 student — store staff, food service, trade labor — carry a junkClass
    // label (set by applyJunk.mjs on the back catalogue; fetchers at the door).
    // $exists:false, same logic as needsLicense's $ne: the untagged back
    // catalogue stays visible. Reversible: unset the field and the job returns.
    filter.junkClass = null   // matches null AND missing: fetchers write the label or explicit null every cycle

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
      salaryMin: 1, salaryMax: 1, yearsMin: 1, yearsMax: 1, closed: 1, ats: 1,
    }

    // Grouping is done in Node (see groupDuplicates below) rather than with a $group
    // stage: this collection is large enough that a full-collection $group/$sort blows
    // MongoDB's in-memory aggregation caps on this Atlas tier. Duplicate postings sort
    // next to each other (same company, same title, same timestamp), so folding them
    // within the fetched page catches effectively all of them at a fraction of the cost.
    // Trade-off: a job whose locations straddle a page boundary can still appear twice.
    // Company names arrive in variants — "Exadel" vs "Exadel Inc (Website)" — and
    // titles arrive with stray whitespace ("Senior Data Engineer " vs no trailing
    // space). Raw-lowercase keys treated all of these as different jobs, so the
    // fold missed exactly the postings most likely to be duplicates. The key now
    // strips parentheticals, legal suffixes (Inc/LLC/Ltd/...), punctuation, and
    // collapses whitespace. Display still shows the ORIGINAL name — only the
    // grouping key is normalized.
    function normalizeCompanyKey(name = '') {
      return name
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|gmbh|plc|website)\b\.?/g, ' ')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }
    function groupDuplicates(rows) {
      const out = []
      const byKey = new Map()
      for (const j of rows) {
        const title = (j.title || '').toLowerCase().replace(/\s+/g, ' ').trim()
        const key = `${title}|||${normalizeCompanyKey(j.company)}`
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
      //   +400  title is exactly the phrase
      //   +300  company name contains the whole phrase (a company search)
      //   +250  every core word in the title as a whole word
      //   +200  every core word in the title in any form
      //   +100  title contains the whole phrase ("Data Engineer")
      //   +60   title STARTS with the phrase (the most on-the-nose match)
      //   +10   per individual word found in the title
      // A company matching only a single word scores 0 and sinks to the bottom.
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
        // The whole query is a company name. Sits above every partial title match and
        // below an exact title: a student who typed "Bridgeway Benefit Technologies" was
        // seeing that company's one job at the bottom, under a Surgery Scheduler that
        // matched the word "benefits". Whole-word bounded so "Asana" does not fire on
        // "Asanaworks". Single-word company hits still score 0 — "data" appearing in a
        // company name is not what anyone searching "data engineer" is after.
        { $cond: [{ $regexMatch: { input: { $ifNull: ['$company', ''] }, regex: '(^|[^a-z0-9])' + phrase + '([^a-z0-9]|$)', options: 'i' } }, 300, 0] },
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
      // `id` last: jobs batch-posted in one fetch tie on every other key, and MongoDB
      // returns ties in UNSTABLE order across page requests — the same job appeared
      // on page 1 AND page 2 of the board (seen live: Ramp "TLM, Production
      // Engineering", one row in Mongo, two cards on screen). A unique tiebreaker
      // makes skip/limit pagination deterministic.
      sortStage = { _tier: -1, _day: -1, _score: -1, postedAt: -1, id: 1 }
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
      sortStage = { postedAt: -1, id: 1 }
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

    attachBrand(jobs, await getBrandMap())

    // Whether anything on this page actually matched what they typed.
    //
    // The $or built from `words` admits a job that matched a SINGLE word, which is what
    // makes "data engineer" also find "Data Platform Engineer" — worth keeping. The cost
    // shows up on a search with no real match: "Bridgeway Benefit Technologies" returned
    // a Surgery Scheduler role (title contains "benefits") and a Benefits Manager at
    // Asana, presented as though they were results for that company.
    //
    // The test is the SAME one the ranking uses for tier 2 — every core word present in
    // the title as a whole word — plus the full phrase in a company name, which covers a
    // company search. It has to be the same rule: a first attempt required the literal
    // phrase in the title, and "senior data engineer" then had no match at all and lit
    // the banner on an ordinary search. `tierWords` already has seniority words stripped,
    // so "senior" is not required to appear anywhere.
    //
    // Whole-word, not substring: "benefits" must not satisfy "benefit", or the Surgery
    // Scheduler row counts as a match and nothing is caught.
    //
    // Costs one extra count per typed search, and only a typed one — the target-role
    // ranking hint (`role`) is not a search and must never trigger this.
    let weakMatch = false
    if (searched && jobs.length) {
      const bounded = t => new RegExp('(^|[^a-z0-9])' + esc(t) + '([^a-z0-9]|$)', 'i')
      const strong = await Job.countDocuments({
        ...filter,
        $and: [{ $or: [
          { $and: tierWords.map(w => ({ title: bounded(w) })) },
          { company: bounded(searched) },
        ] }],
      })
      weakMatch = strong === 0
    }

    res.json({ jobs, total, pages, weakMatch })

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

    if (job.ats === 'workday' && job.companySlug) {
      // Workday's detail endpoint is per job, derived from the applyUrl the
      // fetcher stored — origin, optional locale, site, then the externalPath,
      // which already begins with "/job/". The CXS detail URL is the same path
      // under /wday/cxs/{tenant}/{site}. Some tenants instead want an extra
      // /job prefix (the shape the integration guide wrongly said was
      // universal), so on a 404 the other shape is tried once. A non-OK on both
      // says nothing about the posting; a 200 whose jobPostingInfo is missing
      // for THIS path is the closed signal Workday gives.
      try {
        const u = new URL(job.applyUrl)
        const parts = u.pathname.split('/').filter(Boolean)
        const hasLocale = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '')
        const site = hasLocale ? parts[1] : parts[0]
        const externalPath = '/' + parts.slice(hasLocale ? 2 : 1).join('/')
        const tenant = job.companySlug

        let info = null, sawOk = false
        for (const p of [externalPath, `/job${externalPath}`]) {
          const wRes = await fetch(`${u.origin}/wday/cxs/${tenant}/${site}${p}`, {
            headers: {
              accept: 'application/json',
              'user-agent': 'Optyply/1.0 (job board for international students; support@optyply.com)',
              referer: job.applyUrl,
            },
            signal: AbortSignal.timeout(8000),
          })
          if (!wRes.ok) continue
          sawOk = true
          const d = await wRes.json().catch(() => null)
          if (d?.jobPostingInfo) { info = d.jobPostingInfo; break }
        }

        if (info) {
          fullDescription = info.jobDescription || fullDescription
          if (closed) {
            closed = false
            await Job.updateOne({ id }, { closed: false })
          }
        } else if (sawOk) {
          closed = true
          if (!job.closed) await Job.updateOne({ id }, { closed: true })
        }
      } catch {
        // Network failure. Stored description, closed unchanged.
      }
    }

    if (job.ats === 'lever' && job.companySlug) {
      // Lever, like Ashby, publishes a whole board per request, so the board is
      // fetched and the posting found inside it. Absence from a board that answered
      // is the closed signal, same authority as an Ashby absence or a Greenhouse 404.
      //
      // The description arrives in pieces: an opening (HTML), a `lists` array of
      // {text, content} where content is HTML, and a closing `additional` (HTML). The
      // fetcher only ever stored 500 characters of the plain opening, which is why a
      // Lever job's detail pane ended mid-sentence before this existed. All three
      // pieces are assembled here as HTML so the frontend styles headings and lists
      // the same way it does for the other sources.
      try {
        const boardUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(job.companySlug)}?mode=json`
        const lRes = await fetch(boardUrl, { signal: AbortSignal.timeout(8000) })

        if (lRes.ok) {
          const data = await lRes.json()
          const rawId = String(id).replace(/^lever_/, '')
          const posting = (Array.isArray(data) ? data : []).find(p => String(p.id) === rawId)

          if (posting) {
            const lists = (Array.isArray(posting.lists) ? posting.lists : [])
              .map(l => `<h3>${escapeHtml(l?.text || '')}</h3>${l?.content || ''}`)
              .join('')
            const assembled = [posting.description || '', lists, posting.additional || '']
              .filter(Boolean).join('')
            fullDescription = assembled || posting.descriptionPlain || fullDescription
            if (closed) {
              closed = false
              await Job.updateOne({ id }, { closed: false })
            }
          } else {
            closed = true
            if (!job.closed) await Job.updateOne({ id }, { closed: true })
          }
        }
        // A non-OK response says nothing about this posting.
      } catch {
        // Network failure. Fall back to the stored description, leave closed as it was.
      }
    }

    if (job.ats === 'workable' && job.companySlug) {
      // Workable's documented public endpoint returns the whole account with every
      // job's description inline, so the account is fetched and the posting found by
      // shortcode. Absence from an account that answered is the closed signal.
      // Identifies itself with a User-Agent, same as the fetcher: Workable throttles
      // by IP and a named, contactable crawler is the polite shape.
      try {
        const url = `https://www.workable.com/api/accounts/${encodeURIComponent(job.companySlug)}?details=true`
        const wRes = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': 'Optyply/1.0 (job board for international students; support@optyply.com)' },
          signal: AbortSignal.timeout(8000),
        })

        if (wRes.ok) {
          const data = await wRes.json()
          const rawId = String(id).replace(/^workable_/, '')
          const posting = (Array.isArray(data?.jobs) ? data.jobs : []).find(p => String(p.shortcode) === rawId)

          if (posting) {
            fullDescription = posting.description || fullDescription
            if (closed) {
              closed = false
              await Job.updateOne({ id }, { closed: false })
            }
          } else {
            closed = true
            if (!job.closed) await Job.updateOne({ id }, { closed: true })
          }
        }
        // A 429 or any other non-OK says nothing about this posting.
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

    attachBrand([job], await getBrandMap())
    res.json({ ...job, description: fullDescription, closed })

  } catch (error) {
    console.error('Job detail error:', error)
    res.status(500).json({ error: 'Failed to fetch job details. Please try again.' })
  }
})

// List headings from Lever ("Requirements", "What you'll do") are plain text going
// into an HTML string; the four characters that would break or inject markup are
// escaped and nothing else.
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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
  const { resumeText, font, length, kind, letterText, company } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  // Cover letter as a .docx: letterhead from the resume, date, greeting, body, sign-off.
  if (kind === 'letter') {
    if (!letterText) return res.status(400).json({ error: 'No letter text provided.' })
    try {
      const FONT = fontFor(font).word
      const { name, contact, date, greeting, paragraphs } = letterParts(resumeText, letterText, company)
      const line = (text, opts = {}) => new Paragraph({
        spacing: { after: opts.after ?? 120 },
        children: [new TextRun({ text, bold: !!opts.bold, size: opts.size || 21, color: opts.color || '222222', font: FONT })],
      })
      const children = [
        line(name, { bold: true, size: 40, color: '111111', after: 60 }),
        ...contact.map(c => line(c, { size: 17, color: '555555', after: 40 })),
        new Paragraph({ spacing: { after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD' } }, children: [new TextRun({ text: '', font: FONT })] }),
        line(date, { after: 240 }),
        line(greeting, { after: 200 }),
        ...paragraphs.map(p => line(p, { after: 200 })),
        line('Sincerely,', { after: 300 }),
        line(name, { bold: true, color: '111111', after: 0 }),
      ]
      const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1300, right: 1440, bottom: 1300, left: 1440 } } }, children }] })
      const buffer = await Packer.toBuffer(doc)
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="cover-letter.docx"',
        'Content-Length': buffer.length,
      })
      return res.send(buffer)
    } catch (error) {
      console.error('Letter Word error:', error)
      return res.status(500).json({ error: 'Failed to generate Word document. Please try again.' })
    }
  }

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
// ── COVER LETTER DOCUMENT (A6) ─────────────────────────────────────────────
//
// The letter the student sees is body paragraphs only. A file they upload needs
// to look like a letter: their name and contact lines (taken from the resume they
// just optimized, so the two documents match), the date, a greeting, the body,
// a sign-off. Same font as the resume download.
function letterParts(resumeText, letterText, company) {
  const { header } = parseResume(String(resumeText || ''))
  const name = header[0] || ''
  const contact = header.slice(1).filter(l => l.includes('|') || l.includes('@') || /\d{3}[-.\s]\d{3}/.test(l))
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const greeting = company ? `Dear ${company} Hiring Team,` : 'Dear Hiring Team,'
  const paragraphs = String(letterText || '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return { name, contact, date, greeting, paragraphs }
}

// Body-only render of the letter for the on-screen sheet, marked line by line like
// the resume so the sheet can be edited and turned back into text. The letterhead,
// date, greeting and sign-off are fixed lines (data-l="fixed"); only data-l="para"
// lines are the letter body the student edits and that downloads as letterText.
function letterBodyHtml(resumeText, letterText, font, company) {
  const { name, contact, date, greeting, paragraphs } = letterParts(resumeText, letterText, company)
  let b = `<div data-l="fixed" contenteditable="false" style="padding-bottom:10pt;margin-bottom:18pt;border-bottom:1pt solid ${RULE_CSS}">`
  b += `<div style="font-size:20pt;font-weight:900;color:#111;letter-spacing:0.02em;text-transform:uppercase">${esc(name)}</div>`
  for (const c of contact) b += `<div style="font-size:8.5pt;color:#555;margin-top:4pt">${esc(c)}</div>`
  b += `</div>`
  b += `<div data-l="fixed" contenteditable="false" style="font-size:10.5pt;color:#222;margin-bottom:14pt">${esc(date)}</div>`
  b += `<div data-l="fixed" contenteditable="false" style="font-size:10.5pt;color:#222;margin-bottom:12pt">${esc(greeting)}</div>`
  for (const p of paragraphs) b += `<div data-l="para" style="font-size:10.5pt;line-height:1.55;color:#222;margin-bottom:11pt">${esc(p)}</div>`
  b += `<div data-l="fixed" contenteditable="false" style="font-size:10.5pt;color:#222;margin-top:16pt">Sincerely,</div>`
  b += `<div data-l="fixed" contenteditable="false" style="font-size:10.5pt;font-weight:700;color:#111;margin-top:14pt">${esc(name)}</div>`
  return b
}
app.post('/render-letter', (req, res) => {
  const { resumeText, letterText, font, company } = req.body || {}
  if (!resumeText || !letterText) return res.status(400).json({ error: 'Need resumeText and letterText.' })
  res.json({ html: letterBodyHtml(String(resumeText), String(letterText), font || 'times', company || '') })
})

function buildLetterHTML(resumeText, letterText, font, company) {
  const cfg = { accent: ACCENT_CSS, rule: RULE_CSS, font: fontFor(font).css }
  const { name, contact, date, greeting, paragraphs } = letterParts(resumeText, letterText, company)
  let body = `<div style="padding-bottom:10pt;margin-bottom:18pt;border-bottom:1pt solid ${cfg.rule}">`
  body += `<div style="font-size:20pt;font-weight:900;color:#111;letter-spacing:0.02em;text-transform:uppercase">${esc(name)}</div>`
  for (const c of contact) body += `<div style="font-size:8.5pt;color:#555;margin-top:4pt">${esc(c)}</div>`
  body += `</div>`
  body += `<div style="font-size:10.5pt;color:#222;margin-bottom:14pt">${esc(date)}</div>`
  body += `<div style="font-size:10.5pt;color:#222;margin-bottom:12pt">${esc(greeting)}</div>`
  for (const p of paragraphs) body += `<div style="font-size:10.5pt;line-height:1.55;color:#222;margin-bottom:11pt">${esc(p)}</div>`
  body += `<div style="font-size:10.5pt;color:#222;margin-top:16pt">Sincerely,</div>`
  body += `<div style="font-size:10.5pt;font-weight:700;color:#111;margin-top:14pt">${esc(name)}</div>`
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter; margin: 0.9in 1in; }
  body { font-family: ${cfg.font}; color: #222; background: #fff; }
</style>
</head>
<body>${body}</body>
</html>`
}

// Body-only render for the on-screen sheet. Same markup the PDF prints.
function resumeBodyHtml(resumeText, font) {
  const full = buildResumeHTML(resumeText, font || 'calibri', 'standard')
  const m = full.match(/<body>([\s\S]*)<\/body>/)
  return m ? m[1] : ''
}
// Re-render on demand: the student edits the text, the sheet re-renders from it.
app.post('/render-resume', (req, res) => {
  const { resumeText, font, resumeLayout } = req.body || {}
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })
  if (resumeLayout) return res.json({ html: renderWithLayout(String(resumeText), resumeLayout).body, sheet: layoutSheetCss(resumeLayout) })
  res.json({ html: resumeBodyHtml(String(resumeText), font || 'times') })
})

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
  body += `<div data-l="name" style="font-size:${isCompact ? '20pt' : '24pt'};font-weight:900;color:#111;letter-spacing:0.02em;text-transform:uppercase">${esc(name)}</div>`
  if (titleLine) body += `<div data-l="line" style="font-size:${isCompact ? '10pt' : '12pt'};font-weight:600;color:${cfg.accent};margin-top:4pt;letter-spacing:0.01em">${esc(titleLine)}</div>`
  for (let i = contactStart; i < header.length; i++) {
    body += `<div data-l="line" style="font-size:8pt;color:#555;margin-top:5pt">${esc(header[i])}</div>`
  }
  body += `</div>`

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]
    if (!line) { body += `<div data-l="blank" style="height:${isCompact ? '3pt' : '5pt'}"></div>`; continue }

    if (isSection(line)) {
      body += `
        <div data-l="section" style="margin-top:${sgap};margin-bottom:5pt">
          <div style="font-size:9.5pt;font-weight:800;color:${cfg.accent};letter-spacing:0.08em;text-transform:uppercase;display:flex;align-items:center;gap:8pt">
            
            ${esc(line)}
          </div>
          <div style="height:0.75pt;background:${cfg.rule};margin-top:3pt"></div>
        </div>`
      continue
    }

    if (isBullet(line)) {
      const clean = line.replace(/^[•\-]\s*/, '')
      body += `<div data-l="bullet" style="display:flex;gap:6pt;font-size:${fs};line-height:${lh};margin-bottom:${isCompact ? '2pt' : '3.5pt'};color:#222"><span contenteditable="false" style="flex-shrink:0;margin-top:1pt;color:${cfg.accent};font-weight:700">•</span><span>${esc(clean)}</span></div>`
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
          <div data-l="line" style="font-size:${isCompact ? '8.5pt' : '9pt'};color:#333;margin-bottom:2pt">
            <span style="font-weight:600;color:#222">${esc(company)}</span><span style="color:${cfg.muted};font-style:italic"> | ${esc(rest)}</span>
          </div>`
      } else {
        body += `<div data-l="line" style="font-size:${fs};font-weight:700;color:${cfg.accent};margin-top:${gap};margin-bottom:2pt">${esc(line)}</div>`
      }
      continue
    }

    // "Languages: Python, SQL" → bold label, inline skills, tight spacing
    const skill = isSkillLine(line)
    if (skill) {
      body += `<div data-l="line" style="font-size:${fs};line-height:${lh};color:#222;margin-bottom:${isCompact ? '1.5pt' : '2.5pt'}"><span style="font-weight:700;color:#111">${esc(skill.label)}:</span> ${esc(skill.values)}</div>`
      continue
    }

    // A job TITLE (line sitting right above a company/date line) → bold and prominent,
    // more weight than the company below it. This is the thing a recruiter scans for.
    if (isTitleLine(line)) {
      body += `<div data-l="line" style="font-size:${isCompact ? '10.5pt' : '11.5pt'};font-weight:800;color:#111;break-after:avoid;page-break-after:avoid;break-inside:avoid;margin-top:${gap};margin-bottom:1pt">${esc(line)}</div>`
      continue
    }

    body += `<div data-l="line" style="font-size:${fs};line-height:${lh};color:#222;margin-bottom:2pt">${esc(line)}</div>`
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
  const { resumeText, font, length, kind, letterText, company } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })
  if (kind === 'letter' && !letterText) return res.status(400).json({ error: 'No letter text provided.' })

  const isLetter = kind === 'letter'
  const html = isLetter
    ? buildLetterHTML(resumeText, letterText, font || 'calibri', company)
    : (req.body.resumeLayout ? buildLayoutPage(resumeText, req.body.resumeLayout) : buildResumeHTML(resumeText, font || 'calibri', length || 'standard'))
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
    'Content-Disposition': `attachment; filename="${isLetter ? 'cover-letter' : 'optimized-resume'}.pdf"`,
    'Content-Length': pdfBuffer.length
  })
  res.send(pdfBuffer)
})

// Bump on every change that ships. Printed at startup so "which code is running"
// is read off the terminal, never inferred from behaviour.
const SERVER_BUILD = '2026-09-11d A7-S3: blocks extracted at upload when surgical (pdfBlocks.mjs) → resumeBlocks'
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT} · build: ${SERVER_BUILD}`)
})