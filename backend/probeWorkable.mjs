// probeWorkable.mjs — which Workable accounts answer, what are they called, and
// exactly what shape do the list and detail endpoints return?
//
// Reads slugs from workable_candidates.txt (one per line), asks each account's
// public widget API, and writes:
//   workable_boards.txt   the slugs that answered
//   workable_names.json   slug -> company name, taken from the API's own `name`
//                         field (Workable returns it; Lever and Ashby did not)
//
// It also answers a design question with data rather than memory: whether
// `?details=true` makes the list endpoint include description / requirements /
// benefits inline. If it does, the fetcher is one request per board. If it does
// not, the fetcher needs a second request per surviving job, and must gate on age
// and location first to keep that number small.
//
// No database. Nothing here touches Mongo.
//
//   node probeWorkable.mjs            probe and write both files
//   node probeWorkable.mjs --dry      probe and print, write nothing

import fs from 'fs'

const CANDIDATES_PATH = 'workable_candidates.txt'
const BOARDS_PATH     = 'workable_boards.txt'
const NAMES_PATH      = 'workable_names.json'
const CONCURRENCY     = 1          // serial. Parallel got the IP banned an hour ago.
const TIMEOUT_MS      = 15000
const DRY = process.argv.includes('--dry')

// Workable's DOCUMENTED public endpoint (workable.readme.io/reference/jobs-1):
//   GET https://www.workable.com/api/accounts/{slug}?details=true
// Returns the account name and every published job; details=true puts the
// description inline. One request per account.
//
// History, so nobody repeats it: the first probe used {slug}.workable.com/spi/v3/jobs
// and got 401 from every account (token required). The second used the endpoint the
// careers page calls (apply.workable.com/api/v3/...), which worked until ~500
// requests got the IP banned for half an hour. This one is the documented one.
async function probe(slug, attempt = 0) {
  const url = `https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=true`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'Optyply/1.0 (job board for international students; support@optyply.com)' } })
    if (res.status === 404 || res.status === 403 || res.status === 410) return { slug, state: 'closed', status: res.status }
    if (res.status === 429) return { slug, state: 'error', detail: 'HTTP 429 (throttled)' }
    if (!res.ok) {
      if (attempt === 0) return probe(slug, 1)
      return { slug, state: 'error', detail: `HTTP ${res.status}` }
    }
    const data = await res.json()
    const jobs = Array.isArray(data?.jobs) ? data.jobs : null
    if (!jobs) return { slug, state: 'error', detail: 'no jobs array; keys: ' + Object.keys(data || {}).join(',') }
    return { slug, state: 'live', name: data?.name || '', jobs: jobs.length, sample: jobs[0] || null, accountKeys: Object.keys(data) }
  } catch (e) {
    if (attempt === 0) return probe(slug, 1)
    return { slug, state: 'error', detail: e.name }
  }
}

if (!fs.existsSync(CANDIDATES_PATH)) {
  console.error(`❌ Not found: ${CANDIDATES_PATH}`); process.exit(1)
}
const slugs = fs.readFileSync(CANDIDATES_PATH, 'utf-8').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)
console.log(`🔎 Probing ${slugs.length} Workable accounts${DRY ? '  (dry run)' : ''}\n`)

const live = [], closed = [], errors = [], names = {}
let totalJobs = 0, firstLiveWithJobs = null, sampleJob = null, accountKeys = null

for (let i = 0; i < slugs.length; i += CONCURRENCY) {
  const batch = await Promise.all(slugs.slice(i, i + CONCURRENCY).map(s => probe(s)))
  await new Promise(r => setTimeout(r, 1000))
  for (const r of batch) {
    if (r.state === 'live') {
      live.push(r.slug); totalJobs += r.jobs
      if (r.name) names[r.slug] = r.name
      if (!firstLiveWithJobs && r.jobs > 0) { firstLiveWithJobs = r.slug; sampleJob = r.sample; accountKeys = r.accountKeys }
    }
    else if (r.state === 'closed') closed.push(`${r.slug}  (${r.status})`)
    else errors.push(`${r.slug}  (${r.detail})`)
  }
  process.stdout.write(`\r   ${Math.min(i + CONCURRENCY, slugs.length)}/${slugs.length} · live ${live.length} · closed ${closed.length} · errors ${errors.length}   `)
}

console.log('\n\n' + '─'.repeat(60))
console.log(`   Live accounts:   ${live.length}   (${totalJobs} open postings between them, before any filter)`)
console.log(`   Closed to us:    ${closed.length}   (404/403 — public API off or slug gone)`)
console.log(`   Errors:          ${errors.length}`)
console.log('─'.repeat(60))

if (sampleJob) {
  console.log('\nTop-level keys on the account response:')
  console.log('   ' + (accountKeys || []).join(', '))
  console.log('\nFields on a job:')
  console.log('   ' + Object.keys(sampleJob).join(', '))
  const shown = { ...sampleJob }
  if (typeof shown.description === 'string') shown.description = shown.description.slice(0, 200) + (shown.description.length > 200 ? '… [' + sampleJob.description.length + ' chars]' : '')
  console.log('\nSample job (verbatim, description truncated):')
  console.log(JSON.stringify(shown, null, 2).split('\n').map(l => '   ' + l).join('\n'))
  console.log(`\n   description inline: ${typeof sampleJob.description === 'string' && sampleJob.description.length > 0}`)
}

if (closed.length) { console.log('\nClosed to us:'); for (const s of closed) console.log('  -', s) }
if (errors.length) { console.log('\nErrors (rerun later):'); for (const s of errors) console.log('  -', s) }

if (!DRY && live.length === 0 && errors.length === slugs.length) {
  console.log(`\n⚠️  Every account errored. Not writing ${BOARDS_PATH} or ${NAMES_PATH} — that would clobber a good list with an empty one.`)
} else if (!DRY) {
  fs.writeFileSync(BOARDS_PATH, live.sort().join('\n') + '\n')
  fs.writeFileSync(NAMES_PATH, JSON.stringify(Object.fromEntries(Object.entries(names).sort()), null, 2) + '\n')
  console.log(`\n✅ Wrote ${live.length} slugs to ${BOARDS_PATH} and ${Object.keys(names).length} names to ${NAMES_PATH}`)
} else {
  console.log(`\n🧪 Dry run — nothing written`)
}
