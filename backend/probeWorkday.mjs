// probeWorkday.mjs — MEASUREMENT, not a fetcher. What fraction of Workday jobs
// would actually survive this board's gates?
//
// Workday hosts more postings than any other ATS, and also more of the exact
// postings this board exists to filter out: defence, banks, insurers, federal
// contractors, "must be a US citizen". Nobody knows the pass rate, and the pass
// rate is the entire go/no-go for building a Workday fetcher. This measures it on
// a sample of tenants before a line of fetcher is written.
//
// For each career URL in workday_candidates.txt (first N tenants):
//   1. Parse tenant / shard / site / locale from the URL. Never guessed — every
//      URL came from a real job listing.
//   2. POST the public CXS list endpoint, limit 20 (larger limits silently return
//      empty on many tenants), paging up to PAGE_CAP pages.
//   3. Age gate from the relative postedOn label. Workday's labels map exactly
//      onto the 30-day gate: "Posted Today" ... "29 Days Ago" parse, and the one
//      unparseable label, "30+ Days Ago", is precisely the one the gate drops.
//   4. US gate on locationsText with the same isUSLocation the whole board uses.
//   5. For up to DETAIL_SAMPLE survivors per tenant, GET the detail endpoint and
//      run the REAL isDisqualified on the description. That is the number the
//      list alone cannot give.
//
// Serial, paced, stops on a second 429 — the Workable lesson, applied before the
// first request instead of after the ban.
//
// No database. Run it on GitHub (probe-workday.yml): different IP from the
// laptop, same place a fetcher would live.
//
//   node probeWorkday.mjs             first 20 tenants
//   node probeWorkday.mjs 40          first 40

import fs from 'fs'
import { stripHtml, isUSLocation, isDisqualified, isContractOrPartTime } from './FetchJobs.mjs'

const CANDIDATES_PATH = 'workday_candidates.txt'
const TENANTS  = Math.max(1, Number(process.argv[2]) || 20)
const PAGE_CAP = 10                 // 200 jobs per tenant is plenty for a measurement
const DETAIL_SAMPLE = 5             // descriptions fetched per tenant
const PACE_MS  = 1000
const TIMEOUT_MS = 15000
const UA = 'Optyply/1.0 (job board for international students; support@optyply.com)'

const sleep = ms => new Promise(r => setTimeout(r, ms))
let strikes = 0, banned = false

async function paced(url, init = {}) {
  if (banned) return null
  let res
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) }
  catch (e) { await sleep(PACE_MS); return { ok: false, status: e.name } }
  if (res.status === 429) {
    strikes++
    if (strikes >= 2) { banned = true; console.log('\n🛑 Second 429; stopping.'); return null }
    const ra = Number(res.headers.get('retry-after'))
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60000)
    return paced(url, init)
  }
  strikes = 0
  await sleep(PACE_MS)
  return res
}

// Straight from the guide, which got this right.
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
// "Posted 30+ Days Ago" -> null (and null means: older than the gate).
function daysAgo(label) {
  const t = String(label || '').toLowerCase()
  if (t.includes('today')) return 0
  if (t.includes('yesterday')) return 1
  if (t.includes('+')) return null
  const m = t.match(/(\d+)\s*days?\s+ago/)
  if (!m) return null
  return Number(m[1])
}

async function listJobs(cfg) {
  const endpoint = `${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}/jobs`
  const referer = `${cfg.origin}/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}`
  const jobs = []
  const seen = new Set()
  let total = null
  for (let page = 0; page < PAGE_CAP; page++) {
    const res = await paced(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA, referer },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: page * 20, searchText: '' }),
    })
    if (!res) return { ok: false, status: 'stopped' }
    if (!res.ok) return { ok: false, status: res.status }
    let data
    try { data = await res.json() } catch { return { ok: false, status: 'bad json' } }
    const pageJobs = Array.isArray(data.jobPostings) ? data.jobPostings : []
    if (total === null && Number.isFinite(data.total)) total = data.total
    let added = 0
    for (const j of pageJobs) {
      if (!j.externalPath || seen.has(j.externalPath)) continue
      seen.add(j.externalPath); jobs.push(j); added++
    }
    if (!pageJobs.length || !added || pageJobs.length < 20) break
    if (total !== null && jobs.length >= total) break
  }
  return { ok: true, jobs, total: total ?? jobs.length }
}

