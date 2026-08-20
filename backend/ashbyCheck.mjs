// ashbyCheck.mjs — does the existing filter actually work on Ashby postings?
//
// WHY THIS RUNS BEFORE ANY FETCHER IS WRITTEN
// The filter is what makes this board honest. It was tuned over seven rounds against
// Greenhouse descriptions, and even there two phrasings leaked through this week. A
// different ATS writes differently, so the question is not "can we fetch Ashby jobs"
// — that part is easy — but "will 95 patterns still catch what they need to".
//
// A first probe of five boards found ONE mention of sponsorship in 172 jobs. On
// Greenhouse roughly a quarter of postings state a restriction. Either Ashby companies
// genuinely restrict less, or they restrict without writing it down — and only the
// second is dangerous, because a filter cannot catch what is not there.
//
// Writes nothing. Touches no database. Prints numbers and quotes so the decision to
// integrate Ashby is made on evidence.
//
//   node ashbyCheck.mjs            50 boards
//   node ashbyCheck.mjs 150        more boards, slower

import fs from 'fs'
// The REAL functions the pipeline uses, not copies. A reimplementation here would test
// something that does not run in production, which is how a check ends up passing while
// the board still leaks.
import { DISQUALIFIER_PATTERNS, isDisqualified, isUSLocation } from './FetchJobs.mjs'

const BOARDS_PATH = 'ashby_boards.txt'
const HOW_MANY = Number(process.argv[2]) || 50
const CONCURRENCY = 6

// Anything that looks like it is talking about status, whether or not it disqualifies.
// Deliberately broader than the filter: the point is to measure how often the subject
// comes up at all, not how often it is refused.
// Narrower than the first version. "opt", "cpt" and "citizen" alone matched ordinary
// marketing copy — twelve 1Password postings were flagged for the word "opt" inside
// "adopt". A false alarm in this list is worse than useless: it buries a real leak.
const MENTIONS = /\b(sponsor(ship|ed|ing)?|work authoriz|work authoris|h-?1b|green card|permanent resident|u\.?s\.? citizen|security clearance|export[- ]control|itar|employment eligibility)\b/i

async function board(name) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { name, ok: false, status: res.status }
    const data = await res.json()
    return { name, ok: true, jobs: data.jobs || [] }
  } catch (e) {
    return { name, ok: false, status: e.name }
  }
}

