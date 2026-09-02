// purgeRound2.mjs — remove live jobs the ROUND-2 filter additions now refuse.
//
// Round 2 (2026-09-03) added: operator-with-roman-numeral (lab excluded),
// plant-floor operator compounds, warehouse specialist/utility/clerk warehousing,
// production cleaning — all in isHourlyJob() — and PRN-in-title in
// isContractOrPartTime(). The fetchers refuse these at the door from the next
// run; this removes the ones already on the board. Measured beforehand:
// ~54 hourly + 378 PRN of 60,020 live jobs.
//
//   node purgeRound2.mjs            preview — deletes nothing
//   node purgeRound2.mjs --delete   actually delete, after typed confirmation

import 'dotenv/config'
import mongoose from 'mongoose'
import readline from 'readline'
import { isHourlyJob, requiresLicense } from './jobCategory.mjs'

const DELETE = process.argv.includes('--delete')
const MAX_SHARE = 0.10   // same guard as round 1: >10% means a pattern is wrong, stop

const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))
await mongoose.connect(process.env.MONGODB_URI)
console.log(`Database: ${mongoose.connection.db.databaseName}${DELETE ? '' : '  ·  PREVIEW — nothing will be deleted'}\n`)

const jobs = await Job.find({ closed: { $ne: true } }, { title: 1, company: 1, ats: 1 }).lean()
const doomed = jobs.filter(j => isHourlyJob(j.title) || requiresLicense(j.title) || /\bprn\b/i.test(j.title || ''))

// requiresLicense TAGS on fetch rather than dropping, so jobs it matches are
// only deleted here if isHourlyJob or PRN also matches — filter again properly:
const toDelete = jobs.filter(j => isHourlyJob(j.title) || /\bprn\b/i.test(j.title || ''))

const share = toDelete.length / jobs.length
console.log(`${toDelete.length} of ${jobs.length} live jobs match round-2 rules (${(100 * share).toFixed(2)}%)\n`)

const byCompany = {}
for (const j of toDelete) byCompany[j.company] = (byCompany[j.company] || 0) + 1
console.log('By company (top 15):')
for (const [c, n] of Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   ${String(n).padStart(4)}  ${c}`)

const titles = [...new Map(toDelete.map(j => [j.title.toLowerCase(), j.title])).values()]
console.log(`\nDistinct titles (${titles.length}) — first 50:`)
for (const t of titles.slice(0, 50)) console.log('   ' + t)
if (titles.length > 50) console.log(`   … and ${titles.length - 50} more`)

if (share > MAX_SHARE) {
  console.log(`\n🛑 ${(100 * share).toFixed(1)}% exceeds the ${100 * MAX_SHARE}% guard. A pattern is too wide. Nothing deleted.`)
  await mongoose.disconnect(); process.exit(1)
}

if (!DELETE) {
  console.log('\nPreview only. Rerun with --delete to remove these.')
  await mongoose.disconnect(); process.exit(0)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const answer = await new Promise(r => rl.question(`\n⚠️  This will PERMANENTLY DELETE ${toDelete.length} jobs. Type "yes" to continue: `, r))
rl.close()
if (answer.trim().toLowerCase() !== 'yes') {
  console.log('Aborted. Nothing deleted.')
  await mongoose.disconnect(); process.exit(0)
}

const ids = toDelete.map(j => j._id)
let deleted = 0
for (let i = 0; i < ids.length; i += 500) {
  const res = await Job.deleteMany({ _id: { $in: ids.slice(i, i + 500) } })
  deleted += res.deletedCount
  process.stdout.write(`\r   ${deleted}/${ids.length}`)
}
const left = await Job.countDocuments({ closed: { $ne: true } })
console.log(`\n${'═'.repeat(60)}\n   Deleted:   ${deleted}\n   Board now: ${left.toLocaleString()}\n${'═'.repeat(60)}`)
console.log('✅ Done. The fetch-side gates keep it clean from here.')
await mongoose.disconnect()
