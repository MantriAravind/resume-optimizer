// hourlyPatternCheck.mjs — what would the PROPOSED patterns catch on the board today?
// READ-ONLY. Lists titles, deletes nothing, changes nothing.
//
// Run from backend against production:
//   node hourlyPatternCheck.mjs
//
// The Lever dry run (2026-09-01) put four hourly jobs in a random sample of twenty:
// two box-truck drivers, a Class A driver on 1st shift, and a machine operator on
// 1st shift. None matched isHourlyJob() or requiresLicense(); the same words are
// missing for every source, so the same jobs are on the board from Greenhouse and
// SmartRecruiters too.
//
// Before any of these patterns goes into jobCategory.mjs, this prints every title on
// the live board each one would catch. A pattern that catches a real degree-level job
// is wrong and does not go in. That is the doctrine in that file — "when unsure the
// job stays" — applied before the change instead of after.
//
// The normalisation here is copied from isHourlyJob(): lowercase, punctuation and
// DIGITS to spaces. That last part matters: "1st Shift" reads "st shift" by the time
// a pattern sees it, so the shift patterns below match the digit-stripped form.

import 'dotenv/config'
import mongoose from 'mongoose'
import { isHourlyJob, requiresLicense } from './jobCategory.mjs'

const J = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

const PROPOSED_HOURLY = [
  // Round 2 candidates, 2026-09-03 — from reading all 394 Abbott survivors.
  // A Fortune-100 manufacturer's plants walked straight through round 1.
  ['operator with roman numeral',   /\boperators? (i|ii|iii)\b/],
  ['plant-floor operator variants', /\b(packaging( equipment)?|processing|manufacturing|production) operators?\b/],
  ['warehouse floor variants',      /\bwarehouse (general )?(utility|specialist)\b|\bclerk warehousing\b|\bwarehouse utility\b/],
  ['production cleaning',           /\bproduction cleaning\b|\bcleaning specialists?\b/],

  ['truck / box-truck / class-letter driver',  /\b((box |semi |dump |tow )?truck driver|class [abc] driver|cdl driver)\b/],
  ['forklift',                                 /\bforklift( operator| driver)?\b/],
  ['machine operator',                         /\bmachine operators?\b/],
  ['production floor',                         /\bproduction (operators?|associates?|workers?|technicians?)\b/],
  ['warehouse floor',                          /\bwarehouse (associates?|workers?|team members?)\b/],
  ['line / assembly',                          /\b(line workers?|assembly line|assemblers?)\b/],
  ['shift-time in title',                      /\b(st|nd|rd|th|night|overnight|weekend|swing|graveyard|day|evening|morning) shift\b/],
]

// PRN is per-diem nursing — part-time by definition. It belongs in the
// CONTRACT gate, not hourly; measured here with the same discipline. Abbott
// alone had a dozen "Registered Nurse - Patient Educator (PRN)" postings pass.
const PROPOSED_CONTRACT = [
  ['PRN in title', /\bprn\b/],
]

const PROPOSED_LICENSE = [
  ['CDL class named without "CDL"',            /\bclass [abc] (cdl|drivers?|licen[cs]e)\b/],
]

// Same normalisation as isHourlyJob()
const norm = t => ' ' + String(t || '').toLowerCase()
  .replace(/[/(),.\-–—|:;&+#0-9]/g, ' ').replace(/\s+/g, ' ').trim() + ' '

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db.databaseName
console.log(`Database: ${db}`)
if (db !== 'resumeai') console.log('⚠️  Not production — counts reflect the local board only.')

const jobs = await J.find({ closed: { $ne: true } }, { title: 1, company: 1, ats: 1, needsLicense: 1 }).lean()
console.log(`${jobs.length} live jobs\n`)

let grandTotal = 0
const seen = new Set()

function report(label, re, kind) {
  const hits = jobs.filter(j => re.test(norm(j.title)))
  // Only titles the CURRENT code does not already catch — the new catch, not the overlap.
  const fresh = hits.filter(j => kind === 'hourly' ? !isHourlyJob(j.title) : !requiresLicense(j.title))
  const uniq = [...new Map(fresh.map(j => [j.title.toLowerCase(), j])).values()]
  grandTotal += fresh.length
  for (const j of fresh) seen.add(j._id.toString())
  console.log(`━━ ${label}   ${fresh.length} newly caught (${uniq.length} distinct titles)`)
  for (const j of uniq.slice(0, 40)) {
    console.log(`   ${j.title}   — ${j.company} [${j.ats}]`)
  }
  if (uniq.length > 40) console.log(`   … and ${uniq.length - 40} more distinct titles`)
  console.log()
}

console.log('═══ PROPOSED isHourlyJob() ADDITIONS ═══\n')
for (const [label, re] of PROPOSED_HOURLY) report(label, re, 'hourly')

console.log('═══ PROPOSED isContractOrPartTime() ADDITIONS (checked against titles only) ═══\n')
for (const [label, re] of PROPOSED_CONTRACT) report(label, re, 'hourly')

console.log('═══ PROPOSED requiresLicense() ADDITIONS ═══\n')
for (const [label, re] of PROPOSED_LICENSE) report(label, re, 'license')

console.log('─'.repeat(60))
console.log(`Total jobs newly caught across all proposed patterns: ${seen.size} of ${jobs.length} (${(100 * seen.size / jobs.length).toFixed(2)}%)`)
console.log('Nothing was changed. Read every title above before any pattern goes in.')

await mongoose.disconnect()
