// probeAnalyze.mjs — A5 step-1 verifier.
//
// Pulls the FIRST user with a saved resume and ONE live job from Mongo, sends both to
// /analyze, and prints exactly what the extract call returned: keyword lists, the
// dropped junk (from server logs), latestTitle, yearsRequired, bulletRelevance.
//
// Usage (from backend/):
//   node probeAnalyze.mjs                       first job whose title contains "Data Engineer"
//   node probeAnalyze.mjs --title "Analyst"     first job whose title contains "Analyst"
//   node probeAnalyze.mjs --job <jobId>         a specific job
//   node probeAnalyze.mjs --local               hit http://localhost:3000 instead of Render
//
// Reads MONGODB_URI from backend/.env. Never writes.

import dotenv from 'dotenv'
import mongoose from 'mongoose'
dotenv.config()

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1] }
const BACKEND = args.includes('--local')
  ? 'http://localhost:3000'
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
      { title: new RegExp(wantTitle, 'i'), closed: { $ne: true }, description: { $exists: true } },
      { sort: { postedAt: -1 } },
    )
if (!job) { console.error('no job matched'); process.exit(1) }
await mongoose.disconnect()

console.log('resume:', user.email || '(no email)', user.resumeText.length + ' chars')
console.log('job:   ', job.title, '@', job.company, '| id', job.id, '| yearsMin', job.yearsMin ?? 'n/a')
console.log('hitting', BACKEND + '/analyze ...')

const t0 = Date.now()
const res = await fetch(BACKEND + '/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeText: user.resumeText, jobText: job.description, jobTitle: job.title }),
})
const body = await res.json()
console.log('status', res.status, 'in', Date.now() - t0, 'ms\n')
if (!res.ok) { console.error(body); process.exit(1) }

console.log('matched  (' + body.matchedKeywords.length + '):', body.matchedKeywords.join(' | '))
console.log('missing  (' + body.missingKeywords.length + '):', body.missingKeywords.join(' | '))
console.log('scoreBefore     :', body.scoreBefore)
console.log('latestTitle     :', JSON.stringify(body.latestTitle))
console.log('yearsRequired   :', body.yearsRequired)
console.log('bulletRelevance :', body.bulletRelevance)
console.log('\nCheck: (1) no job-ad phrases in either list, (2) latestTitle is your real current title,')
console.log('(3) yearsRequired matches what the posting says, (4) bulletRelevance is defensible for this job.')
console.log('Dropped terms are in the Render log line "extract: dropped N non-skill(s)".')