async function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error(`❌ Not found: ${BOARDS_PATH}`); process.exit(1)
  }
  const all = fs.readFileSync(BOARDS_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)
  const boards = all.slice(0, HOW_MANY)
  console.log(`🔎 Checking ${boards.length} of ${all.length} Ashby boards`)
  console.log(`   Filter patterns loaded: ${DISQUALIFIER_PATTERNS.length}\n`)

  let totalJobs = 0, listed = 0, usJobs = 0, mentions = 0, disqualified = 0
  let deadBoards = 0
  // Ashby boards keep postings up far longer than Greenhouse — the first probe found a
  // job published two years ago still listed. The pipeline drops anything over 30 days,
  // so the only number that matters for the board is how many are actually recent.
  const AGE_BUCKETS = { '0-7d': 0, '8-30d': 0, '31-90d': 0, '91-365d': 0, 'over 1y': 0, 'no date': 0 }
  let passedAndFresh = 0
  const now = Date.now()
  const examples = []          // things the filter caught
  const missedLooking = []     // mention status but were NOT disqualified — read these

  for (let i = 0; i < boards.length; i += CONCURRENCY) {
    const slice = boards.slice(i, i + CONCURRENCY)
    const results = await Promise.all(slice.map(board))

    for (const r of results) {
      if (!r.ok) { deadBoards++; continue }
      for (const j of r.jobs) {
        totalJobs++
        if (j.isListed === false) continue
        listed++

        const loc = [j.location, ...(j.secondaryLocations || []).map(s => s.location)].filter(Boolean).join(', ')
        if (!isUSLocation(loc)) continue
        usJobs++

        // Age bucket, measured on every US job whether or not it survives the filter.
        let ageDays = null
        if (j.publishedAt) {
          const t = Date.parse(j.publishedAt)
          if (!Number.isNaN(t)) ageDays = (now - t) / 86400000
        }
        if (ageDays === null) AGE_BUCKETS['no date']++
        else if (ageDays <= 7) AGE_BUCKETS['0-7d']++
        else if (ageDays <= 30) AGE_BUCKETS['8-30d']++
        else if (ageDays <= 90) AGE_BUCKETS['31-90d']++
        else if (ageDays <= 365) AGE_BUCKETS['91-365d']++
        else AGE_BUCKETS['over 1y']++

        const text = String(j.descriptionPlain || '').toLowerCase()
        const mentioned = MENTIONS.test(text)
        if (mentioned) mentions++

        // isDisqualified is what the pipeline actually calls, so this measures the real
        // decision. The matching pattern is looked up separately, only to quote it.
        const blocked = isDisqualified(text)
        const hit = blocked ? DISQUALIFIER_PATTERNS.find(p => p.test(text)) : null
        if (blocked) {
          disqualified++
          if (examples.length < 8) {
            const m = text.match(hit)
            const at = m ? text.indexOf(m[0]) : 0
            examples.push({
              co: r.name, title: j.title,
              pattern: String(hit).slice(0, 60),
              quote: text.slice(Math.max(0, at - 70), at + 120).replace(/\s+/g, ' '),
            })
          }
        } else if (ageDays !== null && ageDays <= 30) {
          // Survived the filter AND recent enough to reach the board. This is the only
          // count that describes what students would actually see.
          passedAndFresh++
        }

        if (!blocked && mentioned && missedLooking.length < 12) {
          // The posting talks about status and the filter let it through. Every real
          // leak this week looked exactly like this.
          const m = text.match(MENTIONS)
          const at = m ? text.indexOf(m[0]) : 0
          missedLooking.push({
            co: r.name, title: j.title, url: j.jobUrl,
            quote: text.slice(Math.max(0, at - 130), at + 190).replace(/\s+/g, ' '),
          })
        }
      }
    }
    process.stdout.write(`\r   boards ${Math.min(i + CONCURRENCY, boards.length)}/${boards.length} · jobs ${totalJobs}   `)
  }

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—'
  console.log('\n\n' + '─'.repeat(64))
  console.log(`   Boards checked:        ${boards.length}  (${deadBoards} did not answer)`)
  console.log(`   Jobs returned:         ${totalJobs}`)
  console.log(`   Listed:                ${listed}`)
  console.log(`   US locations:          ${usJobs}  ${pct(usJobs, listed)} of listed`)
  console.log(`   Mention status at all: ${mentions}  ${pct(mentions, usJobs)} of US jobs`)
  console.log(`   Filter disqualifies:   ${disqualified}  ${pct(disqualified, usJobs)} of US jobs`)
  console.log('─'.repeat(64))
  console.log('   HOW OLD ARE THEY  (US jobs, before filtering)')
  for (const [k, v] of Object.entries(AGE_BUCKETS)) {
    const bar = '█'.repeat(Math.round((v / Math.max(1, usJobs)) * 40))
    console.log(`     ${k.padEnd(9)} ${String(v).padStart(5)}  ${pct(v, usJobs).padStart(6)}  ${bar}`)
  }
  console.log('─'.repeat(64))
  const fresh = AGE_BUCKETS['0-7d'] + AGE_BUCKETS['8-30d']
  console.log(`   Posted in last 30 days:      ${fresh}  ${pct(fresh, usJobs)} of US jobs`)
  console.log(`   PASSES FILTER *AND* RECENT:  ${passedAndFresh}   <-- what reaches the board`)
  const perBoard = (passedAndFresh / Math.max(1, boards.length - deadBoards))
  console.log(`   Per working board:           ${perBoard.toFixed(1)}`)
  console.log(`   Projected over all ${all.length} boards: ~${Math.round(perBoard * all.length)} jobs`)
  console.log('─'.repeat(64))
  console.log(`   For comparison, Greenhouse disqualifies roughly 23% of US jobs.`)
  console.log(`   A much lower number here means one of two things, and they are not`)
  console.log(`   the same: Ashby companies restrict less, OR they restrict without`)
  console.log(`   writing it down. Only the second is dangerous.`)

  if (examples.length) {
    console.log('\n✅ CAUGHT — the filter works on these:\n')
    for (const e of examples) {
      console.log(`   ${e.co} · ${e.title}`)
      console.log(`      …${e.quote}…\n`)
    }
  }

  if (missedLooking.length) {
    console.log('\n⚠️  MENTIONS STATUS BUT PASSED — read every one of these:\n')
    for (const e of missedLooking) {
      console.log(`   ${e.co} · ${e.title}`)
      console.log(`      …${e.quote}…`)
      console.log(`      ${e.url}\n`)
    }
  }

  console.log('\nNothing was written. No database was touched.')
}

main().catch(e => { console.error('❌ Failed:', e); process.exit(1) })
