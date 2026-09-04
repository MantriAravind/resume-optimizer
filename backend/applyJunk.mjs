// C10 Step 4a — tag junk on existing jobs. Sets job.junkClass = <label> using
// the real junkClass() from jobCategory.mjs. REVERSIBLE: --undo unsets every
// junkClass field on this ats-agnostic board.
//   node applyJunk.mjs --prod --dry     counts only, writes nothing
//   node applyJunk.mjs --prod           tag for real
//   node applyJunk.mjs --prod --undo    remove all junkClass tags
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { junkClass } from './jobCategory.mjs'
dotenv.config()

const PROD = process.argv.includes('--prod')
const DRY = process.argv.includes('--dry')
const UNDO = process.argv.includes('--undo')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name, DRY ? '· DRY' : UNDO ? '· UNDO' : '')
const Job = mongoose.models.Job || mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

if (UNDO) {
  const r = await Job.updateMany({ junkClass: { $exists: true } }, { $unset: { junkClass: '' } })
  console.log(`Removed junkClass from ${r.modifiedCount} jobs.`)
  await mongoose.disconnect(); process.exit(0)
}

const jobs = await Job.find({}, { title: 1 }).lean()
const plan = []
for (const j of jobs) {
  const c = junkClass(j.title || '')
  if (c) plan.push({ _id: j._id, c })
}
const counts = {}
for (const p of plan) counts[p.c] = (counts[p.c] || 0) + 1
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`)
console.log(`Would tag: ${plan.length} of ${jobs.length}`)
if (DRY) { console.log('DRY — nothing written.'); await mongoose.disconnect(); process.exit(0) }

let done = 0
const ops = plan.map(p => ({ updateOne: { filter: { _id: p._id }, update: { $set: { junkClass: p.c } } } }))
for (let i = 0; i < ops.length; i += 1000) {
  const r = await Job.bulkWrite(ops.slice(i, i + 1000), { ordered: false })
  done += r.modifiedCount
  console.log(`  ${Math.min(i + 1000, ops.length)}/${ops.length}`)
}
console.log(`Tagged ${done} jobs with junkClass. Board hides them once the server query excludes junkClass.`)
await mongoose.disconnect()
