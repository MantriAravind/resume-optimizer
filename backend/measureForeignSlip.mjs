import 'dotenv/config'
import mongoose from 'mongoose'

await mongoose.connect(process.env.MONGODB_URI)
const Job = mongoose.connection.collection('jobs')

console.log('=== Foreign-slip scope measurement ===\n')

// 1. Count live jobs whose location mentions each suspect country.
//    NOTE: "Georgia" over-counts — it matches the US state too. Treated separately below.
const suspects = ['Bulgaria', 'Georgia', 'Lithuania', 'Poland', 'Uzbekistan',
  'Armenia', 'Serbia', 'Romania', 'Ukraine', 'India', 'Mexico', 'Jordan',
  'Canada', 'Brazil', 'Colombia', 'Philippines', 'Vietnam', 'Nigeria']

console.log('--- Counts by country keyword (Georgia inflated by US state) ---')
for (const country of suspects) {
  const n = await Job.countDocuments({
    closed: { $ne: true },
    location: { $regex: `\\b${country}\\b`, $options: 'i' }
  })
  if (n > 0) console.log(`${country}: ${n}`)
}

// 2. Unambiguous foreign slips grouped by company (Georgia excluded on purpose —
//    these countries have no US-state collision, so every hit is a real leak).
console.log('\n--- Unambiguous foreign slips, by company ---')
const rows = await Job.aggregate([
  { $match: {
      closed: { $ne: true },
      location: /Bulgaria|Lithuania|Uzbekistan|Serbia|Armenia|Romania|Ukraine|Vietnam|Philippines|Nigeria/i
  } },
  { $group: { _id: { company: '$company', ats: '$ats' }, count: { $sum: 1 }, sample: { $first: '$location' } } },
  { $sort: { count: -1 } }
]).toArray()
for (const r of rows) {
  console.log(`${r._id.company} [${r._id.ats}] — ${r.count} job(s) — e.g. "${r.sample}"`)
}
if (rows.length === 0) console.log('(none found via `location` string — data may live in `locations` array instead)')

// 3. Georgia disambiguation: pull the actual location strings so we can see
//    which are Atlanta-style (US state) and which are country-style (multi-country lists).
console.log('\n--- Sample of "Georgia" location strings (up to 25 distinct) ---')
const ga = await Job.aggregate([
  { $match: { closed: { $ne: true }, location: /\bGeorgia\b/i } },
  { $group: { _id: '$location', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 25 }
]).toArray()
for (const g of ga) console.log(`${g.count} × "${g._id}"`)

// 4. Same checks against the `locations` array, in case the string field is
//    normalized and the raw evidence lives in the array.
console.log('\n--- Same countries via `locations` array (if present) ---')
const arrRows = await Job.aggregate([
  { $match: {
      closed: { $ne: true },
      'locations.location': /Bulgaria|Lithuania|Uzbekistan|Serbia|Armenia|Romania|Ukraine/i
  } },
  { $group: { _id: '$company', count: { $sum: 1 }, sample: { $first: '$location' } } },
  { $sort: { count: -1 } },
  { $limit: 25 }
]).toArray()
for (const r of arrRows) console.log(`${r._id} — ${r.count} job(s) — card shows "${r.sample}"`)
if (arrRows.length === 0) console.log('(none via locations array)')

await mongoose.disconnect()
console.log('\nDone.')
