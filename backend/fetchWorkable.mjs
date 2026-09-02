// fetchWorkable.mjs — the Workable slice of the pipeline.
//
// Same gates in the same order as the other four fetchers, writing the same shape to
// the same collection. Read fetchAshby.mjs for the doctrine.
//
// WHAT THE PROBE SAID BEFORE THIS WAS WRITTEN  (probeWorkable.mjs, run on GitHub, 2026-09-01)
//   131 accounts, 131 answered, 4,792 published postings between them, before any gate.
//   Endpoint: GET https://www.workable.com/api/accounts/{slug}?details=true
//   Documented at workable.readme.io/reference/jobs-1. Returns { name, description,
//   jobs[] } with the job description inline. One request per account.
//
// WHAT WENT WRONG BEFORE THIS, so it is not repeated
//   {slug}.workable.com/spi/v3/jobs           401 on every account: token required.
//   apply.workable.com/api/v3/accounts/...    works, but ~500 requests in half an hour
//                                             got the laptop IP banned across all
//                                             workable.com domains for over an hour.
//   The endpoint above is the documented public one. It is still hit ONE request at
//   a time with a pause, and the run stops on a second 429 rather than grinding.
//
// HOW WORKABLE DIFFERS FROM LEVER, and what each difference costs
//   published_on     a plain date "2026-06-10", not a timestamp. Boards keep old
//                    postings up, so the 30-day gate does most of the culling.
//   locations[]      array with countryCode, like Lever's allLocations. Top-level
//                    city/state/country are the primary only.
//   employment_type  "Full-time" / "Part-time" / "Contract" as a field. Used as an
//                    extra signal alongside the shared text gate, never instead of it.
//   url vs application_url   `url` is the POSTING page, `application_url` is the
//                    form. The guide that led here had them backwards; the probe did
//                    not. The card links to the posting so the student reads it first.
//   name             comes back on the account response. No names file needed.
//   description      HTML, inline. stripHtml before the gates, like Greenhouse.
//
//   node fetchWorkable.mjs            all accounts in workable_boards.txt
//   node fetchWorkable.mjs --dry      fetch and judge, write nothing, print a sample

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
import { categorizeJob, requiresLicense } from './jobCategory.mjs'

const BOARDS_PATH  = 'workable_boards.txt'
const MAX_AGE_DAYS = 30
const MAX_SWEEP_SHARE = 0.25
const PACE_MS      = 1000        // between requests. Serial. Workable bans.
const BAN_PAUSE_MS = 60000       // on a 429 with no Retry-After: wait once
const TIMEOUT_MS   = 15000
const DRY = process.argv.includes('--dry')
const SAMPLE_SIZE  = 20
const UA = 'Optyply/1.0 (job board for international students; support@optyply.com)'

