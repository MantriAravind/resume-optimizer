// jdAudit.mjs — how much of each job description actually made it into Mongo.
// Read-only. Run from backend/:  node jdAudit.mjs
import dotenv from 'dotenv'
import mongoose from 'mongoose'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const jobs = mongoose.connection.db.collection('jobs')
const host = (process.env.MONGODB_URI || '').replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '')
console.log('database:', mongoose.connection.name, '| uri:', host)
console.log('collections:', (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).join(', '))
console.log('jobs total (no filter):', await jobs.countDocuments(), '| closed:', await jobs.countDocuments({ closed: true }))
const byAts = await jobs.aggregate([{ $group: { _id: '$ats', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray()
console.log('by ats (no filter):', byAts.map(r => `${r._id ?? '(none)'}=${r.n}`).join(', '), '\n')

const rows = await jobs.aggregate([
  { $match: { closed: { $ne: true } } },
  { $project: { ats: 1, len: { $strLenCP: { $ifNull: ['$description', ''] } } } },
  { $group: {
      _id: '$ats',
      jobs:      { $sum: 1 },
      avgLen:    { $avg: '$len' },
      medianish: { $percentile: { input: '$len', p: [0.5], method: 'approximate' } },
      under600:  { $sum: { $cond: [{ $lte: ['$len', 600] }, 1, 0] } },
      exactly500:{ $sum: { $cond: [{ $eq: ['$len', 500] }, 1, 0] } },
      empty:     { $sum: { $cond: [{ $eq: ['$len', 0] }, 1, 0] } },
  } },
  { $sort: { jobs: -1 } },
]).toArray()

console.log('ats'.padEnd(16), 'jobs'.padStart(7), 'avg'.padStart(7), 'median'.padStart(7), '<=600'.padStart(7), '==500'.padStart(7), 'empty'.padStart(6))
for (const r of rows) {
  console.log(String(r._id ?? '(none)').padEnd(16), String(r.jobs).padStart(7), String(Math.round(r.avgLen)).padStart(7),
    String(Math.round(r.medianish?.[0] ?? 0)).padStart(7), String(r.under600).padStart(7), String(r.exactly500).padStart(7), String(r.empty).padStart(6))
}
await mongoose.disconnect()
