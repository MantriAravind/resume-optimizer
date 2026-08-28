import 'dotenv/config'
import mongoose from 'mongoose'
import { classifyLocation, isUSLocation } from './FetchJobs.mjs'

// Verifies the displayLocation change against LIVE Ashby data before any push.
// For every posting on the affected boards, prints: old display (primary),
// new display, and whether the job passes the gate at all. The change is
// correct if: (a) every gate-passing job whose primary is foreign now shows a
// US location, (b) no US-primary job's display changed.

await mongoose.connect(process.env.MONGODB_URI)
const Job = mongoose.connection.collection('jobs')
const slugs = await Job.distinct('companySlug', { ats: 'ashby', company: { $in: ['ElevenLabs', 'Ignition'] } })
await mongoose.disconnect()
console.log('Boards:', slugs, '\n')

const parts = job => [job.location, ...(job.secondaryLocations || []).map(s => s?.location)].filter(Boolean)
// Same logic as the new fetchAshby displayLocation()
function displayLocation(job) {
  const p = parts(job)
  const primary = p[0] || ''
  const k = classifyLocation(primary)
  if (k === 'us' || k === 'weak-us' || k === 'ambiguous') return primary
  const us = p.find(x => { const pk = classifyLocation(x); return pk === 'us' || pk === 'weak-us' })
  return us || primary
}

let changed = 0, unchanged = 0
for (const slug of slugs) {
  let data
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { console.log(`${slug}: HTTP ${res.status}`); continue }
    data = await res.json()
  } catch (e) { console.log(`${slug}: ${e.name}`); continue }

  console.log(`── ${slug} — ${(data.jobs || []).length} postings`)
  for (const job of data.jobs || []) {
    const joined = parts(job).join(', ')
    if (!joined || !isUSLocation(joined)) continue   // gate drops it; display irrelevant
    const oldD = job.location || ''
    const newD = displayLocation(job)
    const diff = oldD !== newD
    diff ? changed++ : unchanged++
    console.log(`  ${diff ? 'CHANGED ' : 'same    '} "${oldD}" -> "${newD}"  | ${job.title}`)
  }
}
console.log(`\n${changed} displays change, ${unchanged} stay the same.`)
console.log('Every CHANGED row must end in a US location; every US-primary row must say "same".')
