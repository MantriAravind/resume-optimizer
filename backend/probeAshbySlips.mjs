import 'dotenv/config'
import mongoose from 'mongoose'
import { classifyLocation } from './FetchJobs.mjs'

// The seven companies whose foreign jobs passed the 06:16-06:19 run. This probe
// answers: does the NEW filter (the FetchJobs.mjs now installed next to this
// file) drop them at source, and which survive as genuine US dual-location?

await mongoose.connect(process.env.MONGODB_URI)
const Job = mongoose.connection.collection('jobs')
const names = ['Ruby Labs','Fyst','Salmon Group','Patrianna','Medialicious','Foxelligroup','Pavebank']
const slugs = await Job.distinct('companySlug', { ats: 'ashby', company: { $in: names } })
await mongoose.disconnect()
console.log('Ashby board slugs:', slugs, '\n')

// Same joining the fetcher does (fetchAshby.mjs allLocations).
const allLocations = job =>
  [job.location, ...(job.secondaryLocations || []).map(s => s?.location)].filter(Boolean).join(', ')

let drop = 0, keep = 0
for (const slug of slugs) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`
  let data
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { console.log(`${slug}: HTTP ${res.status} — skipped`); continue }
    data = await res.json()
  } catch (e) { console.log(`${slug}: ${e.name} — skipped`); continue }

  console.log(`── ${slug} — ${(data.jobs || []).length} postings`)
  for (const job of data.jobs || []) {
    const joined = allLocations(job)
    const k = classifyLocation(joined)
    const kept = (k === 'us' || k === 'weak-us' || k === 'ambiguous')
    kept ? keep++ : drop++
    console.log(`  ${kept ? 'KEEP' : 'DROP'} ${k.padEnd(9)} | primary "${job.location}" | joined "${joined}"`)
  }
}
console.log(`\nNew filter verdict across these boards: ${drop} drop, ${keep} keep.`)
console.log('Any KEEP whose primary is foreign = genuine dual-location job whose card')
console.log('shows the wrong half — a display question, not a filter hole.')
