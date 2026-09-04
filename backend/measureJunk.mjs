// C10 Step 1 — MEASURE. Read-only scan of every job title on the board,
// classified into candidate junk classes (retail/care/trade/etc).
//
// Audit-only and DELIBERATELY over-inclusive, same philosophy as filterCheck's
// RED_FLAGS: the job is to cut 59k titles down to readable piles, not to be
// the shipping filter. Step 2 builds the real patterns FROM this report.
//
//   node measureJunk.mjs --prod
// Writes junk-report.md next to this file and prints a summary.
import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const PROD = process.argv.includes('--prod')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

const CLASSES = [
  { label: 'retail/store ops',   re: /\b(store|retail|branch|shop)\s+(manager|assistant\s+manager|associate|lead|supervisor|team\s+lead)|cashier|parts\s+pro|merchandiser|stock(er|ing)\b|shift\s+(lead|supervisor|manager)/i },
  { label: 'auto service',       re: /\b(automotive|auto\s+parts|oil\s+change|tire|mechanic|car\s+care|collision|body\s+shop|lube)\b/i },
  { label: 'care/aide',          re: /\b(home\s+health|caregiver|personal\s+care|aide|patient\s+care\s+tech|phlebotom|orderl(y|ies)|med\s+tech)\b/i },
  { label: 'insurance sales',    re: /\binsurance\s+(sales|agent|producer)|claims\s+(rep|representative|adjust|processor)|\bsales\s+agent\b/i },
  { label: 'food service',       re: /\b(cook|chef|barista|dishwash|food\s+service|restaurant|server|bartend|busser|line\s+cook|prep\s+cook|catering)\b/i },
  { label: 'warehouse/driver',   re: /\b(warehouse|forklift|driver|delivery|cdl|loader|picker|packer|material\s+handler|dock\s+worker)\b/i },
  { label: 'guard/janitorial',   re: /\b(security\s+officer|security\s+guard|janitor|custodian|housekeep|groundskeep|maintenance\s+tech)\b/i },
  { label: 'hospitality/front',  re: /\b(front\s+desk|hotel|guest\s+service|housekeeping|concierge|valet)\b/i },
]

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name)
const Job = mongoose.models.Job || mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

// Discover which hide-flags exist on documents (needsLicense known; hourly name unknown)
const one = await Job.findOne({}).lean()
const flagCandidates = Object.keys(one).filter(k => /license|hourly|hidden|junk|field|category/i.test(k))
console.log('Flag-ish fields on a sample doc:', flagCandidates.join(', ') || '(none)')

const total = await Job.countDocuments({})
const jobs = await Job.find({}, { title: 1, company: 1, ats: 1, needsLicense: 1, isHourly: 1, hourly: 1, hidden: 1, field: 1 }).lean()
console.log(`Scanning ${jobs.length} of ${total} jobs (titles)…\n`)

const hiddenAlready = j => j.needsLicense === true || j.isHourly === true || j.hourly === true || j.hidden === true
let report = `# C10 junk measurement — ${new Date().toISOString().slice(0, 10)}\n\nTotal jobs: ${total}\n\n`
const inAnyClass = new Set()

for (const c of CLASSES) {
  const hits = jobs.filter(j => c.re.test(j.title || ''))
  const visible = hits.filter(j => !hiddenAlready(j))
  hits.forEach(j => inAnyClass.add(String(j._id)))
  const byCompany = {}
  for (const j of visible) byCompany[j.company] = (byCompany[j.company] || 0) + 1
  const topCos = Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 5)
  console.log(`${c.label.padEnd(20)} matched ${String(hits.length).padStart(5)} · already hidden ${String(hits.length - visible.length).padStart(4)} · VISIBLE ${String(visible.length).padStart(5)}`)
  report += `## ${c.label} — matched ${hits.length} · already hidden ${hits.length - visible.length} · VISIBLE ${visible.length}\n`
  report += `Top companies (visible): ${topCos.map(([k, v]) => `${k} (${v})`).join(' · ') || '—'}\n`
  report += `Sample VISIBLE titles — read these, the real patterns come from here:\n`
  for (const j of visible.slice(0, 12)) report += `- ${j.title}   [${j.company} · ${j.ats}]\n`
  report += '\n'
}
// Inverse sample: junk classes we DIDN'T imagine show up here, in random
// unmatched titles read with student eyes. Clean sample = evidence of coverage.
const unmatched = jobs.filter(j => !inAnyClass.has(String(j._id)) && !hiddenAlready(j))
const rand = [...unmatched].sort(() => Math.random() - 0.5).slice(0, 40)
report += `## INVERSE SAMPLE — 40 random titles matching NO class (hunt for a 9th class here)\n`
for (const j of rand) report += `- ${j.title}   [${j.company} · ${j.ats}]\n`
report += '\n'
console.log(`Inverse sample: 40 random unmatched titles written to the report — read them for missed classes.`)

const anyVisible = jobs.filter(j => inAnyClass.has(String(j._id)) && !hiddenAlready(j)).length
console.log(`\nANY class (deduped): matched ${inAnyClass.size} · VISIBLE ${anyVisible} of ${total} (${(anyVisible / total * 100).toFixed(1)}%)`)
report += `---\n**ANY class (deduped): matched ${inAnyClass.size} · VISIBLE ${anyVisible} of ${total} (${(anyVisible / total * 100).toFixed(1)}%)**\n`
fs.writeFileSync('junk-report.md', report)
console.log('📄 junk-report.md written — read every class section before Step 2.')
await mongoose.disconnect()
