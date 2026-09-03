// Enrich companies with official domain + logo via Brandfetch, per the
// Company Logo Integration Blueprint (Phase 1) and the house protocol.
//
// WHAT IT TOUCHES: a NEW `companies` collection only. Jobs, the board, and
// the API are completely unaffected until we deliberately wire them — so
// running this is additive and reversible (drop the collection to undo).
//
// THE NO-GUESSING RULE (blueprint §4): a company name alone is weak identity.
// We use Brandfetch Brand Search (name → candidate domains) and accept a
// candidate ONLY when a conservative similarity check agrees the result is
// the same company. Anything ambiguous is stored as needs_review with the
// candidates kept — a wrong logo on the wrong company is the failure mode,
// an initials placeholder is not.
//
// RESUMABLE: companies that already have a record are skipped. Re-run freely
// after future board expansions — only new companies cost API calls.
//
// RUN (from backend, needs BRANDFETCH_CLIENT_ID in .env):
//   node enrichCompanies.mjs           whole board (~5,900 companies, ~35 min)
//   node enrichCompanies.mjs 50        first 50 by job count (smoke test)
//
// OUTPUT: companies collection + branding-report.md (read the needs_review
// and top-100 sections — that is the eyeball pass).

import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID
if (!CLIENT_ID) { console.error('❌ BRANDFETCH_CLIENT_ID missing from .env'); process.exit(1) }

const LIMIT = parseInt(process.argv[2], 10) || Infinity
// --retry: reprocess companies stuck in needs_review/error (previously the
// `existing` skip made them permanently unretryable — Otter.ai, Aircall.io and
// Exadel Inc (Website) all sat in needs_review with no path out).
// --dry: full run, prints verdicts, writes nothing to Mongo.
const RETRY = process.argv.includes('--retry')
const DRY = process.argv.includes('--dry')
const DELAY_MS = 350                       // ~3 req/sec, polite
const SEARCH_URL = q => `https://api.brandfetch.io/v2/search/${encodeURIComponent(q)}?c=${CLIENT_ID}`
// Logo render URL is constructed at DISPLAY time from the domain (hotlinked,
// per Brandfetch free-tier terms — we store the domain, not a downloaded file).
// /fallback/404: without it Brandfetch serves ITS OWN logo for unknown domains,
// and the board rendered that placeholder as if it were the company's mark
// (caught 2026-09-03: Wynd Labs showing the Brandfetch "B"). A 404 lets the
// frontend's onError fall back to honest initials instead.
const LOGO_URL = d => `https://cdn.brandfetch.io/${d}/fallback/404?c=${CLIENT_ID}`

const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))
const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false, collection: 'companies' }))

// ── name normalization ───────────────────────────────────────────────────────
// Two forms: a SEARCH form (suffixes stripped, for the API query) and a
// COMPACT form (lowercase alphanumerics only, for similarity comparison).
const SUFFIX = /\b(incorporated|corporation|company|holdings?|group|inc|corp|co|llc|llp|ltd|plc|gmbh|sa|srl|bv|pty|careers?|website)\b\.?/gi
// Parentheticals go first: "Exadel Inc (Website)" must query as "Exadel", not
// "Exadel Website" — the old form matched nothing well and stranded the company
// in needs_review.
const searchForm = n => String(n).replace(/\([^)]*\)/g, ' ').replace(SUFFIX, ' ').replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim()
const compact = n => String(n).toLowerCase().replace(/[^a-z0-9]/g, '')

