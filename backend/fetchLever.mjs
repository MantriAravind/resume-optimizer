// fetchLever.mjs — the Lever quarter of the pipeline.
//
// Same gates in the same order as the Greenhouse and Ashby fetchers, writing the same
// shape into the same collection. Four sources, one board, one standard. See
// fetchAshby.mjs for why that matters; nothing here departs from it without saying so.
//
// WHAT VALIDATION SAID BEFORE THIS WAS WRITTEN  (validateLever.mjs, 2026-09-01)
//   312 known slugs, 303 live, 9 dead (404), 0 errors
//   18,867 open postings across the live boards, before any gate
//
// HOW LEVER DIFFERS FROM ASHBY, and what each difference costs
//   text                   the title field is called `text`
//   categories.allLocations extra cities on one posting — same role as Ashby's
//                          secondaryLocations, handled the same way
//   country                an ISO code Ashby does not give. Used as a second US signal
//                          when the location string alone is unreadable.
//   descriptionPlain       ONLY the opening paragraph. The requirements — where "must
//                          be a US citizen" actually lives — are in a separate `lists`
//                          array of {text, content}. Judging descriptionPlain alone
//                          would let citizenship requirements through untouched, so
//                          every list is joined in before the disqualifier gate.
//   createdAt              milliseconds since epoch, not ISO. Lever boards keep old
//                          postings up indefinitely, so the age gate does a lot here.
//   hostedUrl / applyUrl   two URLs. hostedUrl is the posting page; applyUrl goes
//                          straight to the form. The card links to hostedUrl so the
//                          student reads the posting before applying.
//   no company name        same as Ashby: the API returns the slug only, so display
//                          names come from lever_names.json.
//
//   node fetchLever.mjs            all boards in lever_boards.txt
//   node fetchLever.mjs --dry      fetch and judge, write nothing, print a sample

import 'dotenv/config'
import fs from 'fs'
import mongoose from 'mongoose'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  stripHtml,
  isUSLocation,
  classifyLocation,
  isDisqualified,
  isContractOrPartTime,
  detectExperienceLevel,
  detectWorkType,
  extractState,
  extractSalary,
  detectEmploymentType,
  extractYearsExperience,
} from './FetchJobs.mjs'
import { categorizeJob, requiresLicense, junkClass } from './jobCategory.mjs'

const BOARDS_PATH  = 'lever_boards.txt'
const NAMES_PATH   = 'lever_names.json'
const MAX_AGE_DAYS = 30           // same window as the other three sources

// Same guard, same reasoning as fetchAshby.mjs: a large stale share means the FETCH
// broke, not that employers closed everything at once. Abort rather than delete.
const MAX_SWEEP_SHARE = 0.25
const CONCURRENCY  = 6
const TIMEOUT_MS   = 15000
const DRY = process.argv.includes('--dry')
const SAMPLE_SIZE  = 20           // dry run prints this many passed jobs for a hand check

