// guessSlugs.mjs — find Greenhouse companies by guessing their slug.
//
// WHY THIS EXISTS
// Greenhouse publishes no directory of boards. You cannot ask "which companies are on
// Greenhouse?", only "is this exact company on Greenhouse?" — one at a time, for free.
//
// discoverSlugs.mjs reads five new-grad job repos and pulls slugs straight out of URLs
// they already contain. That is precise but capped: those repos track a few hundred
// tech companies between them and the list has been fully harvested.
//
// This script inverts it. Start with company NAMES from anywhere, turn each into the
// handful of slugs it could plausibly be, and ask the API. Most guesses miss. The check
// is free, so that is fine.
//
//   "Airbnb"            -> airbnb            -> 200  keep
//   "Y Combinator"      -> ycombinator       -> 200  keep
//   "Acme Corp."        -> acmecorp, acme    -> 404  drop
//
// USAGE
//   node guessSlugs.mjs companies.txt          one company name per line
//   node guessSlugs.mjs companies.txt --limit 5000
//
// Nothing is overwritten. Writes two files and tells you how to swap them in, exactly
// like discoverSlugs.mjs.

import fs from 'fs'
import path from 'path'

const SLUGS_PATH  = path.resolve('greenhouse_companies.json')
const OUTPUT_PATH = path.resolve('greenhouse_companies.merged.json')
const NEW_PATH    = path.resolve('greenhouse_companies.new.json')
const SEEN_PATH   = path.resolve('.guessed_slugs_seen.json')

// Concurrency and pacing.
//
// Greenhouse does not publish a rate limit, so this is deliberately gentle: ten in
// flight and a short pause between batches. A discovery script is not worth getting
// the pipeline's IP throttled over — the pipeline is what actually feeds the board.
const BATCH_SIZE  = 10
const PAUSE_MS    = 120
const TIMEOUT_MS  = 8000

// Words that are never a company, plus the noise that survives slugifying.
const NOT_SLUGS = new Set([
  'embed', 'job_board', 'jobs', 'v1', 'boards', 'api', 'inc', 'llc', 'ltd', 'corp',
  'the', 'company', 'group', 'holdings', 'technologies', 'labs', 'io', 'ai', 'co',
])

// Suffixes that companies write down but never put in a slug.
const SUFFIXES = /\s+(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|limited|corp|corp\.|corporation|co|co\.|company|plc|gmbh|s\.a\.|sa|nv|ab|pty|holdings|group|technologies|technology|labs|software|systems)\.?$/gi

/**
 * The slugs a company name could plausibly map to, best guess first.
 *
 * Greenhouse slugs are chosen by the company, so this is genuinely guessing. Three
 * variants per name is the sweet spot: it catches the common patterns without
 * tripling the request count for names that were never going to hit.
 */