// Score EVERY candidate and take the best above a threshold — first-match
// accepted "bench.com" for Benchmark Physical Therapy and fcny.org for the
// City of New York in the smoke test. Rules learned from that eyeball pass:
//   • exact domain-root equality with the compacted name dominates (100)
//   • containment counts only in PROPORTION to coverage — "bench" covering
//     21% of "benchmarkphysicaltherapy" scores ~13, nowhere near acceptance
//   • a candidate NAME much longer than the query is a different entity
//     ("Fund for the City of New York" ⊃ "City of New York" → rejected)
//   • .com/.org/.gov/.net bonus, country-code TLD penalty — picks
//     dominos.com over dominos.com.au when both are returned
// Threshold 55: exact roots pass even with a cc-TLD penalty; partial
// containment passes only with high coverage plus a clean TLD. Everything
// else → needs_review with candidates saved. Wrongly cautious beats wrongly
// confident.
function scoreCandidate(q, result) {
  const domain = result.domain || ''
  const root = compact(domain.split('.')[0] || '')
  const rn = compact(result.name || '')
  let s = 0
  // "Otter.ai" compacts to "otterai" — exactly the whole domain with the dot
  // removed. The old scorer compared only the root ("otter"), scored it as
  // partial containment, then subtracted 25 for the two-letter TLD: every
  // .ai/.io-branded company was punished by its own name. Whole-domain
  // equality is the strongest possible signal, checked first and exempt from
  // the cc-TLD penalty (return directly).
  if (compact(domain) === q && q.length >= 5) return 100
  if (root && root === q) s = 100
  else if (rn && rn === q) s = 90
  else if (root.length >= 4 && q.includes(root)) s = 60 * (root.length / q.length)
  else if (q.length >= 4 && root.includes(q)) s = 60 * (q.length / root.length)
  else if (rn.length >= 4 && rn.includes(q) && rn.length <= q.length * 1.5) s = 50
  else if (rn.length >= 4 && q.includes(rn)) s = 50 * (rn.length / q.length)
  else return 0
  const parts = domain.split('.')
  const last = parts[parts.length - 1]
  if (last === 'com' || last === 'org' || last === 'gov' || last === 'net') s += 15
  else if (last.length === 2) s -= 25
  return s
}
function bestMatch(queryName, results) {
  const q = compact(searchForm(queryName))
  if (q.length < 3) return null
  let best = null, bestScore = 0
  for (const r of results) {
    if (!r.domain) continue
    const s = scoreCandidate(q, r)
    if (s > bestScore) { best = r; bestScore = s }
  }
  // Very short names (ALO, HP, GE) are inherently ambiguous — an exact root
  // match proves little at 3 letters. They need a near-perfect score (exact
  // root AND a clean TLD); anything less goes to review.
  const threshold = q.length <= 4 ? 100 : 55
  return bestScore >= threshold ? best : null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function searchBrand(name) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(SEARCH_URL(name), { headers: { accept: 'application/json' } })
      if (res.status === 429) { await sleep(5000); continue }
      if (!res.ok) return { error: `http ${res.status}` }
      const data = await res.json().catch(() => null)
      return { results: Array.isArray(data) ? data : [] }
    } catch (e) {
      if (attempt === 2) return { error: e.message }
      await sleep(1000)
    }
  }
  return { error: 'retries exhausted' }
}

function initialsOf(name) {
  const words = String(name).trim().split(/\s+/).filter(w => /^[a-z0-9]/i.test(w))
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (String(name).trim()[0] || '?').toUpperCase()
}

// Manual overrides (blueprint's admin-override concept, lightweight): the
// scorer cannot beat name-squatters on famous entities or franchisees that
// register under the brand's name. branding_overrides.json maps ats/slug →
// domain and is consulted before any search. Add a line, re-run, fixed.
const OVERRIDES = fs.existsSync('branding_overrides.json')
  ? JSON.parse(fs.readFileSync('branding_overrides.json', 'utf8')) : {}

await mongoose.connect(process.env.MONGODB_URI)

