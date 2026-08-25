// fetchAshby.mjs — the Ashby half of the pipeline.
//
// Runs the SAME gates in the SAME order as the Greenhouse fetcher, and writes the SAME
// shape into the same collection. Two sources, one board: any difference in how a job
// is judged would mean students see one standard on Greenhouse rows and another on
// Ashby rows, which is exactly the kind of quiet inconsistency this filter exists to
// prevent.
//
// WHAT MEASUREMENT SAID BEFORE THIS WAS WRITTEN  (ashbyCheck.mjs, 50 boards, 1827 jobs)
//   84% of listed jobs are US
//   the existing 95 patterns disqualify 12% of those — and caught real ITAR and
//     citizenship requirements, with no leaks in 1,531 jobs
//   only 40% were posted in the last 30 days: Ashby boards keep stale listings up far
//     longer than Greenhouse, so the age gate does most of the culling here
//   ~10 usable jobs per board, against roughly 4 per Greenhouse company
//
// HOW ASHBY DIFFERS FROM GREENHOUSE, and what each difference costs
//   descriptionPlain   already plain text — no stripHtml needed, unlike Greenhouse
//   publishedAt        a real posting date, so no updated_at guesswork
//   isListed           false means delisted; those never reach the board
//   secondaryLocations extra cities on one posting, which the location gate must see
//   id                 a UUID string, not a number
//
//   node fetchAshby.mjs            all boards in ashby_boards.txt
//   node fetchAshby.mjs --dry      fetch and judge, write nothing

import 'dotenv/config'
import fs from 'fs'
import mongoose from 'mongoose'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  isUSLocation,
  isDisqualified,
  isContractOrPartTime,
  detectExperienceLevel,
  detectWorkType,
  extractState,
  extractSalary,
  detectEmploymentType,
  extractYearsExperience,
} from './FetchJobs.mjs'
import { categorizeJob, requiresLicense } from './jobCategory.mjs'

const BOARDS_PATH  = 'ashby_boards.txt'
const NAMES_PATH   = 'ashby_names.json'
const MAX_AGE_DAYS = 30           // same window as Greenhouse; see FetchJobs.mjs

// The sweep deletes jobs it did not see at the source this run, and aborts if that
// share looks implausible.
//
// This is the guard against silent data loss. Genuine closures are a trickle — the
// first three runs swept 0, 25 and 3 jobs, well under 1%. A large share means the
// FETCH broke, not that employers closed everything at once: Ashby changing their API,
// this IP being throttled, boards returning empty. Without the guard the fetcher would
// read that silence as "all these jobs closed" and delete the lot.
//
// Named rather than inline so it can be raised deliberately for a one-off cleanup, the
// way MAX_SWEEP_SHARE was on the Greenhouse side, without editing sweep logic.
const MAX_SWEEP_SHARE = 0.25
const CONCURRENCY  = 6
const TIMEOUT_MS   = 15000
const DRY = process.argv.includes('--dry')

// ── The same schema the Greenhouse fetcher writes. Declared with the same guard so
// importing this file alongside FetchJobs.mjs cannot redefine the model.
const jobSchema = new mongoose.Schema({
  id: { type: String, unique: true }, title: String, company: String, companySlug: String,
  location: String, isRemote: Boolean, description: String, applyUrl: String,
  postedAt: Date, sponsorBadge: Boolean, field: String, needsLicense: Boolean,
  ats: String, fetchedAt: Date, experienceLevel: String, workType: String, state: String,
  salaryMin: Number, salaryMax: Number, employmentType: String,
  yearsMin: Number, yearsMax: Number, closed: Boolean,
}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

/**
 * Everywhere this posting says it is, as one string.
 *
 * A single Ashby posting can carry several cities in secondaryLocations. Judging only
 * the primary would drop a job listed as "London" that is also open in New York, and
 * would keep one listed as "New York" that is really the London office plus a US
 * satellite. Both are handed to the same isUSLocation the Greenhouse side uses.
 */
function allLocations(job) {
  const parts = [job.location, ...(job.secondaryLocations || []).map(s => s?.location)]
  return parts.filter(Boolean).join(', ')
}

async function fetchBoard(name) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { name, ok: false, status: res.status }
    const data = await res.json()
    return { name, ok: true, jobs: Array.isArray(data.jobs) ? data.jobs : [] }
  } catch (e) {
    return { name, ok: false, status: e.name }
  }
}

