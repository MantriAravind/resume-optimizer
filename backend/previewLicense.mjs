// ── PREVIEW: WHAT WOULD BE HIDDEN AS LICENCE-REQUIRED? ──────────────────────
// READ-ONLY. Shows what requiresLicense() would flag, and — just as important —
// what it leaves visible inside the same categories.
// RUN:  node previewLicense.mjs
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { categorizeJob, requiresLicense } from './jobCategory.mjs'
dotenv.config()
const Job = mongoose.models.Job || mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')
  const total = await Job.countDocuments()

  let hidden = 0
  const byCat = {}, hiddenSamples = {}, keptSamples = {}
  const cursor = Job.find({}, { title: 1 }).lean().cursor()
  for await (const j of cursor) {
    const cat = categorizeJob(j.title)
    const lic = requiresLicense(j.title)
    byCat[cat] = byCat[cat] || { total: 0, hidden: 0 }
    byCat[cat].total++
    if (lic) {
      hidden++; byCat[cat].hidden++
      ;(hiddenSamples[cat] = hiddenSamples[cat] || []).length < 5 && hiddenSamples[cat].push(j.title)
    } else {
      ;(keptSamples[cat] = keptSamples[cat] || []).length < 5 && keptSamples[cat].push(j.title)
    }
  }

  console.log('═'.repeat(68))
  console.log(`BOARD ${total.toLocaleString()}  ·  WOULD HIDE ${hidden.toLocaleString()} (${((hidden/total)*100).toFixed(1)}%)  ·  LEAVES ${(total-hidden).toLocaleString()}`)
  console.log('═'.repeat(68))
  for (const [cat, v] of Object.entries(byCat).sort((a,b)=>b[1].hidden-a[1].hidden)) {
    if (!v.hidden) continue
    console.log(`\n${cat}  —  hiding ${v.hidden} of ${v.total}`)
    console.log('  HIDDEN:')
    for (const s of hiddenSamples[cat] || []) console.log(`    ✗ ${s}`)
    console.log('  STILL VISIBLE in the same category:')
    for (const s of keptSamples[cat] || []) console.log(`    ✓ ${s}`)
  }
  console.log('\n' + '═'.repeat(68))
  console.log('CHECK: is anything under ✗ a job a student COULD actually take?')
  console.log('Nothing was written.')
  await mongoose.disconnect()
}
main().catch(async e => { console.error('❌', e.message); await mongoose.disconnect().catch(()=>{}); process.exit(1) })
