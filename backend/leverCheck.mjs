// leverCheck.mjs — what would Lever actually add, and does the filter hold?
//
// COST is already answered: descriptions come with the list, so this is one request per
// company, 312 in total. Cheaper than Ashby's 585 and nothing like SmartRecruiters'
// ~15,000 detail calls. The build is not in doubt on cost.
//
// WHAT IS IN DOUBT
//
// 1. YIELD. The probe found Lever boards keep stale postings even harder than Ashby:
//    Veeva listed 861 postings and only 111 fell inside 30 days, Xsolla 27 of 183.
//    Around 13-15%, against Ashby's 40%. 312 companies is not 312 companies' worth of
//    jobs.
//
// 2. WHERE THE TEXT LIVES. Lever scatters a posting across six fields — description,
//    lists, additional, opening, descriptionBody and their plain twins. `additionalPlain`
//    was 751 characters on Veeva and 2,110 on Xsolla, and that is where EEO and legal
//    boilerplate sits. On SmartRecruiters the sponsorship refusals were almost always in
//    the equivalent field rather than the job description. Reading only `description`
//    would miss exactly the sentences this product exists to catch.
//
// Writes nothing. Touches no database.
//
//   node leverCheck.mjs           40 companies
//   node leverCheck.mjs 120

import fs from 'fs'
import { DISQUALIFIER_PATTERNS, isDisqualified, isUSLocation, isContractOrPartTime, stripHtml } from './FetchJobs.mjs'

const LIST_PATH = 'lever_companies.txt'
const HOW_MANY = Number(process.argv[2]) || 40
const MAX_AGE_DAYS = 30
const CONCURRENCY = 5
const TIMEOUT_MS = 20000

const MENTIONS = /\b(sponsor(ship|ed|ing)?|work authoriz|work authoris|h-?1b|green card|permanent resident|u\.?s\.? citizen|security clearance|export[- ]control|itar|employment eligibility)\b/i

/**
 * Every scrap of text on a posting.
 *
 * Six fields, and the filter has to see all of them. `lists` is an array of
 * { text, content } sections — requirements, benefits, and often the legal footer.
 */
function allText(j) {
  const parts = [
    j.descriptionPlain || j.description || '',
    j.additionalPlain || j.additional || '',
    j.openingPlain || j.opening || '',
    j.descriptionBodyPlain || j.descriptionBody || '',
    j.salaryDescriptionPlain || j.salaryDescription || '',
    ...(Array.isArray(j.lists) ? j.lists.map(l => `${l.text || ''}\n${l.content || ''}`) : []),
  ]
  return stripHtml(parts.join('\n'))
}

async function board(company) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { company, ok: false, status: res.status }
    const data = await res.json()
    return { company, ok: true, jobs: Array.isArray(data) ? data : (data.data || []) }
  } catch (e) {
    return { company, ok: false, status: e.name }
  }
}

