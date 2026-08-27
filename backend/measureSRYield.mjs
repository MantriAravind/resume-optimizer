// Measure SmartRecruiters yield per company. READ-ONLY — changes nothing.
// Answers: of the 4,158 companies the 2h42m cron visits, how many actually
// contribute jobs to the board, and how big is the zero-yield tail?
// Run from backend:  node measureSRYield.mjs
import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const J = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

await mongoose.connect(process.env.MONGODB_URI)

const listed = fs.readFileSync('sr_companies.txt', 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
const counts = await J.aggregate([
  { $match: { ats: 'smartrecruiters' } },
  { $group: { _id: '$companySlug', n: { $sum: 1 } } },
])
const byCompany = new Map(counts.map(c => [String(c._id).toLowerCase(), c.n]))

let withJobs = 0, zero = 0, totalJobs = 0
const buckets = { '1-4': 0, '5-19': 0, '20-99': 0, '100+': 0 }
const top = []
for (const c of listed) {
  const n = byCompany.get(c.toLowerCase()) || 0
  if (n === 0) { zero++; continue }
  withJobs++; totalJobs += n
  if (n >= 100) buckets['100+']++
  else if (n >= 20) buckets['20-99']++
  else if (n >= 5) buckets['5-19']++
  else buckets['1-4']++
  top.push([c, n])
}
top.sort((a, b) => b[1] - a[1])

console.log('SR companies in list:      ', listed.length)
console.log('  with >=1 job on board:   ', withJobs)
console.log('  ZERO jobs (prune target):', zero, `(${(zero / listed.length * 100).toFixed(0)}%)`)
console.log('  jobs from SR total:      ', totalJobs)
console.log('Yield buckets:', buckets)
console.log('\nTop 15 contributors:')
for (const [c, n] of top.slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${c}`)

// Sanity: jobs whose companySlug is NOT in the list at all (case drift etc.)
const listedSet = new Set(listed.map(s => s.toLowerCase()))
const orphans = counts.filter(c => !listedSet.has(String(c._id).toLowerCase()))
console.log('\nOrphan slugs (jobs in DB, slug not in list):', orphans.length,
  orphans.length ? '— investigate before pruning' : '')
for (const o of orphans.slice(0, 10)) console.log('  -', o._id, o.n)

await mongoose.disconnect()
