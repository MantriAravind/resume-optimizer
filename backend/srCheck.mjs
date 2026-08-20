// srCheck.mjs — can SmartRecruiters be afforded, and does the filter survive it?
//
// TWO QUESTIONS, BOTH BEFORE ANY FETCHER IS WRITTEN
//
// 1. COST. Unlike Greenhouse and Ashby, SmartRecruiters does not return descriptions
//    with the job list — `defaultJobAd` is a boolean and nothing more. Every description
//    is a second request. AbbVie alone lists 1,734 postings. Across 259 companies that
//    could be a hundred thousand requests, and a source that cannot finish inside a
//    scheduled run is not a source.
//
//    The saving grace is gate ORDER. Age and location come free with the list, so a
//    posting only costs a detail call if it survives both. On Ashby those two gates
//    removed 75% of everything, and these are global enterprises — the first ten results
//    included São Paulo, Penang and Malaysia — so the cut should be deeper still.
//
// 2. SAFETY. The 95 patterns were tuned on Greenhouse and shown to transfer to Ashby
//    (11.8% disqualified, real ITAR and citizenship catches, no leaks in 1,531 jobs).
//    This list is defence and pharma — General Dynamics, Western Digital, AbbVie — which
//    is exactly where clearance and citizenship requirements live. If the filter comes
//    back near zero here, that is not good news: it means either these employers do not
//    restrict, or they restrict in wording the patterns do not recognise. Only the second
//    is dangerous, and it would put jobs on the board that a student cannot legally hold.
//
// Writes nothing. Touches no database.
//
//   node srCheck.mjs           15 companies
//   node srCheck.mjs 40        more companies, slower

import fs from 'fs'
import { DISQUALIFIER_PATTERNS, isDisqualified, isUSLocation, isContractOrPartTime, stripHtml } from './FetchJobs.mjs'

const LIST_PATH   = 'sr_companies.txt'
const HOW_MANY    = Number(process.argv[2]) || 15
const MAX_AGE_DAYS = 30
const PAGE        = 100        // list page size
const DETAIL_CONC = 8          // detail calls in flight
const TIMEOUT_MS  = 15000

