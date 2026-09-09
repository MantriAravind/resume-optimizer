// probeAnalyze.mjs — A5 verifier for /analyze.
//
// Pulls the FIRST user with a saved resume and ONE live job from Mongo, sends both to
// /analyze the way the modal will, and prints the keyword lists and the scored rubric.
//
// Usage (from backend/):
//   node probeAnalyze.mjs                       first job whose title contains "Data Engineer"
//   node probeAnalyze.mjs --title "Analyst"     first job whose title contains "Analyst"
//   node probeAnalyze.mjs --job <jobId>         a specific job
//   node probeAnalyze.mjs --local               hit http://localhost:3001 instead of Render
//
// Reads MONGODB_URI from backend/.env. Never writes.

import dotenv from 'dotenv'
import mongoose from 'mongoose'
dotenv.config()

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1] }
const BACKEND = args.includes('--local')
  ? 'http://localhost:3001'
  : (process.env.PROBE_BACKEND || 'https://resume-optimizer-cuii.onrender.com')
const wantTitle = flag('--title') || 'Data Engineer'
const wantJob   = flag('--job')

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db

const user = await db.collection('users').findOne({ resumeText: { $exists: true, $ne: '' } }, { projection: { resumeText: 1, email: 1 } })
if (!user) { console.error('no user with a resume'); process.exit(1) }

const job = wantJob
  ? await db.collection('jobs').findOne({ id: wantJob })
  : await db.collection('jobs').findOne(
      // Greenhouse exposes sandbox/test boards; one of them is on the live board with a
      // product-designer body under a "Big Data Engineer <timestamp>" title. Skipped here;
      // the pipeline should skip them too (checklist).
      { title: new RegExp(wantTitle, 'i'), closed: { $ne: true }, description: { $exists: true },
        company: { $not: /sandbox|test|demo/i },
        // Only sources whose full posting /jobs/:id can fetch. The dev database still
        // holds Lever stubs from an old measurement; a stub scores against nothing.
        ats: { $in: ['greenhouse', 'smartrecruiters', 'ashby'] } },
      { sort: { postedAt: -1 } },
    )
if (!job) { console.error('no job matched'); process.exit(1) }
await mongoose.disconnect()

console.log('resume:', user.email || '(no email)', user.resumeText.length + ' chars')
console.log('job:   ', job.title, '@', job.company, '| id', job.id, '| ats', job.ats, '| pipeline yearsMin', job.yearsMin ?? 'n/a')
console.log('stored description:', (job.description || '').length, 'chars (Mongo keeps a 500-char preview)')

// Same path the modal takes: /jobs/:id fetches the full posting live from the ATS.
// Reading job.description from Mongo gives the 500-char preview, and a model fed a
// preview scores against nothing. That mistake cost an evening; do not repeat it.
const dRes = await fetch(BACKEND + '/jobs/' + encodeURIComponent(job.id))
const full = await dRes.json()
if (!dRes.ok || full.closed) { console.error('/jobs/:id failed or job closed:', dRes.status, full); process.exit(1) }
const jobText = full.description || ''
console.log('full description:  ', jobText.length, 'chars via /jobs/:id')
console.log('----- JD tail (requirements usually live here) -----\n' + jobText.slice(-700).replace(/\s+/g, ' ') + '\n----------------------------------------------------')
console.log('hitting', BACKEND + '/analyze ...')

const t0 = Date.now()
const res = await fetch(BACKEND + '/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeText: user.resumeText, jobText, jobTitle: job.title, yearsMin: job.yearsMin ?? null }),
})
const body = await res.json()
console.log('status', res.status, 'in', Date.now() - t0, 'ms\n')
if (!res.ok) { console.error(body); process.exit(1) }

console.log('matched  (' + body.matchedKeywords.length + '):', body.matchedKeywords.join(' | '))
console.log('missing  (' + body.missingKeywords.length + '):', body.missingKeywords.join(' | '))
console.log('old keyword-only scoreBefore:', body.scoreBefore)

const r = body.rubric
if (!r) { console.log('\nNO rubric in response — old server code still deployed?'); process.exit(1) }
const row = (label, x, detail) => console.log(`  ${label.padEnd(16)} ${String(x.pts).padStart(2)}/${x.max}   ${detail}${x.note ? '   (' + x.note + ')' : ''}`)
console.log('\nrubric total', r.total, '· max if every missing skill tapped', body.maxScore)
row('keywords',  r.rows.keywords, `${r.rows.keywords.have} of ${r.rows.keywords.total} present`)
row('bullets',   r.rows.bullets,  `grade ${r.rows.bullets.grade ?? '-'} / 5`)
row('core role', r.rows.role,     `"${r.rows.role.resumeTitle}" vs "${r.rows.role.jobTitle}" -> ${r.rows.role.match === null ? 'unknown' : r.rows.role.match ? 'same family' : 'different'}`)
row('years',     r.rows.years,    `required ${r.rows.years.required ?? '-'} · you have ${r.rows.years.have ?? '-'}`)
console.log('\nCheck: (1) no job-ad phrases in the lists, (2) role verdict is right, (3) years required matches the posting,')
console.log('(4) bullet grade is defensible, (5) rows sum to the total.')
