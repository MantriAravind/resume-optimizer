// ── PREVIEW: HOW WOULD THE BOARD BE LABELLED? ───────────────────────────────
//
// Runs the real categoriser over the real board and prints the result. Writes
// NOTHING. This exists so the labels can be checked against actual titles before
// anything is saved — the location filter leaked for five rounds because it was
// built from guesses instead of from the data.
//
// Needs jobCategory.mjs in the same folder.
//
// RUN:  node previewCategories.mjs        (8 samples per category)
//       node previewCategories.mjs 20     (20 samples per category)

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { categorizeJob, CATEGORIES } from './jobCategory.mjs'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false, collection: 'jobs' })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

async function main() {
  const sampleN = parseInt(process.argv[2] || '8', 10)

  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')

  const total = await Job.countDocuments()
  const counts = {}
  const samples = {}
  let seen = 0

  const cursor = Job.find({}, { title: 1 }).lean().cursor()
  for await (const job of cursor) {
    const cat = categorizeJob(job.title)
    counts[cat] = (counts[cat] || 0) + 1
    if (!samples[cat]) samples[cat] = []
    // Spread the samples across the collection instead of taking the first N,
    // which would all come from whichever company happens to be stored first.
    if (samples[cat].length < sampleN && seen % 7 === 0) samples[cat].push(job.title)
    seen++
    if (seen % 5000 === 0) console.log(`   ...${seen.toLocaleString()}`)
  }

  // Backfill samples for any category that the every-7th rule left short.
  for (const cat of Object.keys(counts)) {
    if (!samples[cat]?.length) {
      const one = await Job.findOne({}, { title: 1 }).lean()
      samples[cat] = one ? [one.title] : ['(none captured)']
    }
  }

  console.log('\n' + '═'.repeat(70))
  console.log(`BOARD: ${total.toLocaleString()} jobs`)
  console.log('═'.repeat(70))

  const ordered = CATEGORIES.filter(c => counts[c]).sort((a, b) => counts[b] - counts[a])
  for (const cat of ordered) {
    const n = counts[cat]
    const pct = ((n / total) * 100).toFixed(1)
    console.log(`\n${cat.padEnd(24)} ${String(n).padStart(6)}  ${pct.padStart(5)}%  ${'█'.repeat(Math.round(pct / 2))}`)
    for (const s of samples[cat].slice(0, sampleN)) console.log(`     · ${s}`)
  }

  const tech = counts['Tech'] || 0
  const eng = counts['Engineering & Science'] || 0
  const other = counts['Other'] || 0

  console.log('\n' + '═'.repeat(70))
  console.log(`Tech only:            ${tech.toLocaleString()}  (${((tech / total) * 100).toFixed(1)}%)`)
  console.log(`Tech + Eng/Science:   ${(tech + eng).toLocaleString()}  (${(((tech + eng) / total) * 100).toFixed(1)}%)`)
  console.log(`Unclear ("Other"):    ${other.toLocaleString()}  (${((other / total) * 100).toFixed(1)}%)`)
  console.log('═'.repeat(70))
  console.log('\nCHECK BEFORE APPROVING:')
  console.log('  1. Do the Tech samples all look like tech? (false positives)')
  console.log('  2. Do any NON-tech categories contain obvious tech jobs? (false negatives)')
  console.log('  3. Is "Other" small enough to ignore, or hiding something?')
  console.log('\nNothing was written. This was a preview only.')

  await mongoose.disconnect()
  console.log('\n🔌 Disconnected')
}

main().catch(async e => {
  console.error('❌ Failed:', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
