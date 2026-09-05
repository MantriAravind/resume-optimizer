// Deep-clean PROTOTYPE, scoped: re-fetch FULL text for every visible job of the
// named companies and re-judge with the CURRENT isDisqualified. The 200-sample
// caught boilerplate refusals (Ameriprise/Allstate/Ag) that likely sit in EVERY
// posting of those tenants, deep past the stored preview.
//   node miniDeepClean.mjs --prod --dry     judge + list, delete nothing
//   node miniDeepClean.mjs --prod           delete confirmed failures
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { isDisqualified, stripHtml } from './FetchJobs.mjs'
dotenv.config()

const PROD = process.argv.includes('--prod')
const DRY = process.argv.includes('--dry')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set'); process.exit(1) }
const API = 'https://resume-optimizer-cuii.onrender.com'
const rIdx = process.argv.indexOf('--random')
const RANDOM = rIdx > -1 ? Number(process.argv[rIdx + 1]) : 0
const TARGETS = [
  { companySlug: 'ameriprise' }, { companySlug: 'allstate' }, { companySlug: 'ag' },
  { company: /neros/i },
]
const sleep = ms => new Promise(r => setTimeout(r, ms))

await mongoose.connect(uri)
console.log('DB:', mongoose.connection.name, DRY ? '· DRY' : '· DELETING FAILURES')
const J = mongoose.connection.db.collection('jobs')
// --random N: false-positive check — N random VISIBLE jobs across all sources,
// full text through the current filter. Any failure that is not a genuine
// refusal means a pattern is too wide. Run before pushing new families.
const jobs = RANDOM
  ? (await Promise.all(['greenhouse','smartrecruiters','ashby','lever','workable','workday'].map(ats =>
      J.aggregate([{ $match: { ats, junkClass: null, needsLicense: { $ne: true } } },
        { $sample: { size: Math.ceil(RANDOM / 6) } },
        { $project: { id: 1, title: 1, company: 1, ats: 1 } }]).toArray()))).flat().slice(0, RANDOM)
  : (await Promise.all(TARGETS.map(t => J.find(t, { projection: { id: 1, title: 1, company: 1, ats: 1 } }).toArray()))).flat()
console.log('scoped jobs to re-judge:', jobs.length, '\n')

const failures = []
let errors = 0
for (const j of jobs) {
  try {
    const r = await fetch(`${API}/jobs/${encodeURIComponent(j.id)}`, { signal: AbortSignal.timeout(20000) })
    if (!r.ok) { errors++; continue }
    const full = stripHtml(String((await r.json()).description || ''))
    if (isDisqualified(`${j.title}\n${full}`, j.title)) {
      failures.push(j)
      const m = full.match(/.{0,60}(sponsor|citizen|u\.?s\.?[\s-]person|clearance)[\s\S]{0,60}/i)
      console.log(`❌ ${j.company} · ${j.title}`)
      console.log(`   ...${(m ? m[0] : '(pattern deep in text)').replace(/\s+/g, ' ').trim()}...`)
    } else process.stdout.write('.')
    await sleep(200)
  } catch { errors++ }
}
console.log(`\n\n${jobs.length} re-judged · ${failures.length} FAIL current filter · ${errors} errors`)
if (DRY) { console.log('DRY — nothing deleted.'); process.exit(0) }
const r = await J.deleteMany({ _id: { $in: failures.map(f => f._id) } })
console.log(`Deleted ${r.deletedCount}.`)
process.exit(0)
