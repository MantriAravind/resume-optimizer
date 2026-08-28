import 'dotenv/config'
import mongoose from 'mongoose'

await mongoose.connect(process.env.MONGODB_URI)
const Job = mongoose.connection.collection('jobs')

// Every unambiguous slip from the measurement run, plus the Georgia offenders.
// Question this answers: is the CURRENT filter still passing these (recent
// fetchedAt), or are they STALE rows saved under an older filter that linger
// because a dropped job is skipped, not deleted (recent postedAt but old
// fetchedAt)? fetchAshby refreshes fetchedAt on every upsert, so fetchedAt is
// the last time this row PASSED the filter.
const rows = await Job.find({
  closed: { $ne: true },
  $or: [
    { location: /Bulgaria|Lithuania|Uzbekistan|Serbia|Armenia|Romania|Ukraine|Tbilisi/i },
    { company: /^Exadel/i },
  ],
}).project({ company: 1, ats: 1, location: 1, fetchedAt: 1, postedAt: 1, title: 1 })
  .sort({ fetchedAt: -1 }).toArray()

const now = Date.now()
const H = 3600 * 1000
console.log(`${rows.length} slipped rows\n`)
for (const r of rows) {
  const f = r.fetchedAt ? ((now - new Date(r.fetchedAt)) / H).toFixed(1) + 'h ago' : 'NULL'
  console.log(`fetched ${String(f).padStart(10)} | ${String(r.ats).padEnd(11)} | ${String(r.company).padEnd(24)} | "${r.location}"`)
}

console.log(`
Reading:
- fetchedAt within ~6h  -> the CURRENT filter passed it on the last cron run.
    * Greenhouse/Exadel rows here are expected: the Georgia bug (until the fix lands).
    * Ashby rows here mean a genuinely dual-location job (joined string had a US
      part) whose stored 'location' shows only the foreign primary - display issue,
      not a filter hole.
- fetchedAt older than the last run -> STALE row: today's filter already rejects
  it, the row just lingers until the 30-day purge. Fix = purge, not code.`)

await mongoose.disconnect()
