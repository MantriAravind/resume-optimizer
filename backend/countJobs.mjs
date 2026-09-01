// How many live jobs per ATS source? READ-ONLY.
// Run from backend: node countJobs.mjs
//
// "Live" here means what the board shows: not closed. Also prints closed counts so a
// sweep that quietly shut a source can be seen, and the newest postedAt per source
// so a fetcher that stopped running shows up as a stale date.
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const J = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))
await mongoose.connect(process.env.MONGODB_URI)

const rows = await J.aggregate([
  { $group: {
    _id: { ats: '$ats', closed: { $ifNull: ['$closed', false] } },
    n: { $sum: 1 },
    newest: { $max: '$postedAt' },
    companies: { $addToSet: '$companySlug' },
  } },
  { $sort: { '_id.ats': 1, '_id.closed': 1 } },
])

const byAts = {}
for (const r of rows) {
  const k = r._id.ats || '(none)'
  byAts[k] ||= { live: 0, closed: 0, newest: null, companies: 0 }
  if (r._id.closed) byAts[k].closed = r.n
  else {
    byAts[k].live = r.n
    byAts[k].newest = r.newest
    byAts[k].companies = r.companies.length
  }
}

const db = mongoose.connection.db.databaseName
console.log(`Database: ${db}\n`)
console.log('Source           Live    Closed   Companies   Newest posting')
console.log('─'.repeat(66))
let live = 0, closed = 0
for (const [ats, v] of Object.entries(byAts)) {
  live += v.live; closed += v.closed
  const newest = v.newest ? new Date(v.newest).toISOString().slice(0, 10) : '—'
  console.log(`${ats.padEnd(14)} ${String(v.live).padStart(7)} ${String(v.closed).padStart(9)} ${String(v.companies).padStart(11)}   ${newest}`)
}
console.log('─'.repeat(66))
console.log(`${'TOTAL'.padEnd(14)} ${String(live).padStart(7)} ${String(closed).padStart(9)}`)

await mongoose.disconnect()
