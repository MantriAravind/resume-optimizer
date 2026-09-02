// fetchWorkday.mjs — the Workday slice of the pipeline.
//
// Same gates in the same order as the other five fetchers, writing the same shape
// to the same collection. Read fetchAshby.mjs for the doctrine. Workday is the
// biggest ATS and the most fragile source this board has: the endpoint is
// undocumented, tenants ban aggressive clients, and nothing announces a change.
// Every design choice below exists because something yesterday demanded it.
//
// WHAT THE MEASUREMENT SAID BEFORE THIS WAS WRITTEN  (probeWorkday.mjs, 2026-09-01)
//   20 tenants, 2,363 listings: 77% within 30 days, 53% US, 24% of descriptions
//   disqualified (citizen/clearance/sponsorship), 14% contract/PT.
//   Estimated yield ~33% — the go decision. Tenants are bimodal: 3M and Accuray
//   sampled 5/5 disqualified, Ace and Academy 0/5. A tenant-level skip list will
//   eventually be worth more than any per-job optimisation.
//
// LESSONS BAKED IN, so they are not relearned
//   limit 20        larger limits silently return EMPTY lists on many tenants. A
//                   naive fetcher reads that as "no jobs" and the sweep then
//                   deletes everything. The share guard would catch it; the limit
//                   makes it impossible.
//   detail URL      externalPath already starts with "/job/...". The detail
//                   endpoint is {site}{externalPath}. Writing {site}/job{path}
//                   doubles "job", 404s, and the first probe run read that
//                   silence as "0% disqualified". Both shapes are tried, the
//                   working one remembered per tenant, failures counted loudly.
//   serial + paced  Workable banned a laptop IP for over an hour at ~500
//                   parallel requests. One request at a time, a pause after
//                   each, stop the whole run on a second consecutive 429.
//   relative dates  postedOn is a label. "Posted Today".."29 Days Ago" parse;
//                   "30+ Days Ago" does not, and that is exactly the age gate's
//                   cutoff. postedAt is therefore approximate to the day.
//   early stop      pages arrive newest-first, so TWO consecutive pages of
//                   entirely-old jobs end the tenant. Ordering is not
//                   guaranteed by any document, hence two pages, not one.
//   sweep trust     only tenants whose paging COMPLETED (early stop counts as
//                   complete — everything past it is too old to be on the board
//                   anyway) are swept. A tenant that errored mid-paging closes
//                   nothing: absence from a partial list is not absence.
//
// KNOWN COST, accepted for now: a job whose description was judged and REJECTED
// is not remembered, so it is re-detailed on every run until it ages out. At 20
// tenants that is a handful of wasted requests; at 1,437 it will justify a
// seen-and-rejected cache. Step 7's scaling stages are where that gets measured.
//
//   node fetchWorkday.mjs             first 20 tenants (rollout default)
//   node fetchWorkday.mjs 100         first 100
//   node fetchWorkday.mjs all         every tenant in the file
//   add --dry to any of the above     judge everything, write nothing, print a sample

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

const BOARDS_PATH  = 'workday_boards.txt'
const NAMES_PATH   = 'workday_names.json'      // optional hand-curated overrides
const MAX_AGE_DAYS = 30
const MAX_SWEEP_SHARE = 0.25
const PAGE_SIZE    = 20            // hard Workday constraint, see header
const PAGE_CAP     = 50            // 1,000 listings per tenant; early stop usually ends far sooner
const OLD_PAGES_TO_STOP = 2        // consecutive fully-old pages that end a tenant
const PACE_MS      = 1000
const BAN_PAUSE_MS = 60000
const TIMEOUT_MS   = 15000
const DRY = process.argv.includes('--dry')
const SAMPLE_SIZE  = 20
const UA = 'Optyply/1.0 (job board for international students; support@optyply.com)'

const countArg = process.argv.find(a => /^(\d+|all)$/.test(a))
const TENANTS = countArg === 'all' ? Infinity : Number(countArg || 20)

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
let banned = false
let strikes = 0

async function paced(url, init = {}) {
  if (banned) return null
  let res
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) }
  catch (e) { await sleep(PACE_MS); return { ok: false, status: e.name } }
  if (res.status === 429) {
    strikes++
    if (strikes >= 2) {
      banned = true
      console.log('\n   🛑 Second consecutive 429. Stopping the run rather than hammering a throttled IP.')
      return null
    }
    const ra = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : BAN_PAUSE_MS
    console.log(`\n   ⏸  429. Waiting ${Math.round(wait / 1000)}s, then one retry...`)
    await sleep(wait)
    return paced(url, init)
  }
  strikes = 0
  await sleep(PACE_MS)
  return res
}