// externalPath already begins with "/job/...", so the detail endpoint is
// {site}{externalPath}. The guide wrote {site}/job{externalPath}, which doubles
// "job" and 404s — the first probe run checked 0 descriptions because of it and
// reported a yield of 0%, silently. Both shapes are tried in order and the one
// that works is remembered per tenant; every failure now reports its status so a
// wrong URL can never again read as "no disqualified jobs".
const detailShape = new Map()   // tenant -> 'plain' | 'jobPrefix'
let detailFailNote = null
async function detail(cfg, externalPath) {
  const referer = `${cfg.origin}/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}${externalPath}`
  const shapes = detailShape.has(cfg.tenant)
    ? [detailShape.get(cfg.tenant)]
    : ['plain', 'jobPrefix']
  for (const shape of shapes) {
    const path = shape === 'plain' ? externalPath : `/job${externalPath}`
    const res = await paced(`${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}${path}`, {
      headers: { accept: 'application/json', 'user-agent': UA, referer },
    })
    if (!res) return null
    if (!res.ok) { detailFailNote = detailFailNote || `HTTP ${res.status} on ${shape} shape`; continue }
    try {
      const d = await res.json()
      const info = d?.jobPostingInfo
      if (info) { detailShape.set(cfg.tenant, shape); return info }
      detailFailNote = detailFailNote || `no jobPostingInfo on ${shape} shape (keys: ${Object.keys(d || {}).join(',')})`
    } catch { detailFailNote = detailFailNote || 'bad json' }
  }
  return null
}

const urls = fs.readFileSync(CANDIDATES_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)
// One URL per tenant: several listings point at the same tenant via different
// sites/locales, and measuring the same tenant twice tells us nothing new.
const byTenant = new Map()
for (const u of urls) { const c = parseCareerUrl(u); if (c && !byTenant.has(c.tenant)) byTenant.set(c.tenant, c) }
const picked = [...byTenant.values()].slice(0, TENANTS)
console.log(`🔎 Measuring ${picked.length} Workday tenants (of ${byTenant.size} known) · list pages capped at ${PAGE_CAP} · ${DETAIL_SAMPLE} descriptions each\n`)

const g = { boardTotal: 0, listed: 0, in30d: 0, us: 0, dSampled: 0, dDisq: 0, dContract: 0 }
const rows = []

for (const cfg of picked) {
  if (banned) break
  const r = await listJobs(cfg)
  if (!r.ok) { rows.push([cfg.tenant, 'FAILED: ' + r.status]); continue }

  let in30 = 0, us = 0
  const usJobs = []
  for (const j of r.jobs) {
    const age = daysAgo(j.postedOn)
    if (age === null || age > 30) continue
    in30++
    const loc = String(j.locationsText || '')
    if (!loc || !isUSLocation(loc)) continue
    us++
    usJobs.push(j)
  }

  let dSampled = 0, dDisq = 0, dContract = 0, dFailed = 0
  for (const j of usJobs.slice(0, DETAIL_SAMPLE)) {
    const info = await detail(cfg, j.externalPath)
    if (!info) { dFailed++; continue }
    dSampled++
    const plain = stripHtml(String(info.jobDescription || ''))
    const title = info.title || j.title || ''
    if (isDisqualified(`${title}\n${plain}`, title)) dDisq++
    else if (isContractOrPartTime(plain, title)) dContract++
  }

  g.boardTotal += r.total; g.listed += r.jobs.length; g.in30d += in30; g.us += us
  g.dSampled += dSampled; g.dDisq += dDisq; g.dContract += dContract
  rows.push([cfg.tenant, `board ${String(r.total).padStart(5)} · sampled ${String(r.jobs.length).padStart(3)} · ≤30d ${String(in30).padStart(3)} · US ${String(us).padStart(3)} · details ${dSampled}: ${dDisq} disqualified, ${dContract} contract/PT${dFailed ? ` (${dFailed} FAILED)` : ''}`])
}

console.log('Per tenant:')
for (const [t, line] of rows) console.log(`   ${t.padEnd(18)} ${line}`)

console.log('\n' + '═'.repeat(64))
console.log('THE NUMBER THIS EXISTS FOR')
console.log('═'.repeat(64))
const pct = (a, b) => b ? `${(100 * a / b).toFixed(0)}%` : '—'
console.log(`   Sampled listings:      ${g.listed}  (boards claim ${g.boardTotal} total)`)
console.log(`   Within 30 days:        ${g.in30d}  (${pct(g.in30d, g.listed)} of sampled)`)
console.log(`   ...and US:             ${g.us}  (${pct(g.us, g.listed)} of sampled)`)
console.log(`   Descriptions checked:  ${g.dSampled}`)
if (detailFailNote) console.log(`   First detail failure:  ${detailFailNote}`)
if (g.dSampled === 0) console.log('   ⚠️  ZERO descriptions checked — the yield below is meaningless. Fix the detail endpoint first.')
console.log(`   ...disqualified:       ${g.dDisq}  (${pct(g.dDisq, g.dSampled)})   citizen/clearance/sponsorship`)
console.log(`   ...contract/part-time: ${g.dContract}  (${pct(g.dContract, g.dSampled)})`)
const surviveShare = g.dSampled ? (g.dSampled - g.dDisq - g.dContract) / g.dSampled : 0
const estimated = Math.round(g.us * surviveShare)
console.log(`\n   ESTIMATED YIELD: ~${estimated} of ${g.listed} sampled listings (${pct(estimated, g.listed)}) would reach the board`)
console.log('   (recent US share × description survival, on this sample)')
console.log('═'.repeat(64))
console.log('\nNothing was written anywhere. This is a measurement.')
