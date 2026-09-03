// Full-text leak check: re-fetch complete Workday ads for saved jobs and test
// them against (a) the real isDisqualified() and (b) targeted phrase regexes.
// The stored 500-char descriptions cannot answer this; this can.
//
//   node fullLeakCheck.mjs --prod --tenant abb --n 30
//   node fullLeakCheck.mjs --prod --n 5          5 random jobs from EVERY tenant
//
// Read-only against Mongo. Serial + 1000ms pace against Workday (same manners
// as fetchWorkday.mjs). ~2s per job — 30 jobs is about a minute.
import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
import { stripHtml, isDisqualified } from './FetchJobs.mjs'
import { parseCareerUrl } from './fetchWorkday.mjs'
dotenv.config()

const PROD = process.argv.includes('--prod')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

const tIdx = process.argv.indexOf('--tenant')
const TENANT = tIdx > -1 ? String(process.argv[tIdx + 1] || '').toLowerCase() : null
const nIdx = process.argv.indexOf('--n')
const N = nIdx > -1 ? Number(process.argv[nIdx + 1]) : 30

const PHRASES = [
  /permanent\s+work\s+authorization/i,
  /permanently\s+authorized\s+to\s+work/i,
  /work\s+authorization\s+.{0,30}without\s+.{0,20}sponsorship/i,
  /no\s+visa\s+sponsorship/i,
  /unable\s+to\s+sponsor/i,
  /will\s+not\s+sponsor/i,
]

const UA = 'Optyply/1.0 (job board for international students; support@optyply.com)'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Same two shapes as fetchWorkday.detail(), remembered per tenant.
const shapeMemo = new Map()
async function fetchFull(cfg, externalPath) {
  const referer = `${cfg.origin}/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}${externalPath}`
  const shapes = shapeMemo.has(cfg.tenant) ? [shapeMemo.get(cfg.tenant)] : ['plain', 'jobPrefix']
  for (const shape of shapes) {
    const p = shape === 'plain' ? externalPath : `/job${externalPath}`
    try {
      const res = await fetch(`${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}${p}`,
        { headers: { accept: 'application/json', 'user-agent': UA, referer }, signal: AbortSignal.timeout(15000) })
      await sleep(1000)
      if (!res.ok) continue
      const d = await res.json()
      if (d?.jobPostingInfo) { shapeMemo.set(cfg.tenant, shape); return d.jobPostingInfo }
    } catch { await sleep(1000) }
  }
  return null
}

// externalPath back out of the stored applyUrl:
// applyUrl = origin + /locale?/ + site + externalPath, externalPath starts at "/job..."
function externalPathOf(applyUrl, cfg) {
  try {
    const u = new URL(applyUrl)
    let p = u.pathname
    const prefix = `/${cfg.locale ? cfg.locale + '/' : ''}${cfg.site}`
    if (p.startsWith(prefix)) return p.slice(prefix.length)
    const i = p.indexOf('/job/')
    return i > -1 ? p.slice(i) : null
  } catch { return null }
}

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name)
const Job = mongoose.models.Job || mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

// tenant -> cfg from the boards file (same parse as the fetcher)
const cfgs = new Map()
for (const line of fs.readFileSync('workday_boards.txt', 'utf-8').split('\n')) {
  const c = parseCareerUrl(line.trim())
  if (c) cfgs.set(c.tenant.toLowerCase(), c)
}

const match = { ats: 'workday', ...(TENANT ? { companySlug: TENANT } : {}) }
const picked = TENANT
  ? await Job.aggregate([{ $match: match }, { $sample: { size: N } }])
  : await Job.aggregate([{ $match: match }, { $group: { _id: '$companySlug', jobs: { $push: '$$ROOT' } } },
      { $project: { jobs: { $slice: ['$jobs', N] } } }, { $unwind: '$jobs' }, { $replaceRoot: { newRoot: '$jobs' } }])
console.log(`Checking ${picked.length} job(s)${TENANT ? ` from ${TENANT}` : ' across tenants'} — full ad text, ~${Math.ceil(picked.length * 2 / 60)} min\n`)

let leaks = 0, gone = 0, ok = 0
for (const j of picked) {
  const cfg = cfgs.get(String(j.companySlug).toLowerCase())
  if (!cfg) { console.log(`   ?  no board config for ${j.companySlug} — skipped`); continue }
  const ep = externalPathOf(j.applyUrl, cfg)
  if (!ep) { console.log(`   ?  could not derive path: ${j.applyUrl}`); continue }
  const info = await fetchFull(cfg, ep)
  if (!info) { gone++; process.stdout.write('.'); continue }  // posting likely closed since fetch — not a leak signal

  const title = String(info.title || j.title || '')
  const full = `${title}\n${stripHtml(String(info.jobDescription || ''))}`
  const disq = isDisqualified(full, title)
  const hits = PHRASES.filter(re => re.test(full))
  if (disq || hits.length) {
    leaks++
    console.log(`\n❌ ${j.companySlug} · ${title}`)
    console.log(`   id ${j.id}`)
    if (disq) console.log('   isDisqualified: TRUE — current filter rejects this text; job predates the fix or filter changed')
    for (const re of hits) {
      const m = full.match(new RegExp(`.{0,60}${re.source}.{0,60}`, 'i'))
      console.log(`   phrase ${re} :: ...${(m ? m[0] : '').replace(/\s+/g, ' ').trim()}...`)
    }
  } else { ok++; process.stdout.write('.') }
}

console.log(`\n\n${ok} clean · ${leaks} LEAK(S) · ${gone} no longer fetchable (closed since save — rerun if many)`)
console.log(leaks === 0 ? '✅ Full-text pass on this sample.' : '🛑 Leaked jobs above must come off the board and the pattern needs widening.')
await mongoose.disconnect()