function parseCareerUrl(careerUrl) {
  let url
  try { url = new URL(careerUrl) } catch { return null }
  if (!/\.wd\d+\.myworkdayjobs\.com$/i.test(url.hostname)) return null
  const [tenant, shard] = url.hostname.split('.')
  const parts = url.pathname.split('/').filter(Boolean)
  let locale = null, site = null
  if (parts.length >= 2 && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0])) { locale = parts[0]; site = parts[1] }
  else site = parts[0]
  if (!tenant || !shard || !site) return null
  return { tenant, shard, site, locale, origin: url.origin }
}

// "Posted Today" -> 0, "Posted Yesterday" -> 1, "Posted 7 Days Ago" -> 7,
// "Posted 30+ Days Ago" -> null. Null and the 30-day gate agree by construction.
function daysAgo(label) {
  const t = String(label || '').toLowerCase()
  if (t.includes('today')) return 0
  if (t.includes('yesterday')) return 1
  if (t.includes('+')) return null
  const m = t.match(/(\d+)\s*days?\s+ago/)
  if (!m) return null
  return Number(m[1])
}

async function listPages(cfg) {
  const endpoint = `${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}/jobs`
  const referer = `${cfg.origin}/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}`
  const jobs = []
  const seen = new Set()
  let oldStreak = 0
  for (let page = 0; page < PAGE_CAP; page++) {
    const res = await paced(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA, referer },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: '' }),
    })
    if (!res) return { ok: false, status: 'stopped' }
    if (!res.ok) return { ok: false, status: res.status }
    let data
    try { data = await res.json() } catch { return { ok: false, status: 'bad json' } }
    const pageJobs = Array.isArray(data.jobPostings) ? data.jobPostings : []
    if (!pageJobs.length) break

    let added = 0, freshOnPage = 0
    for (const j of pageJobs) {
      if (!j.externalPath || seen.has(j.externalPath)) continue
      seen.add(j.externalPath)
      jobs.push(j)
      added++
      if (daysAgo(j.postedOn) !== null) freshOnPage++
    }
    if (!added) break
    oldStreak = freshOnPage === 0 ? oldStreak + 1 : 0
    if (oldStreak >= OLD_PAGES_TO_STOP) break     // early stop: see header
    if (pageJobs.length < PAGE_SIZE) break
  }
  return { ok: true, jobs }
}

// Both detail shapes tried, the working one remembered per tenant. See header.
const detailShape = new Map()
let detailFailNote = null
async function detail(cfg, externalPath) {
  const referer = `${cfg.origin}/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}${externalPath}`
  const shapes = detailShape.has(cfg.tenant) ? [detailShape.get(cfg.tenant)] : ['plain', 'jobPrefix']
  for (const shape of shapes) {
    const p = shape === 'plain' ? externalPath : `/job${externalPath}`
    const res = await paced(`${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}${p}`, {
      headers: { accept: 'application/json', 'user-agent': UA, referer },
    })
    if (!res) return null
    if (!res.ok) { detailFailNote = detailFailNote || `HTTP ${res.status} (${shape})`; continue }
    try {
      const d = await res.json()
      const info = d?.jobPostingInfo
      if (info) { detailShape.set(cfg.tenant, shape); return info }
      detailFailNote = detailFailNote || `no jobPostingInfo (${shape})`
    } catch { detailFailNote = detailFailNote || 'bad json' }
  }
  return null
}

// A stable per-job id. The externalPath tail ("Senior-Data-Engineer_JR123456") is
// unique within a tenant and survives re-posting of the list.
function jobIdFor(tenant, externalPath) {
  const tail = String(externalPath).split('/').filter(Boolean).pop() || externalPath
  return `workday_${tenant}_${tail}`
}