const jobSchema = new mongoose.Schema({
  id: { type: String, unique: true }, title: String, company: String, companySlug: String,
  location: String, isRemote: Boolean, description: String, applyUrl: String,
  postedAt: Date, sponsorBadge: Boolean, field: String, needsLicense: Boolean,
  ats: String, fetchedAt: Date, experienceLevel: String, workType: String, state: String,
  salaryMin: Number, salaryMax: Number, employmentType: String,
  yearsMin: Number, yearsMax: Number, closed: Boolean,
}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

const sleep = ms => new Promise(r => setTimeout(r, ms))

// One paced request. Two 429s in a row means the IP is throttled; the run stops.
let banned = false
let strikes = 0
async function fetchAccount(slug) {
  if (banned) return { slug, ok: false, status: 'not attempted (throttled)' }
  const url = `https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=true`
  let res
  try {
    res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    await sleep(PACE_MS)
    return { slug, ok: false, status: e.name }
  }
  if (res.status === 429) {
    strikes++
    if (strikes >= 2) {
      banned = true
      console.log('\n   🛑 Second 429 in a row. Throttled; stopping the run rather than hammering it.')
      return { slug, ok: false, status: 429 }
    }
    const ra = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : BAN_PAUSE_MS
    console.log(`\n   ⏸  429. Waiting ${Math.round(wait / 1000)}s, then one retry...`)
    await sleep(wait)
    return fetchAccount(slug)
  }
  strikes = 0
  await sleep(PACE_MS)
  if (!res.ok) return { slug, ok: false, status: res.status }
  let data
  try { data = await res.json() } catch { return { slug, ok: false, status: 'bad json' } }
  if (!Array.isArray(data?.jobs)) return { slug, ok: false, status: 'no jobs array' }
  return { slug, ok: true, name: String(data.name || '').trim(), jobs: data.jobs }
}

const locStr = l => l ? [l.city, l.region || l.state, l.country].filter(Boolean).join(', ') : ''

/** Every location on the posting, joined, for the gate. */
function allLocations(job) {
  const list = Array.isArray(job.locations) && job.locations.length
    ? job.locations.filter(l => l && l.hidden !== true)
    : [{ city: job.city, region: job.state, country: job.country }]
  return [...new Set(list.map(locStr).filter(Boolean))].join(', ')
}

/** The one the card shows: the first that reads US, else the primary. */
function displayLocation(job) {
  const list = Array.isArray(job.locations) && job.locations.length
    ? job.locations.filter(l => l && l.hidden !== true)
    : [{ city: job.city, region: job.state, country: job.country }]
  const parts = list.map(locStr).filter(Boolean)
  const primary = parts[0] || ''
  const k = classifyLocation(primary)
  if (k === 'us' || k === 'weak-us' || k === 'ambiguous') return primary
  return parts.find(p => { const pk = classifyLocation(p); return pk === 'us' || pk === 'weak-us' }) || primary
}

function anyUSCountryCode(job) {
  const list = Array.isArray(job.locations) ? job.locations : []
  return list.some(l => String(l?.countryCode || '').toUpperCase() === 'US')
}

async function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error(`❌ Not found: ${BOARDS_PATH}. Run probeWorkable.mjs first.`); process.exit(1)
  }
  const boards = fs.readFileSync(BOARDS_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)
  const tidy = slug => slug.replace(/-\d+$/, '').replace(/-(inc|llc|ltd|corp)$/i, '').replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

  if (!DRY) {
    if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set.'); process.exit(1) }
    await mongoose.connect(process.env.MONGODB_URI)
    console.log(`✅ Connected to MongoDB (${mongoose.connection.db.databaseName})`)
  } else {
    console.log('🧪 DRY RUN — nothing will be written')
  }

  const runStart = new Date()
  const ageCutoff = new Date(runStart.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
  console.log(`🔎 ${boards.length} Workable accounts · one request each, ${PACE_MS}ms apart · keeping jobs newer than ${MAX_AGE_DAYS} days\n`)

  let seen = 0, saved = 0, skipped = 0
  let noDate = 0, tooOld = 0, nonUS = 0, disqualified = 0, contractOrPartTime = 0
  let deadBoards = 0
  const deadBy = {}
  const okBoards = []
  const sample = []

  for (let i = 0; i < boards.length; i++) {
    const r = await fetchAccount(boards[i])
    if (!r.ok) { deadBoards++; deadBy[r.status] = (deadBy[r.status] || 0) + 1; continue }
    okBoards.push(r.slug)
    const company = r.name || tidy(r.slug)

    for (const job of r.jobs) {
      seen++

      // ── Gates, same order as the other fetchers.
      const posted = job.published_on ? new Date(job.published_on) : (job.created_at ? new Date(job.created_at) : null)
      if (!posted || Number.isNaN(posted.getTime())) { noDate++; continue }
      if (posted < ageCutoff) { tooOld++; continue }

      let location = allLocations(job)
      if (!location) {
        if (anyUSCountryCode(job)) location = 'United States'
        else { nonUS++; continue }
      } else if (!isUSLocation(location)) { nonUS++; continue }

      const title = job.title || ''
      const plainText = stripHtml(job.description || '')
      const fullText = `${title}\n${plainText}`
      if (isDisqualified(fullText, title)) { disqualified++; continue }
      // Workable states the type as a field. It is checked alongside the shared text
      // gate, never instead of it: the field is what the employer ticked, the text is
      // what they wrote, and both have been wrong in different directions.
      const type = String(job.employment_type || '').toLowerCase()
      // "intern" was in this regex once — my assumption, never a product decision.
      // Internships are in scope: CPT is internships, and the board's experience
      // filter lists Internship first. The shared text gate stays the authority.
      if (/part.?time|contract|temporary/.test(type) || isContractOrPartTime(plainText, title)) { contractOrPartTime++; continue }

      const salary = extractSalary(plainText)
      const years  = extractYearsExperience(plainText)

      const doc = {
        id:           `workable_${job.shortcode}`,
        title,
        company,
        companySlug:  r.slug,
        location:     displayLocation(job) || location,
        isRemote:     job.telecommuting === true || /remote/i.test(location),
        description:  plainText.slice(0, 500),
        applyUrl:     job.url || job.shortlink || job.application_url || '',
        postedAt:     posted,
        sponsorBadge: false,
        field:        categorizeJob(title),
        needsLicense: requiresLicense(title),
        ats:          'workable',
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
        if (sample.length < SAMPLE_SIZE) sample.push(doc)
        else { const j = Math.floor(Math.random() * saved); if (j < SAMPLE_SIZE) sample[j] = doc }
        continue
      }
      try { await Job.updateOne({ id: doc.id }, doc, { upsert: true }); saved++ }
      catch { skipped++ }
    }
    process.stdout.write(`\r   accounts ${i + 1}/${boards.length} · saved ${saved}   `)
  }

  console.log('\n\n' + '─'.repeat(58))
  console.log(`   Accounts answered: ${okBoards.length}  (${deadBoards} did not${deadBoards ? ': ' + Object.entries(deadBy).map(([k, v]) => `${v}× ${k}`).join(', ') : ''})`)
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
    if (okBoards.length) {
      const stale = await Job.countDocuments({ ats: 'workable', companySlug: { $in: okBoards }, fetchedAt: { $lt: runStart } })
      const total = await Job.countDocuments({ ats: 'workable' })
      const share = total ? stale / total : 0
      if (share > MAX_SWEEP_SHARE) {
        console.log(`   🛑 Sweep ABORTED: would remove ${stale} of ${total} Workable jobs (${Math.round(share * 100)}%). Nothing deleted.`)
      } else if (stale > 0) {
        const res = await Job.deleteMany({ ats: 'workable', companySlug: { $in: okBoards }, fetchedAt: { $lt: runStart } })
        console.log(`   🗑️  Removed ${res.deletedCount} Workable jobs no longer at the source.`)
      } else {
        console.log('   ✅ Nothing stale.')
      }
    }
    const counts = {}
    for (const ats of ['greenhouse', 'smartrecruiters', 'ashby', 'lever', 'workable']) counts[ats] = await Job.countDocuments({ ats, closed: { $ne: true } })
    console.log(`\n   Board now: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' + ')} = ${Object.values(counts).reduce((a, b) => a + b, 0)}`)
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

export { fetchAccount, allLocations }
