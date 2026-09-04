// C10 Step 3 — DRY RUN. Runs the real junkClass() from jobCategory.mjs over
// every title on the board and writes the COMPLETE would-hide list, grouped by
// class. Changes nothing. The reading of junk-dry-report.md IS this step:
// every wrongly-caught real job found here is a guard added in jobCategory.
//   node dryJunk.mjs --prod
import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
import { junkClass } from './jobCategory.mjs'
dotenv.config()

const PROD = process.argv.includes('--prod')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name, '· DRY — nothing written')
const Job = mongoose.models.Job || mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

const total = await Job.countDocuments({})
const jobs = await Job.find({}, { title: 1, company: 1, ats: 1, needsLicense: 1 }).lean()

const byClass = {}
for (const j of jobs) {
  const c = junkClass(j.title || '')
  if (!c) continue
  ;(byClass[c] ||= []).push(j)
}
let report = `# C10 dry run — would-hide list (complete) — ${new Date().toISOString().slice(0, 10)}\n\nTotal jobs: ${total}\n\n`
let grand = 0
for (const [label, list] of Object.entries(byClass).sort((a, b) => b[1].length - a[1].length)) {
  grand += list.length
  console.log(`${label.padEnd(12)} would hide ${String(list.length).padStart(5)}`)
  report += `## ${label} — ${list.length} jobs\n`
  // dedupe identical title+company lines so the report is readable
  const seen = new Map()
  for (const j of list) {
    const k = `${j.title}   [${j.company}]`
    seen.set(k, (seen.get(k) || 0) + 1)
  }
  for (const [k, n] of [...seen.entries()].sort()) report += `- ${k}${n > 1 ? ` ×${n}` : ''}\n`
  report += '\n'
}
console.log(`\nTOTAL would hide: ${grand} of ${total} (${(grand / total * 100).toFixed(1)}%)`)
report += `---\n**TOTAL would hide: ${grand} of ${total} (${(grand / total * 100).toFixed(1)}%)**\n`
fs.writeFileSync('junk-dry-report.md', report)
console.log('📄 junk-dry-report.md written — READ EVERY CLASS before Step 4. Wrong catches become guards.')
await mongoose.disconnect()
