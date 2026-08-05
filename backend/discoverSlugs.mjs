// ── DISCOVER NEW GREENHOUSE SLUGS ───────────────────────────────────────────
//
// THE PROBLEM THIS SOLVES
// greenhouse_companies.json is static. Companies close their boards or change
// their slug and drop off — 2,963 of the original 8,333 were already dead. Nothing
// ever puts NEW companies on, so the board shrinks permanently over time.
//
// HOW IT WORKS
// Greenhouse publishes no "list all boards" endpoint, so slugs cannot be looked up.
// But they appear in the wild: every Greenhouse application link contains one.
//     https://job-boards.greenhouse.io/COMPANY/jobs/12345
//                                      ^^^^^^^ the slug
// Several community repos track new-grad and internship jobs and are updated daily,
// with thousands of those links inside. This reads them and pulls the slugs out.
//
// That is why this beats guessing company names: these are real links people have
// applied through, not candidates invented from a name.
//
// It is also self-refreshing. Those repos add companies as they start hiring, so
// running this on a schedule keeps finding new ones without any maintenance here.
//
// SAFETY
//   • Never overwrites greenhouse_companies.json. Writes a separate file.
//   • Every candidate is checked against the real Greenhouse API. Only a 200 is
//     added — the regex also catches junk (tracking hashes, "embed"), and the API
//     check is what filters it out.
//   • Slugs already in the list are skipped, so nothing is re-tested or duplicated.
//   • Touches no database.
//
// RUN:  node discoverSlugs.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SLUGS_PATH  = path.join(__dirname, 'greenhouse_companies.json')
const OUTPUT_PATH = path.join(__dirname, 'greenhouse_companies.merged.json')
const NEW_PATH    = path.join(__dirname, 'new_slugs.json')

// Community job-listing repos, read raw from GitHub. Add more here as you find them
// — anything containing Greenhouse apply links works, README or JSON alike.
const SOURCES = [
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
  'https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/.github/scripts/listings.json',
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/README.md',
  'https://raw.githubusercontent.com/ambicuity/New-Grad-Jobs/main/README.md',
]

// Matches both current and legacy Greenhouse URL shapes, including the old embed
// form where the slug sits in a query parameter.
const SLUG_RE = /greenhouse\.io\/(?:embed\/job_board\?for=)?([a-zA-Z0-9_-]+)/g

// Words that appear in the URL position but are not companies.
const NOT_SLUGS = new Set(['embed', 'job_board', 'jobs', 'v1', 'boards', 'api'])

const BATCH_SIZE = 10
const TIMEOUT_MS = 10000

async function isLive(slug) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res.status === 200
  } catch {
    return false
  }
}

async function main() {
  if (!fs.existsSync(SLUGS_PATH)) {
    console.error(`❌ Could not find ${SLUGS_PATH}`)
    process.exit(1)
  }

  const existing = JSON.parse(fs.readFileSync(SLUGS_PATH, 'utf-8'))
  const known = new Set(existing)
  console.log(`📋 Current list: ${existing.length} slugs\n`)

  // ── Collect candidates ────────────────────────────────────────────────────
  const found = new Set()
  for (const url of SOURCES) {
    const short = url.split('/').slice(3, 5).join('/')
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
      if (!res.ok) { console.log(`   ⚠️  ${short} — HTTP ${res.status}, skipped`); continue }
      const text = await res.text()
      let n = 0
      for (const m of text.matchAll(SLUG_RE)) {
        const slug = m[1]
        if (NOT_SLUGS.has(slug.toLowerCase())) continue
        if (!found.has(slug)) { found.add(slug); n++ }
      }
      console.log(`   ✅ ${short} — ${n} new to this scan`)
    } catch (e) {
      console.log(`   ⚠️  ${short} — ${e.name}, skipped`)
    }
  }

  const candidates = [...found].filter(s => !known.has(s))
  console.log(`\n   Found in sources:   ${found.size}`)
  console.log(`   Already on the list: ${found.size - candidates.length}`)
  console.log(`   To verify:          ${candidates.length}`)

  if (candidates.length === 0) {
    console.log('\n✅ Nothing new. The list is current.')
    return
  }

  // ── Verify against the real API ───────────────────────────────────────────
  console.log(`\n🔍 Checking ${candidates.length} candidates against Greenhouse...`)
  const live = []
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(async s => ({ s, ok: await isLive(s) })))
    live.push(...results.filter(r => r.ok).map(r => r.s))
    const done = Math.min(i + BATCH_SIZE, candidates.length)
    if (done % 50 === 0 || done === candidates.length) {
      console.log(`   ${done}/${candidates.length}  ·  live ${live.length}`)
    }
  }

  const merged = [...existing, ...live].sort()
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2))
  fs.writeFileSync(NEW_PATH, JSON.stringify(live.sort(), null, 2))

  console.log('\n' + '─'.repeat(58))
  console.log(`   Before:      ${existing.length}`)
  console.log(`   Verified new: ${live.length}`)
  console.log(`   After:       ${merged.length}`)
  console.log('─'.repeat(58))

  if (live.length) {
    console.log('\nNew companies found:')
    console.log('  ' + live.slice(0, 40).join(', ') + (live.length > 40 ? ` … and ${live.length - 40} more` : ''))
  }

  console.log(`\n✅ Wrote ${OUTPUT_PATH}`)
  console.log(`✅ Wrote ${NEW_PATH}  (just the additions)`)
  console.log('\nNothing was overwritten. To use the merged list:')
  console.log('   1. Check the numbers above look sane')
  console.log('   2. ren greenhouse_companies.json greenhouse_companies.prev.json')
  console.log('   3. ren greenhouse_companies.merged.json greenhouse_companies.json')
}

main().catch(e => { console.error('❌ Failed:', e); process.exit(1) })