async function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error(`❌ Not found: ${BOARDS_PATH}`); process.exit(1)
  }
  const boards = fs.readFileSync(BOARDS_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)

  // Ashby's posting API returns no company name, only the board slug — so a card said
  // "baseten" where Greenhouse would have said "Baseten". Title-casing the slug is not
  // enough either: it turns claylabs into "Claylabs" (the company is Clay), brainco into
  // "Brainco" (Brain Co.) and starpath.space into "Starpath.space" (Starpath Robotics).
  //
  // These names were taken from real job postings that carried both the board URL and
  // the company's own name. Missing entries fall back to a tidied slug.
  const NAMES = fs.existsSync(NAMES_PATH)
    ? JSON.parse(fs.readFileSync(NAMES_PATH, 'utf-8'))
    : {}
  console.log(`🏷️  Display names known for ${Object.keys(NAMES).length} boards`)

  const displayName = slug => NAMES[slug]
    || slug.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

  if (!DRY) {
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI not set. Run from the backend folder where .env lives.')
      process.exit(1)
    }
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('✅ Connected to MongoDB')
  } else {
    console.log('🧪 DRY RUN — nothing will be written')
  }

  const runStart = new Date()
  const ageCutoff = new Date(runStart.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
  console.log(`🔎 ${boards.length} Ashby boards · keeping jobs newer than ${MAX_AGE_DAYS} days\n`)

  let seen = 0, saved = 0, skipped = 0
  let delisted = 0, tooOld = 0, nonUS = 0, disqualified = 0, contractOrPartTime = 0, noDate = 0
  let deadBoards = 0
  const okBoards = []

  for (let i = 0; i < boards.length; i += CONCURRENCY) {
    const results = await Promise.all(boards.slice(i, i + CONCURRENCY).map(fetchBoard))

    for (const r of results) {
      if (!r.ok) { deadBoards++; continue }
      okBoards.push(r.name)

      for (const job of r.jobs) {
        seen++

        // ── Gates, in the same order as the Greenhouse fetcher.
        if (job.isListed === false) { delisted++; continue }

        // Age first, like Greenhouse: cheapest gate, and it removes the most here.
        const posted = job.publishedAt ? new Date(job.publishedAt) : null
        if (!posted || Number.isNaN(posted.getTime())) { noDate++; continue }
        if (posted < ageCutoff) { tooOld++; continue }

        const location = allLocations(job)
        // Unlike Greenhouse, an Ashby posting with no location at all is dropped rather
        // than assumed American. The board promises US roles, and there is no second
        // signal here to fall back on.
        if (!location || !isUSLocation(location)) { nonUS++; continue }

        // Already plain text. No stripHtml, which is where the Greenhouse side spends
        // most of its work.
        const plainText = String(job.descriptionPlain || '')
        const fullText = `${job.title || ''}\n${plainText}`
        if (isDisqualified(fullText, job.title)) { disqualified++; continue }
        if (isContractOrPartTime(plainText, job.title || '')) { contractOrPartTime++; continue }

        // Every derived field comes from the SAME functions the Greenhouse side calls.
        // Skipping them would save Ashby jobs with no experience level, work type or
        // state — invisible to three of the board's four filters, and silently so.
        const salary = extractSalary(plainText)
        const years  = extractYearsExperience(plainText)

        // ── Save. Same fields, same collection, ats marks the source.
        const doc = {
          id:           `ashby_${job.id}`,   // prefixed: Ashby ids are UUIDs, Greenhouse's are numeric
          title:        job.title || '',
          company:      displayName(r.name),
          companySlug:  r.name,
          location:     job.location || location,
          isRemote:     job.isRemote === true || /remote/i.test(location),
          description:  plainText.slice(0, 500),
          applyUrl:     job.applyUrl || job.jobUrl || '',
          postedAt:     posted,
          sponsorBadge: false,
          field:        categorizeJob(job.title || ''),
          needsLicense: requiresLicense(job.title || ''),
          ats:          'ashby',
          fetchedAt:    new Date(),
          closed:       false,
          experienceLevel: detectExperienceLevel(job.title || ''),
          workType:        detectWorkType(location, plainText),
          state:           extractState(location),
          salaryMin:       salary ? salary.min : null,
          salaryMax:       salary ? salary.max : null,
          employmentType:  detectEmploymentType(plainText),
          yearsMin:        years ? years.min : null,
          yearsMax:        years ? years.max : null,
        }

        if (DRY) { saved++; continue }
        try {
          await Job.updateOne({ id: doc.id }, doc, { upsert: true })
          saved++
        } catch {
          skipped++
        }
      }
    }
    process.stdout.write(`\r   boards ${Math.min(i + CONCURRENCY, boards.length)}/${boards.length} · saved ${saved}   `)
  }

  console.log('\n\n' + '─'.repeat(58))
  console.log(`   Boards answered:   ${okBoards.length}  (${deadBoards} did not)`)
  console.log(`   Jobs seen:         ${seen}`)
  console.log(`   Delisted:          ${delisted}`)
  console.log(`   No posting date:   ${noDate}`)
  console.log(`   Older than ${MAX_AGE_DAYS}d:   ${tooOld}`)
  console.log(`   Non-US:            ${nonUS}`)
  console.log(`   Disqualified:      ${disqualified}`)
  console.log(`   Contract/part-time:${contractOrPartTime}`)
  console.log(`   SAVED:             ${saved}${DRY ? '  (dry run — nothing written)' : ''}`)
  if (skipped) console.log(`   Write errors:      ${skipped}`)
  console.log('─'.repeat(58))

  if (!DRY) {
    // ── STALE SWEEP, same reasoning as the Greenhouse side.
    // Ashby has no "this job closed" signal either; a closed posting simply stops being
    // returned. Only boards that answered THIS run are swept, so an outage that takes a
    // board offline entirely cannot wipe that company's jobs — they are simply not
    // considered. The share guard covers the other case: boards that answer but return
    // nothing useful.
    if (okBoards.length) {
      const stale = await Job.countDocuments({ ats: 'ashby', companySlug: { $in: okBoards }, fetchedAt: { $lt: runStart } })
      const total = await Job.countDocuments({ ats: 'ashby' })
      const share = total ? stale / total : 0
      if (share > MAX_SWEEP_SHARE) {
        console.log(`   🛑 Sweep ABORTED: would remove ${stale} of ${total} Ashby jobs (${Math.round(share * 100)}%).`)
        console.log(`      Guard is ${Math.round(MAX_SWEEP_SHARE * 100)}%. Too many to be genuine closures —`)
        console.log('      the fetch itself probably failed. Nothing deleted. Investigate before raising this.')
      } else if (stale > 0) {
        const res = await Job.deleteMany({ ats: 'ashby', companySlug: { $in: okBoards }, fetchedAt: { $lt: runStart } })
        console.log(`   🗑️  Removed ${res.deletedCount} Ashby jobs no longer at the source.`)
      } else {
        console.log('   ✅ Nothing stale.')
      }
    }

    const gh = await Job.countDocuments({ ats: 'greenhouse', closed: { $ne: true } })
    const ash = await Job.countDocuments({ ats: 'ashby', closed: { $ne: true } })
    console.log(`\n   Board now: ${gh} greenhouse + ${ash} ashby = ${gh + ash}`)
    await mongoose.disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(async e => {
    console.error('❌ Failed:', e)
    try { await mongoose.disconnect() } catch {}
    process.exit(1)
  })
}

export { fetchBoard, allLocations }

