import 'dotenv/config'
import mongoose from 'mongoose'
import { classifyLocation } from './FetchJobs.mjs'

// Closes (closed: true — NOT delete) every open job whose stored location the
// CURRENT filter classifies as foreign. Reversible; the board already hides
// closed jobs; the 30-day purge removes them for good later.
//
//   node purgeForeign.mjs                    -> DRY RUN: report only, touch nothing
//   node purgeForeign.mjs --apply            -> close 'foreign' rows
//   node purgeForeign.mjs --apply --include-unknown
//                                            -> also close 'unknown' rows (review
//                                               the dry run list before using this)
//
// Safety cap: aborts if it would close more than MAX_PURGE_SHARE of open jobs.

const APPLY = process.argv.includes('--apply')
const INCLUDE_UNKNOWN = process.argv.includes('--include-unknown')
const MAX_PURGE_SHARE = 0.25

await mongoose.connect(process.env.MONGODB_URI)
const Job = mongoose.connection.collection('jobs')

const open = await Job.find({ closed: { $ne: true } })
  .project({ _id: 1, company: 1, ats: 1, location: 1, title: 1 }).toArray()
console.log(`${open.length} open jobs on the board`)

const foreign = [], unknown = []
for (const j of open) {
  const k = classifyLocation(j.location || '')
  if (k === 'foreign') foreign.push(j)
  else if (k === 'unknown') unknown.push(j)
}

const byCompany = list => {
  const m = new Map()
  for (const j of list) m.set(j.company, (m.get(j.company) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

console.log(`\n── classified FOREIGN by the current filter: ${foreign.length}`)
for (const [c, n] of byCompany(foreign)) console.log(`  ${String(n).padStart(3)} × ${c}`)
for (const j of foreign) console.log(`    [${j.ats}] ${j.company} — "${j.location}" — ${j.title}`)

console.log(`\n── classified UNKNOWN (listed only; closed only with --include-unknown): ${unknown.length}`)
for (const [c, n] of byCompany(unknown)) console.log(`  ${String(n).padStart(3)} × ${c}`)
for (const j of unknown) console.log(`    [${j.ats}] ${j.company} — "${j.location}" — ${j.title}`)

const targets = INCLUDE_UNKNOWN ? [...foreign, ...unknown] : foreign
const share = open.length ? targets.length / open.length : 0
console.log(`\nWould close ${targets.length} of ${open.length} open jobs (${(share * 100).toFixed(2)}%)`)

if (share > MAX_PURGE_SHARE) {
  console.log(`ABORT: exceeds MAX_PURGE_SHARE=${MAX_PURGE_SHARE}. Something is wrong — investigate before purging.`)
} else if (!APPLY) {
  console.log('DRY RUN — nothing changed. Re-run with --apply to close these rows.')
} else if (targets.length === 0) {
  console.log('Nothing to close.')
} else {
  const res = await Job.updateMany(
    { _id: { $in: targets.map(j => j._id) } },
    { $set: { closed: true } }
  )
  console.log(`Closed ${res.modifiedCount} rows. Reversible: flip closed back to false by _id if needed.`)
}

await mongoose.disconnect()
