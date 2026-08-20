// fetchSR.mjs — the SmartRecruiters half of the pipeline.
//
// Same gates in the same order as Greenhouse and Ashby, writing the same shape into the
// same collection. Three sources, one board: a job must be judged identically wherever
// it came from, or the filter's promise means different things in different rows.
//
// THE ONE STRUCTURAL DIFFERENCE
// Greenhouse and Ashby hand back descriptions with the job list. SmartRecruiters does
// not — the list carries `defaultJobAd: true` and nothing else, so every description is
// a second request. AbbVie alone lists 1,734 postings; across 259 companies that is
// potentially a hundred thousand calls.
//
// What makes it affordable is gate ORDER. Age and location come free with the list, and
// measured across 6,173 real postings they removed 72% before any description was
// needed:
//     dropped on age   41.6%   free
//     dropped non-US   30.3%   free
//     needed a detail  28.1%
// A full run projects to ~22 minutes, against ~26 for Greenhouse.
//
// WHAT srCheck.mjs ESTABLISHED BEFORE THIS EXISTED
//   ~16,200 jobs would reach the board — the largest single addition available
//   the filter disqualifies 40.4% here, higher than Greenhouse's 23% or Ashby's 11.8%,
//     which is what you would expect from a list full of defence and pharma employers
//   releasedDate spans 340 distinct days back to 2014, so it is a real posting date and
//     not an updated_at in disguise — the trap that once left 18,100 undeletable rows
//
//   node fetchSR.mjs            all companies in sr_companies.txt
//   node fetchSR.mjs --dry      fetch and judge, write nothing

import 'dotenv/config'
import fs from 'fs'
import mongoose from 'mongoose'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  stripHtml,
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

const LIST_PATH    = 'sr_companies.txt'
const NAMES_PATH   = 'sr_names.json'
const MAX_AGE_DAYS = 30
const PAGE         = 100      // list page size the API accepts
const DETAIL_CONC  = 8        // detail calls in flight
const TIMEOUT_MS   = 15000
const MAX_PAGES    = 60       // 6,000 postings per company; AbbVie is the largest at 1,734
const DRY = process.argv.includes('--dry')

// The sweep deletes jobs it did not see at the source this run, and aborts if that share
// looks implausible. Same guard and same reasoning as the other two fetchers: a large
// share means the FETCH broke, not that every employer closed at once.
const MAX_SWEEP_SHARE = 0.25

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

async function listPage(company, offset) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${PAGE}&offset=${offset}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function detail(company, id) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${id}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/**
 * The whole ad as plain text.
 *
 * SmartRecruiters splits it into companyDescription, jobDescription, qualifications and
 * additionalInformation. All four matter: the sponsorship refusals found in testing were
 * almost always in additionalInformation, not in the job description itself.
 */
function adText(d) {
  const sections = d?.jobAd?.sections || {}
  return stripHtml(Object.values(sections).map(v => v?.text || '').join('\n'))
}

