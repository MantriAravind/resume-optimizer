// How many distinct companies have jobs on the board right now — the logo
// enrichment universe. READ-ONLY. Run from backend: node countCompanies.mjs
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const J = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))
await mongoose.connect(process.env.MONGODB_URI)

const agg = await J.aggregate([
  { $group: { _id: { ats: '$ats', slug: '$companySlug' }, name: { $first: '$company' }, jobs: { $sum: 1 } } },
])
const byAts = {}
for (const c of agg) byAts[c._id.ats] = (byAts[c._id.ats] || 0) + 1
console.log('Distinct companies with jobs:', agg.length)
console.log('By ATS:', byAts)
const sorted = agg.sort((a, b) => b.jobs - a.jobs)
console.log('\nTop 10 by job count (these get eyeballed first):')
for (const c of sorted.slice(0, 10)) console.log(`  ${String(c.jobs).padStart(5)}  ${c.name}  [${c._id.ats}/${c._id.slug}]`)
console.log('\nName oddities sample (names that will challenge domain search):')
const odd = agg.filter(c => /llc|inc\b|\d|corp|group$/i.test(String(c.name))).slice(0, 10)
for (const c of odd) console.log('  -', c.name)
await mongoose.disconnect()