const MENTIONS = /\b(sponsor(ship|ed|ing)?|work authoriz|work authoris|h-?1b|green card|permanent resident|u\.?s\.? citizen|security clearance|export[- ]control|itar|employment eligibility)\b/i

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function listPage(company, offset) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${PAGE}&offset=${offset}`
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) return null
  return res.json()
}

async function detail(company, id) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${id}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

/** Every section of the ad, flattened. HTML is stripped with the pipeline's own helper. */
function adText(d) {
  const s = d?.jobAd?.sections || {}
  return stripHtml(Object.values(s).map(v => v?.text || '').join('\n'))
}

function locationOf(p) {
  const l = p.location || {}
  return [l.city, l.region, l.country].filter(Boolean).join(', ')
}

async function main() {
  if (!fs.existsSync(LIST_PATH)) { console.error(`❌ Not found: ${LIST_PATH}`); process.exit(1) }
  const all = fs.readFileSync(LIST_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)
  const companies = all.slice(0, HOW_MANY)

  console.log(`🔎 Sampling ${companies.length} of ${all.length} SmartRecruiters companies`)
  console.log(`   Filter patterns loaded: ${DISQUALIFIER_PATTERNS.length}`)
  console.log(`   Age window: ${MAX_AGE_DAYS} days\n`)

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000
  let totalListed = 0, tooOld = 0, nonUS = 0, needDetail = 0
  let detailOk = 0, detailFail = 0, disq = 0, contract = 0, passed = 0, mentions = 0
  let detailMs = 0, listCalls = 0, deadCompanies = 0
  const dateSpread = {}
  const caught = [], leaked = []

  for (const co of companies) {
    let offset = 0, found = null, pageCount = 0
    const survivors = []

    // ── Phase 1: walk the list. Free data only — age and location.
    while (true) {
      let page
      try { page = await listPage(co, offset) } catch { page = null }
      listCalls++
      if (!page) break
      if (found === null) found = page.totalFound

      for (const p of page.content || []) {
        totalListed++

        const d = p.releasedDate ? Date.parse(p.releasedDate) : NaN
        if (Number.isNaN(d)) { tooOld++; continue }
        const day = new Date(d).toISOString().slice(0, 10)
        dateSpread[day] = (dateSpread[day] || 0) + 1
        if (d < cutoff) { tooOld++; continue }

        const loc = locationOf(p)
        if (!loc || !isUSLocation(loc)) { nonUS++; continue }

        survivors.push({ id: p.id, title: p.name || '', loc })
      }

      offset += PAGE
      pageCount++
      if (!page.content?.length || offset >= (found || 0) || pageCount > 30) break
      await sleep(80)
    }

    if (found === null) { deadCompanies++; continue }
    needDetail += survivors.length

    // ── Phase 2: only survivors cost a detail call.
    for (let i = 0; i < survivors.length; i += DETAIL_CONC) {
      const batch = survivors.slice(i, i + DETAIL_CONC)
      const t0 = Date.now()
      const results = await Promise.all(batch.map(s => detail(co, s.id)))
      detailMs += Date.now() - t0

      results.forEach((d, k) => {
        const s = batch[k]
        if (!d) { detailFail++; return }
        detailOk++

        const text = adText(d).toLowerCase()
        const full = `${s.title}\n${text}`
        const mentioned = MENTIONS.test(text)
        if (mentioned) mentions++

        if (isDisqualified(full)) {
          disq++
          if (caught.length < 8) {
            const hit = DISQUALIFIER_PATTERNS.find(p => p.test(full))
            const m = hit && full.match(hit)
            const at = m ? full.indexOf(m[0]) : 0
            caught.push({ co, title: s.title, quote: full.slice(Math.max(0, at - 70), at + 130).replace(/\s+/g, ' ') })
          }
          return
        }
        if (isContractOrPartTime(text, s.title)) { contract++; return }
        passed++

        if (mentioned && leaked.length < 12) {
          const m = text.match(MENTIONS)
          const at = m ? text.indexOf(m[0]) : 0
          leaked.push({ co, title: s.title, quote: text.slice(Math.max(0, at - 130), at + 190).replace(/\s+/g, ' ') })
        }
      })
    }
    process.stdout.write(`\r   ${co.padEnd(24).slice(0, 24)} listed ${totalListed} · detail ${detailOk}   `)
  }

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—'
  const avgDetail = detailOk ? Math.round(detailMs / detailOk) : 0
  const perCo = companies.length - deadCompanies
  const scale = perCo ? all.length / perCo : 0

  console.log('\n\n' + '─'.repeat(64))
  console.log('   COST')
  console.log(`   Companies sampled:     ${companies.length}  (${deadCompanies} did not answer)`)
  console.log(`   List calls:            ${listCalls}`)
  console.log(`   Postings listed:       ${totalListed}`)
  console.log(`   Dropped on age:        ${tooOld}  ${pct(tooOld, totalListed)}   (free — list data)`)
  console.log(`   Dropped non-US:        ${nonUS}  ${pct(nonUS, totalListed)}   (free — list data)`)
  console.log(`   NEEDED A DETAIL CALL:  ${needDetail}  ${pct(needDetail, totalListed)}`)
  console.log(`   Detail calls made:     ${detailOk}  (${detailFail} failed)`)
  console.log(`   Average detail call:   ${avgDetail}ms`)
  console.log('─'.repeat(64))
  const projMin = Math.round((detailMs / 1000 * scale) / 60)
  console.log(`   PROJECTED FULL RUN over ${all.length} companies: ~${projMin} min`)
  console.log(`   (Ashby is 4 min for 585 boards. Greenhouse is ~26 min for 5,441.)`)
  console.log('─'.repeat(64))
  console.log('   SAFETY')
  console.log(`   Mention status:        ${mentions}  ${pct(mentions, detailOk)} of fetched`)
  console.log(`   Filter disqualifies:   ${disq}  ${pct(disq, detailOk)} of fetched`)
  console.log(`   Contract/part-time:    ${contract}`)
  console.log(`   WOULD REACH THE BOARD: ${passed}`)
  console.log(`   Per company:           ${(passed / Math.max(1, perCo)).toFixed(1)}`)
  console.log(`   Projected jobs added:  ~${Math.round((passed / Math.max(1, perCo)) * all.length)}`)
  console.log('─'.repeat(64))
  console.log('   For comparison: Greenhouse disqualifies ~23%, Ashby 11.8%.')

  const days = Object.keys(dateSpread).sort()
  console.log(`\n   Date range seen: ${days[0]} … ${days[days.length - 1]}  (${days.length} distinct days)`)
  if (days.length < 5) {
    console.log('   ⚠️  Very few distinct dates. releasedDate may be a re-post or update')
    console.log('      timestamp rather than a first-posted date — the same trap that put')
    console.log('      18,100 undeletable rows in the Greenhouse collection.')
  }

  if (caught.length) {
    console.log('\n✅ CAUGHT — the filter works on these:\n')
    for (const c of caught) console.log(`   ${c.co} · ${c.title}\n      …${c.quote}…\n`)
  }
  if (leaked.length) {
    console.log('\n⚠️  MENTIONS STATUS BUT PASSED — read every one:\n')
    for (const c of leaked) console.log(`   ${c.co} · ${c.title}\n      …${c.quote}…\n`)
  }
  console.log('\nNothing was written. No database was touched.')
}

main().catch(e => { console.error('❌ Failed:', e); process.exit(1) })
