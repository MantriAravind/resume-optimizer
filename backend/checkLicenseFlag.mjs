// Count needsLicense-flagged jobs and print a random sample of 20 titles.
// Read-only. Run from backend:  node checkLicenseFlag.mjs
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const J = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

await mongoose.connect(process.env.MONGODB_URI)
const total = await J.countDocuments()
const flagged = await J.countDocuments({ needsLicense: true })
console.log(`flagged ${flagged} of ${total} (${(flagged / total * 100).toFixed(1)}%)`)
const sample = await J.aggregate([
  { $match: { needsLicense: true } },
  { $sample: { size: 20 } },
  { $project: { title: 1, company: 1, _id: 0 } },
])
for (const s of sample) console.log(' -', s.title, '—', s.company)
await mongoose.disconnect()
