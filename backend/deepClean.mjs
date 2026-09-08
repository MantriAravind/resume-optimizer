// C12 — DEEP CLEAN (report-only). Re-fetches the FULL description of every
// visible job via our own /jobs/:id (all six sources) and re-judges it with the
// CURRENT isDisqualified (~197 patterns). Writes verdicts as a stamp on each
// job (deepCleanAt + deepCleanFail) — the stamp IS the resume cursor: rerunning
// skips already-judged jobs, so interruptions cost nothing.
// DELETES NOTHING. The report lists every failure with its guilty snippet;
// the delete pass runs separately, after human reading.
//   node deepClean.mjs --prod --limit 6000     one chunk (~2h), resumable
//   node deepClean.mjs --prod                  grind until done (~17-20h)
//   node deepClean.mjs --prod --report         just rewrite the report from stamps
//   node deepClean.mjs --prod --reset          clear all stamps (full re-audit)
import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
import { isDisqualified, stripHtml } from './FetchJobs.mjs'
dotenv.config()

const PROD = process.argv.includes('--prod')
const REPORT = process.argv.includes('--report')
const DELETE = process.argv.includes('--delete')
const RESET = process.argv.includes('--reset')
const lIdx = process.argv.indexOf('--limit')
const LIMIT = lIdx > -1 ? Number(process.argv[lIdx + 1]) : Infinity
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set'); process.exit(1) }
const API = 'https://resume-optimizer-cuii.onrender.com'
const STAMP = '2026-09-08'   // bump when the pattern list changes materially
const sleep = ms => new Promise(r => setTimeout(r, ms))

await mongoose.connect(uri)
const J = mongoose.connection.db.collection('jobs')
console.log('DB:', mongoose.connection.name)

if (RESET) {
  const r = await J.updateMany({}, { $unset: { deepCleanAt: '', deepCleanFail: '' } })
  console.log('stamps cleared:', r.modifiedCount); process.exit(0)
}

async function writeReport() {
  const fails = await J.find({ deepCleanFail: { $exists: true } }, { projection: { title: 1, company: 1, ats: 1, deepCleanFail: 1 } }).toArray()
  let rep = `# Deep clean report — stamp ${STAMP} — ${new Date().toISOString().slice(0, 16)}\n`
  const judged = await J.countDocuments({ deepCleanAt: STAMP })
  const total = await J.countDocuments({ junkClass: null, ats: { $in: ['workday', 'smartrecruiters'] } })
  rep += `judged ${judged} · scope workday+smartrecruiters · FAILURES: ${fails.length}\n\n`
  for (const f of fails.sort((a, b) => (a.company > b.company ? 1 : -1)))
    rep += `- ${f.ats} · ${f.company} · ${f.title}\n  ...${f.deepCleanFail}...\n`
  fs.writeFileSync('deep-clean-report.md', rep)
  console.log(`📄 deep-clean-report.md · judged ${judged}/${total} · failures ${fails.length}`)
}
if (REPORT) { await writeReport(); process.exit(0) }

// ── DELETE PASS: self-verifying. Re-fetches each flagged job's full text and
// re-judges with the CURRENT filter — pattern fixes since the sweep (e.g. the
// Alcon relocation guard) automatically spare their jobs. Deletes only what
// still fails TODAY.
if (DELETE) {
  const flagged = await J.find({ deepCleanFail: { $exists: true } }, { projection: { id: 1, title: 1, company: 1 } }).toArray()
  console.log('flagged jobs to re-verify:', flagged.length)
  let del = 0, spared = 0, errs = 0
  for (const j of flagged) {
    try {
      const r = await fetch(`${API}/jobs/${encodeURIComponent(j.id)}`, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) { errs++; continue }
      const full = stripHtml(String((await r.json()).description || ''))
      if (isDisqualified(`${j.title}\n${full}`, j.title)) {
        await J.deleteOne({ _id: j._id }); del++
      } else {
        await J.updateOne({ _id: j._id }, { $unset: { deepCleanFail: '' } }); spared++
        console.log('  SPARED (passes current filter):', j.company, '·', j.title)
      }
      await sleep(150)
    } catch { errs++ }
  }
  console.log(`\ndeleted ${del} · spared ${spared} · errors ${errs}`)
  process.exit(0)
}

// visible, not yet judged under this stamp
// Scope: ONLY the entry-judged sources. Greenhouse/Lever/Ashby/Workable get
// full text in their LIST responses and re-run isDisqualified on every job
// every cycle — they deep-clean themselves. Workday and SmartRecruiters fetch
// descriptions once, for newcomers — they are the archaeology.
const todo = await J.find(
  { junkClass: null, deepCleanAt: { $ne: STAMP }, ats: { $in: ['workday', 'smartrecruiters'] } },
  { projection: { id: 1, title: 1, company: 1, ats: 1 } }
).limit(LIMIT === Infinity ? 0 : LIMIT).toArray()
console.log('scope: workday+smartrecruiters ONLY (others self-clean per cycle)')
console.log('to judge this run:', todo.length, LIMIT !== Infinity ? `(chunk limit ${LIMIT})` : '(until done)')

let fails = 0, errors = 0, n = 0
for (const j of todo) {
  n++
  try {
    const r = await fetch(`${API}/jobs/${encodeURIComponent(j.id)}`, { signal: AbortSignal.timeout(20000) })
    if (!r.ok) { errors++; continue }   // no stamp — retried next run
    const full = stripHtml(String((await r.json()).description || ''))
    const bad = isDisqualified(`${j.title}\n${full}`, j.title)
    const update = { $set: { deepCleanAt: STAMP } }
    if (bad) {
      fails++
      const m = full.match(/.{0,60}(sponsor|citizen|clearance|itar|u\.?s\.?[\s-]person|green\s+card|visa)[\s\S]{0,60}/i)
      update.$set.deepCleanFail = (m ? m[0] : '(deep pattern)').replace(/\s+/g, ' ').trim().slice(0, 160)
    } else update.$unset = { deepCleanFail: '' }
    await J.updateOne({ _id: j._id }, update)
    if (n % 200 === 0) console.log(`  ${n}/${todo.length} · fails so far ${fails} · errors ${errors}`)
    await sleep(150)
  } catch { errors++ }
}
console.log(`\nchunk done: ${n} judged · ${fails} failures · ${errors} errors (errors retry next run)`)
await writeReport()
process.exit(0)
