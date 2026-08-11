// ── BACKFILL: LABEL THE EXISTING JOBS ───────────────────────────────────────
//
// The pipeline now writes a `field` on every job it saves, but the ~26,000 already
// in the database were saved before that existed and have none. Without this they
// would stay invisible to the field dropdown until each one happened to be
// re-fetched, which for a job posted 29 days ago is never.
//
// Run ONCE, after jobCategory.mjs and the new FetchJobs.mjs are in place.
//
// SAFETY
//   • Only ever WRITES the `field` value. Deletes nothing, changes nothing else.
//   • Prints a full preview and waits for you to type "yes" before writing.
//   • Re-runnable: running it twice just rewrites the same labels.
//   • Uses bulk writes in batches so it does not hold 26,000 documents in memory.
//
// RUN:  node backfillCategories.mjs           preview only, writes nothing
//       node backfillCategories.mjs --write   actually writes

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import readline from 'readline'
import { categorizeJob, CATEGORIES } from './jobCategory.mjs'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false, collection: 'jobs' })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

const BATCH = 1000

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim()) }))
}

async function main() {
  const write = process.argv.includes('--write')

  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')

  const total = await Job.countDocuments()
  const alreadyLabelled = await Job.countDocuments({ field: { $exists: true, $ne: null } })
  console.log(`📊 ${total.toLocaleString()} jobs · ${alreadyLabelled.toLocaleString()} already labelled\n`)

  // ── Pass 1: work out every label without writing anything ────────────────
  console.log('🔍 Working out labels...')
  const counts = {}
  const ops = []
  let seen = 0

  const cursor = Job.find({}, { _id: 1, title: 1 }).lean().cursor()
  for await (const job of cursor) {
    const field = categorizeJob(job.title)
    counts[field] = (counts[field] || 0) + 1
    ops.push({ updateOne: { filter: { _id: job._id }, update: { $set: { field } } } })
    seen++
    if (seen % 5000 === 0) console.log(`   ...${seen.toLocaleString()}`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('WHAT WOULD BE WRITTEN')
  console.log('═'.repeat(60))
  for (const cat of CATEGORIES.filter(c => counts[c]).sort((a, b) => counts[b] - counts[a])) {
    const pct = ((counts[cat] / total) * 100).toFixed(1)
    console.log(`  ${cat.padEnd(24)} ${String(counts[cat]).padStart(6)}  ${pct.padStart(5)}%`)
  }
  console.log('═'.repeat(60))

  if (!write) {
    console.log('\n👀 PREVIEW ONLY — nothing was written.')
    console.log('   Run with --write to apply:  node backfillCategories.mjs --write')
    await mongoose.disconnect()
    return
  }

  // ── Confirm before touching the database ─────────────────────────────────
  const answer = await ask(`\n⚠️  This will set "field" on ${ops.length.toLocaleString()} jobs. Type "yes" to continue: `)
  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled. Nothing was written.')
    await mongoose.disconnect()
    return
  }

  // ── Pass 2: write, in batches ────────────────────────────────────────────
  console.log('\n💾 Writing...')
  let written = 0
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH)
    const res = await Job.bulkWrite(chunk, { ordered: false })
    written += res.modifiedCount || 0
    console.log(`   ${Math.min(i + BATCH, ops.length).toLocaleString()}/${ops.length.toLocaleString()}`)
  }

  // ── Verify against the database rather than trusting the counters ────────
  console.log('\n🔍 Verifying...')
  const nowLabelled = await Job.countDocuments({ field: { $exists: true, $ne: null } })
  const missing = total - nowLabelled

  console.log('\n' + '═'.repeat(60))
  console.log(`   Modified:  ${written.toLocaleString()}`)
  console.log(`   Labelled:  ${nowLabelled.toLocaleString()} of ${total.toLocaleString()}`)
  console.log(`   Missing:   ${missing.toLocaleString()}`)
  console.log('═'.repeat(60))

  if (missing > 0) {
    console.log('\n⚠️  Some jobs still have no field. Re-run to catch them.')
  } else {
    console.log('\n✅ Every job is labelled.')
  }

  await mongoose.disconnect()
  console.log('\n🔌 Disconnected')
}

main().catch(async e => {
  console.error('❌ Failed:', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