// The same schema the other fetchers write, declared with the same guard.
const jobSchema = new mongoose.Schema({
  id: { type: String, unique: true }, title: String, company: String, companySlug: String,
  location: String, isRemote: Boolean, description: String, applyUrl: String,
  postedAt: Date, sponsorBadge: Boolean, field: String, needsLicense: Boolean, junkClass: String,
  ats: String, fetchedAt: Date, experienceLevel: String, workType: String, state: String,
  salaryMin: Number, salaryMax: Number, employmentType: String,
  yearsMin: Number, yearsMax: Number, closed: Boolean,
}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

/**
 * Everywhere this posting says it is, as one string. Lever gives a primary in
 * categories.location and, on newer boards, the full set in categories.allLocations.
 * Both are read; duplicates are collapsed so "New York, New York" does not confuse
 * the state extractor.
 */
function allLocations(job) {
  const c = job.categories || {}
  const parts = [c.location, ...(Array.isArray(c.allLocations) ? c.allLocations : [])]
    .filter(Boolean).map(s => String(s).trim())
  return [...new Set(parts)].join(', ')
}

/**
 * The location the CARD shows — same logic as the Ashby side. The gate judges the
 * joined string; the card should show the part that reads US, not a foreign primary.
 */
function displayLocation(job) {
  const c = job.categories || {}
  const parts = [c.location, ...(Array.isArray(c.allLocations) ? c.allLocations : [])].filter(Boolean)
  const primary = parts[0] || ''
  const k = classifyLocation(primary)
  if (k === 'us' || k === 'weak-us' || k === 'ambiguous') return primary
  const us = parts.find(p => {
    const pk = classifyLocation(p)
    return pk === 'us' || pk === 'weak-us'
  })
  return us || primary
}

/**
 * The full text the filter judges. descriptionPlain alone is the opening paragraph;
 * the requirements live in `lists`. A citizenship requirement sits in a list called
 * "Requirements" or "What you'll need" nine times out of ten, so leaving lists out
 * would make the disqualifier gate blind to exactly the thing it exists to catch.
 */
function fullPlainText(job) {
  const lists = (Array.isArray(job.lists) ? job.lists : [])
    .map(l => `${l?.text || ''}\n${stripHtml(l?.content || '')}`)
    .join('\n')
  return [job.descriptionPlain || stripHtml(job.description || ''), lists, job.additionalPlain || '']
    .filter(Boolean).join('\n')
}

async function fetchBoard(name) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(name)}?mode=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { name, ok: false, status: res.status }
    const data = await res.json()
    return { name, ok: true, jobs: Array.isArray(data) ? data : [] }
  } catch (e) {
    return { name, ok: false, status: e.name }
  }
}

