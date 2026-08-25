// ── PURGE: HOURLY JOBS ALREADY IN THE DATABASE ──────────────────────────────
//
// The pipeline now refuses hourly store/route/food-service titles at fetch
// (isHourlyJob in jobCategory.mjs), but the rows saved BEFORE that fix are still
// on the board and would sit there for up to 30 days until the age-out removes
// them. This deletes them once. After this run the fetch-side check keeps the
// board clean on its own, and this script should never be needed again.
//
// ONE SOURCE OF TRUTH: uses the same isHourlyJob() the pipeline uses, so the
// purge and the fetch filter cannot disagree about what counts as hourly.
//
// SAFETY
//   • Dry run by default: prints the count, per-company breakdown and sample
//     titles, deletes nothing.
//   • --delete actually deletes, and only after you type "yes".
//   • SHARE CAP: refuses to delete if matches exceed 10% of the board. At that
//     scale it is far more likely a pattern bug than a franchise flood — the
//     same lesson as MAX_SWEEP_SHARE in the pipeline.
//   • Deletes by the exact _id list from the scan, in batches — never by
//     re-running the regex inside a deleteMany, so what you previewed is
//     exactly what gets deleted.
//
// RUN:  node purgeHourly.mjs            preview only, deletes nothing
//       node purgeHourly.mjs --delete   actually deletes (asks for "yes")

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import readline from 'readline'
import { isHourlyJob } from './jobCategory.mjs'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false, collection: 'jobs' })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

const BATCH = 1000
const MAX_SHARE = 0.10   // refuse to delete more than 10% of the board

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim()) }))
}

async function main() {
  const doDelete = process.argv.includes('--delete')

  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')

  const total = await Job.countDocuments()
  console.log(`📊 ${total.toLocaleString()} jobs on the board\n`)

  // ── Pass 1: scan every title, delete nothing ──────────────────────────────
  console.log('🔍 Scanning titles with isHourlyJob()...')
  const ids = []
  const byCompany = {}
  const samples = []
  let seen = 0

  const cursor = Job.find({}, { _id: 1, title: 1, company: 1, ats: 1 }).lean().cursor()
  for await (const job of cursor) {
    seen++
    if (seen % 5000 === 0) console.log(`   ...${seen.toLocaleString()}`)
    if (!isHourlyJob(job.title)) continue
    ids.push(job._id)
    const co = job.company || '(no company)'
    byCompany[co] = (byCompany[co] || 0) + 1
    if (samples.length < 40) samples.push(`${job.title}  —  ${co} [${job.ats || '?'}]`)
  }

  const share = total ? ids.length / total : 0

  console.log('\n' + '═'.repeat(60))
  console.log(`WOULD DELETE: ${ids.length.toLocaleString()} of ${total.toLocaleString()} jobs (${(share * 100).toFixed(1)}%)`)
  console.log('═'.repeat(60))

  console.log('\nBy company (top 15):')
  const topCompanies = Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 15)
  for (const [co, n] of topCompanies) {
    console.log(`  ${String(n).padStart(5)}  ${co}`)
  }

  console.log('\nSample titles (read these — every one should be obviously hourly):')
  for (const s of samples) console.log(`  • ${s}`)
  console.log('═'.repeat(60))

  if (!doDelete) {
    console.log('\n👀 PREVIEW ONLY — nothing was deleted.')
    console.log('   Read the sample above. If every title is genuinely hourly work,')
    console.log('   run:  node purgeHourly.mjs --delete')
    await mongoose.disconnect()
    return
  }

  if (ids.length === 0) {
    console.log('\n✅ Nothing to delete.')
    await mongoose.disconnect()
    return
  }

  // ── Share cap: a purge this large is a bug until proven otherwise ─────────
  if (share > MAX_SHARE) {
    console.log(`\n🛑 REFUSING: ${(share * 100).toFixed(1)}% of the board matched — over the ${MAX_SHARE * 100}% cap.`)
    console.log('   A pattern is almost certainly too wide. Read the sample, fix the')
    console.log('   pattern in jobCategory.mjs, and re-run the preview.')
    await mongoose.disconnect()
    process.exit(1)
  }

  const answer = await ask(`\n⚠️  This will PERMANENTLY DELETE ${ids.length.toLocaleString()} jobs. Type "yes" to continue: `)
  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled. Nothing was deleted.')
    await mongoose.disconnect()
    return
  }

  // ── Pass 2: delete by exact _id list, in batches ──────────────────────────
  console.log('\n🗑️  Deleting...')
  let deleted = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const res = await Job.deleteMany({ _id: { $in: chunk } })
    deleted += res.deletedCount || 0
    console.log(`   ${Math.min(i + BATCH, ids.length).toLocaleString()}/${ids.length.toLocaleString()}`)
  }

  // ── Verify against the database rather than trusting the counters ────────
  const after = await Job.countDocuments()
  console.log('\n' + '═'.repeat(60))
  console.log(`   Deleted:   ${deleted.toLocaleString()}`)
  console.log(`   Board now: ${after.toLocaleString()} (was ${total.toLocaleString()})`)
  console.log('═'.repeat(60))

  if (deleted !== ids.length) {
    console.log(`\n⚠️  Planned ${ids.length.toLocaleString()} but deleted ${deleted.toLocaleString()} — some rows vanished between scan and delete (age-out or re-fetch). Harmless, but noted.`)
  } else {
    console.log('\n✅ Done. The fetch-side isHourlyJob check keeps it clean from here.')
  }

  await mongoose.disconnect()
  console.log('\n🔌 Disconnected')
}

main().catch(async e => {
  console.error('❌ Failed:', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