// Universe: every distinct (ats, slug) that has jobs, biggest first so the
// most visible companies resolve first and a smoke-test run covers the top.
const universe = await Job.aggregate([
  { $group: { _id: { ats: '$ats', slug: '$companySlug' }, name: { $first: '$company' }, jobs: { $sum: 1 } } },
  { $sort: { jobs: -1 } },
])
const existingFilter = RETRY ? { logoStatus: 'provider' } : {}
const existing = new Set((await Company.find(existingFilter, { ats: 1, slug: 1 }).lean()).map(c => `${c.ats}|${c.slug}`))
if (RETRY) console.log('♻️  RETRY mode — needs_review and error rows will be reprocessed')
if (DRY) console.log('🧪 DRY RUN — nothing will be written')
const todo = universe.filter(c => !existing.has(`${c._id.ats}|${c._id.slug}`)).slice(0, LIMIT)
console.log(`Companies with jobs: ${universe.length} · already enriched: ${existing.size} · to do now: ${todo.length}`)

let ok = 0, review = 0, errors = 0, done = 0
for (const c of todo) {
  const name = String(c.name || c._id.slug)
  const overrideDomain = OVERRIDES[`${c._id.ats}/${c._id.slug}`]
  const { results, error } = overrideDomain
    ? { results: [{ name, domain: overrideDomain }] }
    : await searchBrand(searchForm(name) || name)
  let doc = {
    ats: c._id.ats, slug: c._id.slug, companyName: name,
    normalizedName: compact(name), jobsAtEnrich: c.jobs,
    fallbackInitials: initialsOf(name),
    createdAt: new Date(), updatedAt: new Date(),
  }
  if (error) {
    doc = { ...doc, logoStatus: 'error', logoNote: error }
    errors++
  } else {
    const best = overrideDomain ? results[0] : bestMatch(name, results)
    if (best) {
      doc = {
        ...doc,
        officialDomain: best.domain,
        branding: {
          logoUrl: LOGO_URL(best.domain),
          logoSource: overrideDomain ? 'manual_override' : 'brandfetch',
          logoStatus: 'provider',
          providerName: best.name || null,
          logoVerifiedAt: null,
          logoLastCheckedAt: new Date(),
        },
        logoStatus: 'provider',
      }
      ok++
    } else {
      doc = {
        ...doc,
        logoStatus: 'needs_review',
        candidates: results.slice(0, 3).map(r => ({ name: r.name, domain: r.domain })),
      }
      review++
    }
  }
  if (DRY) {
    console.log(`   [${doc.logoStatus}] ${name} -> ${doc.officialDomain || '(none)'}`)
  } else {
    await Company.updateOne({ ats: c._id.ats, slug: c._id.slug }, { $set: doc }, { upsert: true })
  }
  done++
  if (done % 100 === 0) console.log(`   ${done}/${todo.length} · provider ${ok} · needs_review ${review} · errors ${errors}`)
  await sleep(DELAY_MS)
}

console.log(`\nDone: ${done} · provider ${ok} · needs_review ${review} · errors ${errors}`)

// ── report for the eyeball pass ──────────────────────────────────────────────
const all = await Company.find({}).sort({ jobsAtEnrich: -1 }).lean()
const lines = ['# Company branding report', '',
  `Total: ${all.length} · provider: ${all.filter(c => c.logoStatus === 'provider').length} · needs_review: ${all.filter(c => c.logoStatus === 'needs_review').length} · error: ${all.filter(c => c.logoStatus === 'error').length}`, '',
  '## Top 100 by jobs — EYEBALL THESE (name → resolved domain)', '']
for (const c of all.slice(0, 100)) {
  lines.push(`- [${c.logoStatus}] ${c.companyName} → ${c.officialDomain || '(none)'} · ${c.jobsAtEnrich} jobs`)
}
lines.push('', '## needs_review — ambiguous, showing initials until resolved', '')
for (const c of all.filter(x => x.logoStatus === 'needs_review').slice(0, 200)) {
  const cand = (c.candidates || []).map(x => `${x.name}:${x.domain}`).join(' | ')
  lines.push(`- ${c.companyName} [${c.ats}/${c.slug}] candidates: ${cand || 'none'}`)
}
if (!DRY) fs.writeFileSync('branding-report.md', lines.join('\n') + '\n')
console.log('📄 branding-report.md written — read Top-100 and needs_review sections.')

await mongoose.disconnect()