async function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error(`❌ Not found: ${BOARDS_PATH}.`); process.exit(1)
  }
  const urls = fs.readFileSync(BOARDS_PATH, 'utf-8').split('\n')
    .map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  const cfgs = urls.map(parseCareerUrl).filter(Boolean).slice(0, TENANTS === Infinity ? undefined : TENANTS)

  const NAMES = fs.existsSync(NAMES_PATH) ? JSON.parse(fs.readFileSync(NAMES_PATH, 'utf-8')) : {}
  const tidy = t => (NAMES[t] || t.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim())

  if (!DRY) {
    if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set.'); process.exit(1) }
    await mongoose.connect(process.env.MONGODB_URI)
    console.log(`✅ Connected to MongoDB (${mongoose.connection.db.databaseName})`)
  } else {
    console.log('🧪 DRY RUN — nothing will be written')
  }

  const runStart = new Date()
  console.log(`🔎 ${cfgs.length} Workday tenants (of ${urls.length} in file) · serial, ${PACE_MS}ms pace · jobs newer than ${MAX_AGE_DAYS} days\n`)

  const known = new Set()
  if (!DRY) {
    for (const j of await Job.find({ ats: 'workday' }, { id: 1 }).lean()) known.add(j.id)
    if (known.size) console.log(`   ${known.size} Workday jobs already on the board (no detail fetch for those)\n`)
  }

  let seen = 0, saved = 0, skipped = 0, refreshed = 0
  let tooOld = 0, nonUS = 0, noDetail = 0, disqualified = 0, contractOrPartTime = 0
  let detailRequests = 0, deadTenants = 0
  const deadBy = {}
  const sweptTenants = []       // tenants whose paging completed — the only ones swept
  const sample = []

  for (let i = 0; i < cfgs.length; i++) {
    if (banned) { deadTenants += cfgs.length - i; deadBy['not attempted (throttled)'] = cfgs.length - i; break }
    const cfg = cfgs[i]
    const r = await listPages(cfg)
    if (!r.ok) { deadTenants++; deadBy[r.status] = (deadBy[r.status] || 0) + 1; continue }
    sweptTenants.push(cfg.tenant)
    const company = tidy(cfg.tenant)

    for (const job of r.jobs) {
      if (banned) break
      seen++

      const age = daysAgo(job.postedOn)
      if (age === null || age > MAX_AGE_DAYS) { tooOld++; continue }
      const posted = new Date(runStart.getTime() - age * 24 * 60 * 60 * 1000)

      const location = String(job.locationsText || '').trim()
      if (!location || !isUSLocation(location)) { nonUS++; continue }

      const id = jobIdFor(cfg.tenant, job.externalPath)
      if (!DRY && known.has(id)) {
        await Job.updateOne({ id }, { $set: { fetchedAt: new Date() } })
        refreshed++
        continue
      }

      detailRequests++
      const info = await detail(cfg, job.externalPath)
      if (!info) { noDetail++; continue }

      const title = String(info.title || job.title || '')
      const plainText = stripHtml(String(info.jobDescription || ''))
      const fullText = `${title}\n${plainText}`
      if (isDisqualified(fullText, title)) { disqualified++; continue }
      if (isContractOrPartTime(plainText, title)) { contractOrPartTime++; continue }

      const salary = extractSalary(plainText)
      const years  = extractYearsExperience(plainText)

      const doc = {
        id,
        title,
        company,
        companySlug:  cfg.tenant,
        location,
        isRemote:     /remote/i.test(location) || /\bremote\b/i.test(String(info.remoteType || '')),
        description:  plainText.slice(0, 500),
        applyUrl:     `${cfg.origin}/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}${job.externalPath}`,
        postedAt:     posted,
        sponsorBadge: false,
        field:        categorizeJob(title),
        needsLicense: requiresLicense(title),
        ats:          'workday',
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
    process.stdout.write(`\r   tenants ${i + 1}/${cfgs.length} · saved ${saved} · refreshed ${refreshed} · details ${detailRequests}   `)
  }

  console.log('\n\n' + '─'.repeat(58))
  console.log(`   Tenants completed: ${sweptTenants.length}  (${deadTenants} did not${deadTenants ? ': ' + Object.entries(deadBy).map(([k, v]) => `${v}× ${k}`).join(', ') : ''})`)
  console.log(`   Listings seen:     ${seen}`)
  console.log(`   Older than ${MAX_AGE_DAYS}d:   ${tooOld}`)
  console.log(`   Non-US:            ${nonUS}`)
  console.log(`   Detail requests:   ${detailRequests}  (${noDetail} failed${detailFailNote ? '; first: ' + detailFailNote : ''})`)
  console.log(`   Disqualified:      ${disqualified}`)
  console.log(`   Contract/part-time:${contractOrPartTime}`)
  console.log(`   Already known:     ${refreshed}  (fetchedAt bumped, no detail fetch)`)
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
    // Sweep: only tenants whose paging completed, only this source, share-guarded.
    // A job past the early stop is 30+ days old and the age gate would drop it on
    // re-fetch anyway, so early-stopped tenants are safely "complete" here.
    if (sweptTenants.length && !banned) {
      const stale = await Job.countDocuments({ ats: 'workday', companySlug: { $in: sweptTenants }, fetchedAt: { $lt: runStart } })
      const total = await Job.countDocuments({ ats: 'workday' })
      const share = total ? stale / total : 0
      if (share > MAX_SWEEP_SHARE) {
        console.log(`   🛑 Sweep ABORTED: would remove ${stale} of ${total} Workday jobs (${Math.round(share * 100)}%). Nothing deleted.`)
      } else if (stale > 0) {
        const res = await Job.deleteMany({ ats: 'workday', companySlug: { $in: sweptTenants }, fetchedAt: { $lt: runStart } })
        console.log(`   🗑️  Removed ${res.deletedCount} Workday jobs no longer at the source.`)
      } else {
        console.log('   ✅ Nothing stale.')
      }
    } else if (banned) {
      console.log('   ⏭  Sweep skipped: the run was throttled mid-way, so absence proves nothing.')
    }
    const counts = {}
    for (const ats of ['greenhouse', 'smartrecruiters', 'ashby', 'lever', 'workable', 'workday']) counts[ats] = await Job.countDocuments({ ats, closed: { $ne: true } })
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

export { parseCareerUrl, daysAgo, jobIdFor }