function locationOf(p) {
  const l = p.location || {}
  // The country code is dropped from the DISPLAYED string once nationality has been
  // settled — cards read "United States, UNITED STATES, us" otherwise. Region is kept
  // because it is the state, which the board filters on.
  const parts = [l.city, l.region].filter(Boolean)
  const seen = new Set()
  const tidy = parts.filter(x => {
    const k = String(x).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return tidy.join(', ')
}

async function main() {
  if (!fs.existsSync(LIST_PATH)) { console.error(`❌ Not found: ${LIST_PATH}`); process.exit(1) }
  const companies = fs.readFileSync(LIST_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)

  // The API identifier is not the company's name — "PaloAltoNetworks2", "AECOM2",
  // "GDMSI" for General Dynamics UK. Taken from real postings that carried both.
  const NAMES = fs.existsSync(NAMES_PATH) ? JSON.parse(fs.readFileSync(NAMES_PATH, 'utf-8')) : {}
  const displayName = id => NAMES[id]
    || id.replace(/\d+$/, '').replace(/[-_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  console.log(`🏷️  Display names known for ${Object.keys(NAMES).length} companies`)

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
  const cutoff = runStart.getTime() - MAX_AGE_DAYS * 86400000
  console.log(`🔎 ${companies.length} SmartRecruiters companies · keeping jobs newer than ${MAX_AGE_DAYS} days\n`)

  let listed = 0, tooOld = 0, noDate = 0, nonUS = 0
  let detailCalls = 0, detailFail = 0, disqualified = 0, contractOrPartTime = 0
  let saved = 0, writeErrors = 0, deadCompanies = 0
  const okCompanies = []

  for (const co of companies) {
    let offset = 0, totalFound = null, pages = 0
    const survivors = []

    // ── Phase 1: the list. Free data only.
    while (true) {
      const page = await listPage(co, offset)
      if (!page) break
      if (totalFound === null) totalFound = page.totalFound

      for (const p of page.content || []) {
        listed++
        const t = p.releasedDate ? Date.parse(p.releasedDate) : NaN
        if (Number.isNaN(t)) { noDate++; continue }
        if (t < cutoff) { tooOld++; continue }

        // COUNTRY CODE FIRST, and it is authoritative.
        //
        // isUSLocation works on a string and keeps anything it cannot classify, which is
        // right for Greenhouse ("New York, NY" or "London, UK") and wrong here.
        // SmartRecruiters formats location as `city, region, countryCode` with lowercase
        // two-letter ISO codes, and those collide head-on with US state abbreviations:
        //
        //     Blumenau, SC, br    -> SC read as South Carolina   (Santa Catarina, Brazil)
        //     Nieuwegein, UT, nl  -> UT read as Utah             (Utrecht, Netherlands)
        //     bundesweit, de      -> DE read as Delaware         (Germany, nationwide)
        //     Heredia, 40701, cr  -> nothing matched -> ambiguous -> kept  (Costa Rica)
        //
        // CO is Colorado and Colombia. PA is Pennsylvania and Panama. No amount of
        // pattern work fixes an abbreviation that genuinely means two things — but the
        // API hands us a structured country field, so string matching is not needed at
        // all. A posting with no country is dropped rather than assumed American.
        const country = String(p.location?.country || '').trim().toLowerCase()
        if (country !== 'us') { nonUS++; continue }

        const loc = locationOf(p)
        // Kept as a second gate. The country code settles the nationality question; this
        // still catches a US-coded posting whose text says otherwise.
        if (!loc || !isUSLocation(loc)) { nonUS++; continue }

        survivors.push({ id: p.id, title: p.name || '', loc, posted: new Date(t), raw: p })
      }

      offset += PAGE
      pages++
      if (!page.content?.length || offset >= (totalFound || 0) || pages >= MAX_PAGES) break
      await sleep(60)
    }

    if (totalFound === null) { deadCompanies++; continue }
    okCompanies.push(co)

    // ── Phase 2: descriptions, only for what survived.
    for (let i = 0; i < survivors.length; i += DETAIL_CONC) {
      const batch = survivors.slice(i, i + DETAIL_CONC)
      const results = await Promise.all(batch.map(s => detail(co, s.id)))

      for (let k = 0; k < batch.length; k++) {
        const s = batch[k]
        const d = results[k]
        detailCalls++
        if (!d) { detailFail++; continue }

        const text = adText(d)
        const fullText = `${s.title}\n${text}`
        if (isDisqualified(fullText)) { disqualified++; continue }
        if (isContractOrPartTime(text, s.title)) { contractOrPartTime++; continue }

        const salary = extractSalary(text)
        const years  = extractYearsExperience(text)
        const l = s.raw.location || {}

        const doc = {
          id:           `sr_${s.id}`,     // namespaced; SR ids are long numeric strings
          title:        s.title,
          company:      displayName(co),
          companySlug:  co,
          location:     s.loc,
          isRemote:     l.remote === true || /remote/i.test(s.loc) || /\bremote\b/i.test(s.title),
          description:  text.slice(0, 500),
          applyUrl:     d.applyUrl || `https://jobs.smartrecruiters.com/${encodeURIComponent(co)}/${s.id}`,
          postedAt:     s.posted,
          sponsorBadge: false,
          field:        categorizeJob(s.title),
          needsLicense: requiresLicense(s.title),
          ats:          'smartrecruiters',
          fetchedAt:    new Date(),
          closed:       false,
          experienceLevel: detectExperienceLevel(s.title),
          // detectWorkType reads a location string, and SmartRecruiters locations are
          // now just "United States" or "Allen, TX" — the word "remote" never appears in
          // them, so a remote job was being labelled Onsite. The API returns `remote` and
          // `hybrid` as booleans; those are used first and the text scan is the fallback.
          workType:        l.hybrid === true ? 'Hybrid'
                         : (l.remote === true || /\bremote\b/i.test(s.title)) ? 'Remote US'
                         : detectWorkType(s.loc, text),
          state:           extractState(s.loc),
          salaryMin:       salary ? salary.min : null,
          salaryMax:       salary ? salary.max : null,
          employmentType:  detectEmploymentType(text),
          yearsMin:        years ? years.min : null,
          yearsMax:        years ? years.max : null,
        }

        if (DRY) { saved++; continue }
        try {
          await Job.updateOne({ id: doc.id }, doc, { upsert: true })
          saved++
        } catch { writeErrors++ }
      }
    }
    process.stdout.write(`\r   ${co.padEnd(26).slice(0, 26)} listed ${listed} · saved ${saved}   `)
  }

  console.log('\n\n' + '─'.repeat(60))
  console.log(`   Companies answered:  ${okCompanies.length}  (${deadCompanies} did not)`)
  console.log(`   Postings listed:     ${listed}`)
  console.log(`   No posting date:     ${noDate}`)
  console.log(`   Older than ${MAX_AGE_DAYS}d:     ${tooOld}`)
  console.log(`   Non-US:              ${nonUS}`)
  console.log(`   Detail calls:        ${detailCalls}  (${detailFail} failed)`)
  console.log(`   Disqualified:        ${disqualified}`)
  console.log(`   Contract/part-time:  ${contractOrPartTime}`)
  console.log(`   SAVED:               ${saved}${DRY ? '  (dry run — nothing written)' : ''}`)
  if (writeErrors) console.log(`   Write errors:        ${writeErrors}`)
  console.log('─'.repeat(60))

  if (!DRY) {
    // ── STALE SWEEP. SmartRecruiters gives no "closed" signal either; a closed posting
    // simply stops being returned. Only companies that answered THIS run are swept, so
    // an outage that takes a company offline cannot wipe its jobs.
    if (okCompanies.length) {
      const stale = await Job.countDocuments({ ats: 'smartrecruiters', companySlug: { $in: okCompanies }, fetchedAt: { $lt: runStart } })
      const total = await Job.countDocuments({ ats: 'smartrecruiters' })
      const share = total ? stale / total : 0
      if (share > MAX_SWEEP_SHARE) {
        console.log(`   🛑 Sweep ABORTED: would remove ${stale} of ${total} (${Math.round(share * 100)}%).`)
        console.log(`      Guard is ${Math.round(MAX_SWEEP_SHARE * 100)}%. The fetch itself probably failed.`)
        console.log('      Nothing deleted. Investigate before raising this.')
      } else if (stale > 0) {
        const r = await Job.deleteMany({ ats: 'smartrecruiters', companySlug: { $in: okCompanies }, fetchedAt: { $lt: runStart } })
        console.log(`   🗑️  Removed ${r.deletedCount} jobs no longer at the source.`)
      } else {
        console.log('   ✅ Nothing stale.')
      }
    }

    const gh  = await Job.countDocuments({ ats: 'greenhouse', closed: { $ne: true } })
    const ash = await Job.countDocuments({ ats: 'ashby', closed: { $ne: true } })
    const sr  = await Job.countDocuments({ ats: 'smartrecruiters', closed: { $ne: true } })
    console.log(`\n   Board now: ${gh} greenhouse + ${ash} ashby + ${sr} smartrecruiters = ${gh + ash + sr}`)
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

export { listPage, detail, adText, locationOf }
