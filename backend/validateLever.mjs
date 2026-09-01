// validateLever.mjs — which of the Lever slugs we know about are still live?
//
// Reads the keys of lever_names.json, asks Lever's public postings API about each,
// and writes the ones that answer to lever_boards.txt. Same shape as ashby_boards.txt:
// one slug per line, which fetchLever.mjs reads.
//
// Lever's API needs no key. A live board answers 200 with a JSON array (possibly
// empty — a company with no open roles is still a live board). A dead or renamed
// slug answers 404. Anything else is a network hiccup and is retried once, so a
// timeout does not quietly drop a real company from the list.
//
// No database. Nothing here touches Mongo.
//
//   node validateLever.mjs            validate and write lever_boards.txt
//   node validateLever.mjs --dry      validate and print, write nothing

import fs from 'fs'

const NAMES_PATH  = 'lever_names.json'
const BOARDS_PATH = 'lever_boards.txt'
const CONCURRENCY = 6
const TIMEOUT_MS  = 15000
const DRY = process.argv.includes('--dry')

async function probe(slug, attempt = 0) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 404) return { slug, state: 'dead' }
    if (!res.ok) {
      if (attempt === 0) return probe(slug, 1)
      return { slug, state: 'error', detail: `HTTP ${res.status}` }
    }
    const data = await res.json()
    if (!Array.isArray(data)) return { slug, state: 'error', detail: 'not an array' }
    return { slug, state: 'live', jobs: data.length }
  } catch (e) {
    if (attempt === 0) return probe(slug, 1)
    return { slug, state: 'error', detail: e.name }
  }
}

const names = JSON.parse(fs.readFileSync(NAMES_PATH, 'utf-8'))
const slugs = Object.keys(names)
console.log(`🔎 Probing ${slugs.length} Lever slugs from ${NAMES_PATH}${DRY ? '  (dry run)' : ''}\n`)

const live = [], dead = [], errors = []
let totalJobs = 0

for (let i = 0; i < slugs.length; i += CONCURRENCY) {
  const batch = await Promise.all(slugs.slice(i, i + CONCURRENCY).map(s => probe(s)))
  for (const r of batch) {
    if (r.state === 'live') { live.push(r.slug); totalJobs += r.jobs }
    else if (r.state === 'dead') dead.push(r.slug)
    else errors.push(`${r.slug}  (${r.detail})`)
  }
  process.stdout.write(`\r   ${Math.min(i + CONCURRENCY, slugs.length)}/${slugs.length} · live ${live.length} · dead ${dead.length} · errors ${errors.length}   `)
}

console.log('\n\n' + '─'.repeat(58))
console.log(`   Live boards:   ${live.length}   (${totalJobs} open postings between them, before any filter)`)
console.log(`   Dead (404):    ${dead.length}`)
console.log(`   Errors:        ${errors.length}`)
console.log('─'.repeat(58))

if (dead.length) {
  console.log('\nDead slugs (remove from lever_names.json when convenient):')
  for (const s of dead) console.log('  -', s)
}
if (errors.length) {
  console.log('\nErrors (not written as live, not written as dead — rerun later):')
  for (const s of errors) console.log('  -', s)
}

if (!DRY) {
  fs.writeFileSync(BOARDS_PATH, live.sort().join('\n') + '\n')
  console.log(`\n✅ Wrote ${live.length} slugs to ${BOARDS_PATH}`)
} else {
  console.log(`\n🧪 Dry run — ${BOARDS_PATH} not written`)
}
