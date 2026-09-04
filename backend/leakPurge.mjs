// Emergency leak purge: scan every VISIBLE job's stored text for the new
// acronym/other-visas disqualifier phrases and remove confirmed promise-breakers.
// Uses the same phrases as the new FetchJobs patterns — a job matching them in
// its stored (truncated) description would be rejected by the patched fetcher
// anyway; removal just doesn't wait 6 hours for the cycle.
//   node leakPurge.mjs --prod --dry     list them, delete nothing
//   node leakPurge.mjs --prod           delete confirmed leaks
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const PROD = process.argv.includes('--prod')
const DRY = process.argv.includes('--dry')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

const PHRASES = [
  /\buscs?\s*(\/|,|\s+(and|or)\s+)\s*(gc|green\s+card)s?\b/i,
  /\b(gc|green\s+card)s?\s*(\/|,|\s+(and|or)\s+)\s*uscs?\b/i,
  /\bonly\s+uscs?\b/i,
  /\bmust\s+be\s+(a\s+)?usc\b/i,
  /\bgc\s+holders?\b/i,
  /\bmust\s+be\s+([\w-]+\s+){0,3}green\s+card\s+holders?\b/i,
  /\bgreen\s+card\s+holders?\s+only\b/i,
  /\bcitizens?\s+(and|or|\/)\s*(lawful\s+)?green\s+card\s+holders?\b/i,
  /\bno\s+other\s+visas?\b/i,
  /\bother\s+visas?\s+(will\s+)?not\s+(be\s+)?(considered|accepted|eligible)\b/i,
  /\bvisas?\s+will\s+not\s+be\s+(considered|accepted)\b/i,
]

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name, DRY ? '· DRY' : '· DELETING CONFIRMED LEAKS')
const Job = mongoose.models.Job || mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

const jobs = await Job.find({}, { title: 1, company: 1, ats: 1, description: 1 }).lean()
const leaks = []
for (const j of jobs) {
  const text = `${j.title || ''}\n${j.description || ''}`
  const hit = PHRASES.find(re => re.test(text))
  if (hit) leaks.push({ j, hit })
}
console.log(`Scanned ${jobs.length} · confirmed leaks in stored text: ${leaks.length}\n`)
for (const { j, hit } of leaks) {
  const m = `${j.title}\n${j.description}`.match(new RegExp(`.{0,50}${hit.source}.{0,50}`, 'i'))
  console.log(`❌ ${j.ats}/${j.company} · ${j.title}`)
  console.log(`   ...${(m ? m[0] : '').replace(/\s+/g, ' ').trim()}...`)
}
if (DRY) { console.log('\nDRY — nothing deleted. Note: stored descriptions are truncated at 500 chars;'); console.log('deep-in-ad leaks are cleaned by the next fetch cycles through the new patterns.'); await mongoose.disconnect(); process.exit(0) }

const r = await Job.deleteMany({ _id: { $in: leaks.map(l => l.j._id) } })
console.log(`\nDeleted ${r.deletedCount} promise-breaking jobs. Cycles handle any deep-text siblings.`)
await mongoose.disconnect()
