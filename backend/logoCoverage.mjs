// logoCoverage.mjs — how much of the LIVE board shows a real logo? READ-ONLY.
//
// Coverage counted two ways, because they answer different questions:
//   by company  — how big is the enrichment backlog
//   by job      — how much of what a student actually scrolls past shows letters.
// A company with 50 live jobs and no logo hurts 50 cards; a one-job company
// hurts one. The fix list below is therefore sorted by live jobs, so review
// effort goes where the eyeballs are.
//
// Run from backend against production:
//   node logoCoverage.mjs

import 'dotenv/config'
import mongoose from 'mongoose'

const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))
const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false, collection: 'companies' }))

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db.databaseName
console.log(`Database: ${db}\n`)

// Every live company with its job count.
const live = await Job.aggregate([
  { $match: { closed: { $ne: true } } },
  { $group: { _id: { ats: '$ats', slug: '$companySlug' }, name: { $first: '$company' }, jobs: { $sum: 1 } } },
])

// Which of them have a trusted logo. Only status counts: 'provider' is shown,
// everything else renders letters (that is attachBrand's rule in server.js).
const companies = await Company.find({}, { ats: 1, slug: 1, logoStatus: 1, 'branding.logoUrl': 1 }).lean()
const status = new Map()
for (const c of companies) status.set(`${c.ats}|${c.slug}`, c.logoStatus === 'provider' && c.branding?.logoUrl ? 'logo' : (c.logoStatus || 'unknown'))

let totalJobs = 0, logoJobs = 0
const byStatus = {}        // status -> { companies, jobs }
const noLogo = []          // companies without a shown logo, for the fix list

for (const c of live) {
  const key = `${c._id.ats}|${c._id.slug}`
  const s = status.get(key) || 'no record'
  totalJobs += c.jobs
  if (s === 'logo') logoJobs += c.jobs
  else noLogo.push({ ...c, status: s })
  byStatus[s] ||= { companies: 0, jobs: 0 }
  byStatus[s].companies++
  byStatus[s].jobs += c.jobs
}

const pct = (a, b) => (100 * a / b).toFixed(1) + '%'
console.log(`Live jobs: ${totalJobs} · live companies: ${live.length}\n`)
console.log('Status          Companies      Jobs    Share of jobs')
console.log('─'.repeat(56))
for (const [s, v] of Object.entries(byStatus).sort((a, b) => b[1].jobs - a[1].jobs)) {
  console.log(`${s.padEnd(15)} ${String(v.companies).padStart(9)} ${String(v.jobs).padStart(9)}    ${pct(v.jobs, totalJobs)}`)
}
console.log('─'.repeat(56))
console.log(`WITH LOGO:      ${pct(logoJobs, totalJobs)} of jobs · WITHOUT: ${pct(totalJobs - logoJobs, totalJobs)}\n`)

noLogo.sort((a, b) => b.jobs - a.jobs)
console.log('Top 40 companies to fix, by live jobs (this is the review order):')
for (const c of noLogo.slice(0, 40)) {
  console.log(`   ${String(c.jobs).padStart(5)}  [${c.status}]  ${c.name}  (${c._id.ats}/${c._id.slug})`)
}
const rest = noLogo.slice(40).reduce((a, c) => a + c.jobs, 0)
if (noLogo.length > 40) console.log(`   ... and ${noLogo.length - 40} more companies covering ${rest} jobs`)

await mongoose.disconnect()
