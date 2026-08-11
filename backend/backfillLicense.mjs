// ── BACKFILL: FLAG ROLES THAT NEED A US LICENCE ─────────────────────────────
//
// The pipeline now sets needsLicense on every job it saves, but the ~26,000 already in
// the database predate the field. Without this they stay visible until each one happens
// to be re-fetched — which for a job posted 29 days ago is never.
//
// FLAGS, DOES NOT DELETE. The jobs stay in the database and are filtered out of board
// results. A wrong rule is fixed by editing a word; a wrong delete needs a full
// re-fetch. The first version of this filter had five false positives on real data,
// including two sales jobs that matched on "physician" — that is the argument.
//
// SAFETY
//   • Only ever WRITES needsLicense. Deletes nothing, changes nothing else.
//   • Prints a full preview and waits for you to type "yes" before writing.
//   • Re-runnable: running it twice rewrites the same values.
//
// RUN:  node backfillLicense.mjs           preview only, writes nothing
//       node backfillLicense.mjs --write   actually writes

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import readline from 'readline'
import { requiresLicense, categorizeJob } from './jobCategory.mjs'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false, collection: 'jobs' })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

const BATCH = 1000

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()) }))
}

async function main() {
  const write = process.argv.includes('--write')

  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')

  const total = await Job.countDocuments()

  console.log('🔍 Working out which roles need a licence...')
  const ops = []
  const byCat = {}
  let flagged = 0, seen = 0

  const cursor = Job.find({}, { _id: 1, title: 1 }).lean().cursor()
  for await (const job of cursor) {
    const needsLicense = requiresLicense(job.title)
    if (needsLicense) {
      flagged++
      const cat = categorizeJob(job.title)
      byCat[cat] = (byCat[cat] || 0) + 1
    }
    ops.push({ updateOne: { filter: { _id: job._id }, update: { $set: { needsLicense } } } })
    seen++
    if (seen % 5000 === 0) console.log(`   ...${seen.toLocaleString()}`)
  }

  const pct = ((flagged / total) * 100).toFixed(1)
  console.log('\n' + '═'.repeat(62))
  console.log(`   Board:        ${total.toLocaleString()}`)
  console.log(`   Would hide:   ${flagged.toLocaleString()}  (${pct}%)`)
  console.log(`   Would leave:  ${(total - flagged).toLocaleString()}`)
  console.log('═'.repeat(62))
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat.padEnd(24)} ${String(n).padStart(6)}`)
  }
  console.log('═'.repeat(62))

  if (!write) {
    console.log('\n👀 PREVIEW ONLY — nothing was written.')
    console.log('   Run with --write to apply:  node backfillLicense.mjs --write')
    await mongoose.disconnect()
    return
  }

  const answer = await ask(`\n⚠️  This will hide ${flagged.toLocaleString()} jobs from the board. They stay in the database. Type "yes" to continue: `)
  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled. Nothing was written.')
    await mongoose.disconnect()
    return
  }

  console.log('\n💾 Writing...')
  let written = 0
  for (let i = 0; i < ops.length; i += BATCH) {
    const res = await Job.bulkWrite(ops.slice(i, i + BATCH), { ordered: false })
    written += res.modifiedCount || 0
    console.log(`   ${Math.min(i + BATCH, ops.length).toLocaleString()}/${ops.length.toLocaleString()}`)
  }

  // Verified against the database rather than the counters, so a partial write shows up.
  console.log('\n🔍 Verifying...')
  const hidden = await Job.countDocuments({ needsLicense: true })
  const visible = await Job.countDocuments({ needsLicense: { $ne: true } })

  console.log('\n' + '═'.repeat(62))
  console.log(`   Modified:  ${written.toLocaleString()}`)
  console.log(`   Hidden:    ${hidden.toLocaleString()}`)
  console.log(`   Visible:   ${visible.toLocaleString()}`)
  console.log('═'.repeat(62))
  console.log(hidden === flagged
    ? '\n✅ Matches the preview exactly.'
    : `\n⚠️  Expected ${flagged.toLocaleString()} hidden, got ${hidden.toLocaleString()}. Re-run to catch the rest.`)

  await mongoose.disconnect()
  console.log('\n🔌 Disconnected')
}

main().catch(async e => {
  console.error('❌ Failed:', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