async function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error(`❌ Not found: ${BOARDS_PATH}. Run validateLever.mjs first.`); process.exit(1)
  }
  const boards = fs.readFileSync(BOARDS_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)

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
    console.log(`✅ Connected to MongoDB (${mongoose.connection.db.databaseName})`)
  } else {
    console.log('🧪 DRY RUN — nothing will be written')
  }

  const runStart = new Date()
  const ageCutoff = new Date(runStart.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
  console.log(`🔎 ${boards.length} Lever boards · keeping jobs newer than ${MAX_AGE_DAYS} days\n`)

  let seen = 0, saved = 0, skipped = 0
  let tooOld = 0, nonUS = 0, disqualified = 0, contractOrPartTime = 0, noDate = 0
  let deadBoards = 0
  const okBoards = []
  const sample = []

  for (let i = 0; i < boards.length; i += CONCURRENCY) {
    const results = await Promise.all(boards.slice(i, i + CONCURRENCY).map(fetchBoard))

    for (const r of results) {
      if (!r.ok) { deadBoards++; continue }
      okBoards.push(r.name)

      for (const job of r.jobs) {
        seen++

        // ── Gates, in the same order as the other fetchers.
        // Lever has no isListed flag: anything the API returns is live.

        // Age first: cheapest gate, and on Lever it removes the most.
        const posted = job.createdAt ? new Date(Number(job.createdAt)) : null
        if (!posted || Number.isNaN(posted.getTime())) { noDate++; continue }
        if (posted < ageCutoff) { tooOld++; continue }

        // Location. Lever's `country` is a second signal the other sources lack:
        // a posting with an unreadable location string but country US is kept as a
        // US role, and one whose location reads foreign is dropped even if country
        // says otherwise, because the location is what the student sees.
        let location = allLocations(job)
        const country = String(job.country || '').toUpperCase()
        if (!location) {
          if (country === 'US') location = 'United States'
          else { nonUS++; continue }
        } else if (!isUSLocation(location)) { nonUS++; continue }

        const plainText = fullPlainText(job)
        const title = job.text || ''
        const fullText = `${title}\n${plainText}`
        if (isDisqualified(fullText, title)) { disqualified++; continue }
        if (isContractOrPartTime(plainText, title)) { contractOrPartTime++; continue }

        // Same derived fields, same functions, as the other three sources.
        const salary = extractSalary(plainText)
        const years  = extractYearsExperience(plainText)
        const workplace = String(job.workplaceType || '').toLowerCase()

        const doc = {
          id:           `lever_${job.id}`,
          title,
          company:      displayName(r.name),
          companySlug:  r.name,
          location:     displayLocation(job) || location,
          isRemote:     workplace === 'remote' || /remote/i.test(location),
          description:  plainText.slice(0, 500),
          applyUrl:     job.hostedUrl || job.applyUrl || '',
          postedAt:     posted,
          sponsorBadge: false,
          field:        categorizeJob(title),
          needsLicense: requiresLicense(title),
          junkClass: junkClass(title) ?? null,
          ats:          'lever',
          fetchedAt:    new Date(),
          closed:       false,
          experienceLevel: detectExperienceLevel(title),
          workType:        detectWorkType(location, plainText),
          state:           extractState(location),
          salaryMin:       salary ? salary.min : null,
          salaryMax:       salary ? salary.max : null,
          employmentType:  detectEmploymentType(plainText),
          yearsMin:        years ? years.min : null,
          yearsMax:        years ? years.max : null,
        }

        if (DRY) {
          saved++
          // Reservoir sample: every passed job has an equal chance of being shown,
          // so the hand check covers the whole run, not the first two boards.
          if (sample.length < SAMPLE_SIZE) sample.push(doc)
          else {
            const j = Math.floor(Math.random() * saved)
            if (j < SAMPLE_SIZE) sample[j] = doc
          }
          continue
        }
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
  console.log(`   No posting date:   ${noDate}`)
  console.log(`   Older than ${MAX_AGE_DAYS}d:   ${tooOld}`)
  console.log(`   Non-US:            ${nonUS}`)
  console.log(`   Disqualified:      ${disqualified}`)
  console.log(`   Contract/part-time:${contractOrPartTime}`)
  console.log(`   SAVED:             ${saved}${DRY ? '  (dry run — nothing written)' : ''}`)
  if (skipped) console.log(`   Write errors:      ${skipped}`)
  console.log('─'.repeat(58))

  if (DRY && sample.length) {
    console.log(`\n   Random sample of ${sample.length} of the ${saved} that passed — check these by hand:\n`)
    for (const d of sample) {
      console.log(`   ${d.title}`)
      console.log(`     ${d.company} · ${d.location} · ${d.workType} · ${d.experienceLevel} · posted ${d.postedAt.toISOString().slice(0, 10)}`)
      console.log(`     ${d.applyUrl}\n`)
    }
  }

  if (!DRY) {
    // ── STALE SWEEP, scoped to ats: 'lever', boards that answered this run only.
    if (okBoards.length) {
      const stale = await Job.countDocuments({ ats: 'lever', companySlug: { $in: okBoards }, fetchedAt: { $lt: runStart } })
      const total = await Job.countDocuments({ ats: 'lever' })
      const share = total ? stale / total : 0
      if (share > MAX_SWEEP_SHARE) {
        console.log(`   🛑 Sweep ABORTED: would remove ${stale} of ${total} Lever jobs (${Math.round(share * 100)}%).`)
        console.log(`      Guard is ${Math.round(MAX_SWEEP_SHARE * 100)}%. Too many to be genuine closures —`)
        console.log('      the fetch itself probably failed. Nothing deleted. Investigate before raising this.')
      } else if (stale > 0) {
        const res = await Job.deleteMany({ ats: 'lever', companySlug: { $in: okBoards }, fetchedAt: { $lt: runStart } })
        console.log(`   🗑️  Removed ${res.deletedCount} Lever jobs no longer at the source.`)
      } else {
        console.log('   ✅ Nothing stale.')
      }
    }

    const counts = {}
    for (const ats of ['greenhouse', 'smartrecruiters', 'ashby', 'lever']) {
      counts[ats] = await Job.countDocuments({ ats, closed: { $ne: true } })
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    console.log(`\n   Board now: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' + ')} = ${total}`)
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

export { fetchBoard, allLocations, fullPlainText }
