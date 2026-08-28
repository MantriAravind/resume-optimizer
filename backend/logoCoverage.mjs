import 'dotenv/config'
import mongoose from 'mongoose'

// Measures logo coverage the same way server.js builds it: a card gets a logo
// only if `companies` has a logoStatus:'provider' row whose `${ats}|${slug}`
// matches the job. Everything else renders initials. Output: coverage %, and
// the missing companies ranked by open-job count — the fix worklist.

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection
const companies = await db.collection('companies')
  .find({ logoStatus: 'provider' })
  .project({ ats: 1, slug: 1, 'branding.logoUrl': 1 }).toArray()
const brandKeys = new Set(companies.map(c => `${c.ats}|${c.slug}`))
console.log(`companies collection: ${companies.length} provider records`)

const jobs = await db.collection('jobs').aggregate([
  { $match: { closed: { $ne: true } } },
  { $group: { _id: { ats: '$ats', slug: '$companySlug', company: '$company' }, n: { $sum: 1 } } },
]).toArray()

let coveredJobs = 0, totalJobs = 0
const missing = []
for (const r of jobs) {
  totalJobs += r.n
  if (brandKeys.has(`${r._id.ats}|${r._id.slug}`)) coveredJobs += r.n
  else missing.push(r)
}
missing.sort((a, b) => b.n - a.n)

console.log(`\nOpen jobs: ${totalJobs}`)
console.log(`With logo record: ${coveredJobs} (${(100 * coveredJobs / totalJobs).toFixed(1)}%)`)
console.log(`Without: ${totalJobs - coveredJobs} across ${missing.length} companies`)

console.log(`\n── Top 40 missing companies by job count ──`)
for (const r of missing.slice(0, 40)) {
  console.log(`  ${String(r.n).padStart(4)} × [${r._id.ats}] ${r._id.company}  (slug: ${r._id.slug})`)
}

// Diagnose the known initials cases: what does the registry hold for them?
console.log(`\n── Known problem slugs: what the companies collection has ──`)
const probes = [/otter/i, /aircall/i, /exadel/i, /horizon3/i]
for (const p of probes) {
  const rows = await db.collection('companies')
    .find({ $or: [{ slug: p }, { name: p }] })
    .project({ ats: 1, slug: 1, name: 1, logoStatus: 1, 'branding.logoUrl': 1 }).toArray()
  console.log(`  ${p}: ${rows.length ? '' : 'NO ROWS'}`)
  for (const r of rows) console.log(`    [${r.ats}] slug="${r.slug}" status=${r.logoStatus} logo=${r.branding?.logoUrl ? 'yes' : 'NO'}`)
}

await mongoose.disconnect()