async function main() {
  if (!fs.existsSync(LIST_PATH)) { console.error(`❌ Not found: ${LIST_PATH}`); process.exit(1) }
  const all = fs.readFileSync(LIST_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)
  const companies = all.slice(0, HOW_MANY)

  console.log(`🔎 Sampling ${companies.length} of ${all.length} Lever companies`)
  console.log(`   Filter patterns loaded: ${DISQUALIFIER_PATTERNS.length}`)
  console.log(`   Age window: ${MAX_AGE_DAYS} days\n`)

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000
  let total = 0, tooOld = 0, noDate = 0, nonUS = 0, mentions = 0
  let disq = 0, contract = 0, passed = 0, dead = 0, ms = 0
  const byCountry = {}
  const caught = [], leaked = []

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const t0 = Date.now()
    const results = await Promise.all(companies.slice(i, i + CONCURRENCY).map(board))
    ms += Date.now() - t0

    for (const r of results) {
      if (!r.ok) { dead++; continue }
      for (const j of r.jobs) {
        total++

        if (!j.createdAt) { noDate++; continue }
        if (j.createdAt < cutoff) { tooOld++; continue }

        // The country code is structured, so nationality is settled without string
        // matching — the same trap that let Costa Rica and Brazil onto the board when
        // SmartRecruiters' "SC" was read as South Carolina.
        const country = String(j.country || '').trim().toUpperCase()
        byCountry[country || '(none)'] = (byCountry[country || '(none)'] || 0) + 1
        if (country !== 'US') { nonUS++; continue }

        const loc = j.categories?.location || ''
        if (loc && !isUSLocation(loc)) { nonUS++; continue }

        const text = allText(j).toLowerCase()
        const full = `${j.text || ''}\n${text}`
        const mentioned = MENTIONS.test(text)
        if (mentioned) mentions++

        if (isDisqualified(full)) {
          disq++
          if (caught.length < 8) {
            const hit = DISQUALIFIER_PATTERNS.find(p => p.test(full))
            const m = hit && full.match(hit)
            const at = m ? full.indexOf(m[0]) : 0
            caught.push({ co: r.company, title: j.text, quote: full.slice(Math.max(0, at - 70), at + 130).replace(/\s+/g, ' ') })
          }
          continue
        }
        if (isContractOrPartTime(text, j.text || '')) { contract++; continue }
        passed++

        if (mentioned && leaked.length < 12) {
          const m = text.match(MENTIONS)
          const at = m ? text.indexOf(m[0]) : 0
          leaked.push({ co: r.company, title: j.text, url: j.hostedUrl, quote: text.slice(Math.max(0, at - 130), at + 190).replace(/\s+/g, ' ') })
        }
      }
    }
    process.stdout.write(`\r   companies ${Math.min(i + CONCURRENCY, companies.length)}/${companies.length} · postings ${total}   `)
  }

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—'
  const live = companies.length - dead
  const scale = live ? all.length / live : 0

  console.log('\n\n' + '─'.repeat(64))
  console.log(`   Companies sampled:     ${companies.length}  (${dead} did not answer)`)
  console.log(`   Postings listed:       ${total}`)
  console.log(`   No date:               ${noDate}`)
  console.log(`   Older than ${MAX_AGE_DAYS}d:       ${tooOld}  ${pct(tooOld, total)}`)
  console.log(`   Non-US:                ${nonUS}  ${pct(nonUS, total)}`)
  console.log(`   Mention status:        ${mentions}`)
  console.log(`   Filter disqualifies:   ${disq}`)
  console.log(`   Contract/part-time:    ${contract}`)
  console.log(`   WOULD REACH THE BOARD: ${passed}`)
  console.log('─'.repeat(64))
  console.log(`   Per working company:   ${(passed / Math.max(1, live)).toFixed(1)}`)
  console.log(`   PROJECTED over ${all.length}:  ~${Math.round((passed / Math.max(1, live)) * all.length)} jobs`)
  console.log(`   Run time for sample:   ${Math.round(ms / 1000)}s  ->  full run ~${Math.round(ms / 1000 * scale / 60)} min`)
  console.log('─'.repeat(64))
  console.log('   For comparison: Ashby added 3,090. SmartRecruiters added 11,399.')

  const top = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`\n   Countries among recent postings: ${top.map(([k, v]) => `${k}=${v}`).join('  ')}`)

  if (caught.length) {
    console.log('\n✅ CAUGHT — the filter works on these:\n')
    for (const c of caught) console.log(`   ${c.co} · ${c.title}\n      …${c.quote}…\n`)
  }
  if (leaked.length) {
    console.log('\n⚠️  MENTIONS STATUS BUT PASSED — read every one:\n')
    for (const c of leaked) console.log(`   ${c.co} · ${c.title}\n      …${c.quote}…\n      ${c.url}\n`)
  }
  console.log('\nNothing was written. No database was touched.')
}

main().catch(e => { console.error('❌ Failed:', e); process.exit(1) })