function slugVariants(rawName) {
  const name = String(rawName || '').trim()
  if (!name) return []

  const cleaned = name
    .replace(SUFFIXES, '')
    .replace(/[''']/g, '')            // O'Reilly -> OReilly
    .replace(/&/g, 'and')
    .trim()

  const words = cleaned.split(/[\s\-_.,/]+/).filter(Boolean)
  if (!words.length) return []

  const joined = words.join('').toLowerCase().replace(/[^a-z0-9]/g, '')
  const hyphen = words.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const first  = words[0].toLowerCase().replace(/[^a-z0-9]/g, '')

  // NOT the first word alone.
  //
  // "Academy Sports" -> "academy" and "Air Products" -> "air" both return 200, because
  // some OTHER company owns those boards. A first run added abacus, abc, academy, ag,
  // air, apex and aqr — every one a real board belonging to a company nobody asked for.
  // Feeding those to the pipeline pulls in jobs from businesses that were never on the
  // list, which is worse than having fewer jobs.
  const out = []
  for (const v of [joined, hyphen]) {
    if (!v || v.length < 2 || v.length > 40) continue
    if (NOT_SLUGS.has(v)) continue
    if (!out.includes(v)) out.push(v)
  }
  // A single-word name produces the same string three times; only the first survives.
  return out
}

/** Loose comparison — punctuation, spacing and legal suffixes stripped. */
function normalise(s) {
  return String(s || '').toLowerCase().replace(SUFFIXES, '').replace(/[^a-z0-9]/g, '')
}

/**
 * A board exists AND belongs to the company we guessed from.
 *
 * The existence check alone is not enough. Greenhouse returns 200 for any board that
 * exists, no matter whose it is, so a guess like "air" succeeds while pointing at a
 * completely unrelated business. The board endpoint also returns the company's own
 * name, so that gets compared before the slug is accepted.
 *
 * The comparison is deliberately loose in one direction only: "Stripe" matching a board
 * called "Stripe, Inc." is the same company, while "Air" matching "Airtable" is not.
 */
async function checkSlug(slug, sourceName) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 429) return { ok: false, why: 'throttled' }
    if (res.status === 404) return { ok: false, why: 'dead' }
    if (!res.ok) return { ok: false, why: 'error' }

    const data = await res.json()
    const boardName = data?.name || ''
    const a = normalise(boardName)
    const b = normalise(sourceName)
    if (!a || !b) return { ok: false, why: 'dead' }

    // One must contain the other, and the shorter must be at least 4 characters —
    // below that, containment is coincidence rather than a match.
    const shorter = a.length < b.length ? a : b
    const longer  = a.length < b.length ? b : a
    const match = shorter.length >= 4 && longer.includes(shorter)

    return match
      ? { ok: true, boardName }
      : { ok: false, why: 'mismatch', boardName }
  } catch {
    // A timeout is not a 404. Reported separately so a bad network run is not mistaken
    // for "these companies do not exist" and permanently written off.
    return { ok: false, why: 'error' }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const file = process.argv[2]
  const limitArg = process.argv.indexOf('--limit')
  const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

  if (!file) {
    console.error('Usage: node guessSlugs.mjs <company-names.txt> [--limit N]')
    console.error('       one company name per line')
    process.exit(1)
  }
  if (!fs.existsSync(file)) { console.error(`❌ Not found: ${file}`); process.exit(1) }
  if (!fs.existsSync(SLUGS_PATH)) { console.error(`❌ Not found: ${SLUGS_PATH}`); process.exit(1) }

  const existing = JSON.parse(fs.readFileSync(SLUGS_PATH, 'utf-8'))
  const known = new Set(existing.map(s => s.toLowerCase()))
  console.log(`📋 Current list: ${existing.length} slugs`)

  // Slugs tried on a previous run and found dead. Re-checking them every time would
  // waste most of the run once this has been used a few times.
  const seen = new Set(fs.existsSync(SEEN_PATH)
    ? JSON.parse(fs.readFileSync(SEEN_PATH, 'utf-8'))
    : [])
  if (seen.size) console.log(`🧠 Already ruled out on earlier runs: ${seen.size}`)

  const names = fs.readFileSync(file, 'utf-8')
    .split('\n').map(l => l.trim()).filter(Boolean)
  console.log(`📄 Names in file: ${names.length}`)

  const candidates = []
  const seenCandidate = new Set()
  for (const n of names) {
    for (const v of slugVariants(n)) {
      if (known.has(v) || seen.has(v) || seenCandidate.has(v)) continue
      seenCandidate.add(v)
      candidates.push({ slug: v, name: n })     // the name travels with the guess
      if (candidates.length >= LIMIT) break
    }
    if (candidates.length >= LIMIT) break
  }

  console.log(`🎯 Slug guesses to check: ${candidates.length}`)
  if (!candidates.length) { console.log('\n✅ Nothing new to try.'); return }

  const est = Math.round((candidates.length / BATCH_SIZE) * (PAUSE_MS + 400) / 1000 / 60)
  console.log(`⏱️  Rough estimate: ${est} min\n`)

  const live = []
  const dead = []
  const rejected = []
  let errors = 0, throttled = 0

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(async c => ({ c, r: await checkSlug(c.slug, c.name) })))

    for (const { c, r } of results) {
      if (r.ok) live.push({ slug: c.slug, name: c.name, board: r.boardName })
      else if (r.why === 'throttled') throttled++
      else if (r.why === 'error') errors++
      else if (r.why === 'mismatch') {
        // The board exists but belongs to someone else. Never try this guess again.
        rejected.push({ slug: c.slug, wanted: c.name, actual: r.boardName })
        dead.push(c.slug)
      }
      else dead.push(c.slug)            // a real 404, safe to never try again
    }

    // Back off hard rather than hammering through a rate limit.
    if (throttled > 0 && throttled % 10 === 0) {
      console.log('   ⏸️  Rate limited — pausing 30s')
      await sleep(30000)
    } else {
      await sleep(PAUSE_MS)
    }

    const done = Math.min(i + BATCH_SIZE, candidates.length)
    if (done % 500 === 0 || done === candidates.length) {
      const pct = ((live.length / done) * 100).toFixed(1)
      console.log(`   ${done}/${candidates.length}  ·  matched ${live.length} (${pct}%)  ·  wrong company ${rejected.length}  ·  errors ${errors}`)
    }
  }

  const liveSlugs = live.map(l => l.slug)
  const merged = [...new Set([...existing, ...liveSlugs])].sort()
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2))
  fs.writeFileSync(NEW_PATH, JSON.stringify(liveSlugs.sort(), null, 2))
  // Only confirmed 404s are remembered. Timeouts stay eligible for a future run.
  fs.writeFileSync(SEEN_PATH, JSON.stringify([...seen, ...dead].sort(), null, 2))

  console.log('\n' + '─'.repeat(58))
  console.log(`   Guesses checked: ${candidates.length}`)
  console.log(`   Matched:         ${live.length}`)
  console.log(`   Hit rate:        ${((live.length / candidates.length) * 100).toFixed(1)}%`)
  console.log(`   Wrong company:   ${rejected.length}  (board exists, different business — rejected)`)
  console.log(`   Network errors:  ${errors}  (retryable, not written off)`)
  console.log(`   Before:          ${existing.length}`)
  console.log(`   After:           ${merged.length}`)
  console.log(`   Expected jobs:   ~${live.length * 4} more on the board`)
  console.log('─'.repeat(58))

  if (live.length) {
    console.log('\nNew companies found (slug — the name Greenhouse reports):')
    for (const l of live.slice(0, 30)) console.log(`   ${l.slug.padEnd(28)} ${l.board}`)
    if (live.length > 30) console.log(`   … and ${live.length - 30} more`)
  }
  if (rejected.length) {
    console.log('\nRejected — the board exists but is a different company:')
    for (const r of rejected.slice(0, 10)) console.log(`   ${r.slug.padEnd(20)} wanted "${r.wanted}"  got "${r.actual}"`)
    if (rejected.length > 10) console.log(`   … and ${rejected.length - 10} more`)
  }

  console.log(`\n✅ Wrote ${path.basename(OUTPUT_PATH)}`)
  console.log(`✅ Wrote ${path.basename(NEW_PATH)}  (just the additions)`)
  console.log('\nNothing was overwritten. To use the merged list:')
  console.log('   1. Check the numbers above look sane')
  console.log('   2. ren greenhouse_companies.json greenhouse_companies.prev.json')
  console.log('   3. ren greenhouse_companies.merged.json greenhouse_companies.json')
}

main().catch(e => { console.error('❌ Failed:', e); process.exit(1) })
