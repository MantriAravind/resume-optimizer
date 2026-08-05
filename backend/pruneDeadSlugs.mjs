// ── PRUNE DEAD GREENHOUSE SLUGS ─────────────────────────────────────────────
//
// Every run, ~2,975 of 8,333 companies return 404. Their Greenhouse boards are gone
// — the retry pass recovers 0% of them, which is proof, not a guess. The pipeline
// still asks all of them twice per run, so roughly 6,000 pointless HTTP requests per
// run, four runs a day.
//
// This script checks every slug, twice, and writes a cleaned list.
//
// SAFETY:
//   • Never overwrites greenhouse_companies.json. Writes a new file you move yourself.
//   • Only 404 counts as dead. A timeout means "no answer", which is NOT proof a board
//     is gone — one slow response would otherwise delete a live company forever.
//   • Every candidate is checked a SECOND time before being dropped.
//   • Touches no database. Read-only apart from the new file it writes.
//
// RUN:  node pruneDeadSlugs.mjs
// Takes roughly 10-15 minutes for 8,333 slugs.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SLUGS_PATH  = path.join(__dirname, 'greenhouse_companies.json')
const OUTPUT_PATH = path.join(__dirname, 'greenhouse_companies.pruned.json')
const DEAD_PATH   = path.join(__dirname, 'dead_slugs.json')

const BATCH_SIZE = 10      // same as the pipeline, so results are comparable
const TIMEOUT_MS = 10000

// Returns 200 (alive), 404 (board gone), other codes as-is, or 0 for no answer.
async function checkSlug(slug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res.status
  } catch {
    return 0
  }
}

async function checkAll(slugs, label) {
  const results = []
  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    const batch = slugs.slice(i, i + BATCH_SIZE)
    const statuses = await Promise.all(
      batch.map(async slug => ({ slug, status: await checkSlug(slug) }))
    )
    results.push(...statuses)

    if ((i / BATCH_SIZE) % 20 === 0 || i + BATCH_SIZE >= slugs.length) {
      const done = Math.min(i + BATCH_SIZE, slugs.length)
      const alive = results.filter(r => r.status === 200).length
      const gone  = results.filter(r => r.status === 404).length
      console.log(`   ${label}: ${done}/${slugs.length}  ·  alive ${alive}  ·  404 ${gone}`)
    }
  }
  return results
}

async function main() {
  if (!fs.existsSync(SLUGS_PATH)) {
    console.error(`❌ Could not find ${SLUGS_PATH}`)
    process.exit(1)
  }

  const allSlugs = JSON.parse(fs.readFileSync(SLUGS_PATH, 'utf-8'))
  console.log(`📋 Loaded ${allSlugs.length} slugs\n`)

  console.log('🔍 Pass 1 — checking every slug...')
  const pass1 = await checkAll(allSlugs, 'pass 1')

  const alive       = pass1.filter(r => r.status === 200).map(r => r.slug)
  const suspect404  = pass1.filter(r => r.status === 404).map(r => r.slug)
  const noAnswer    = pass1.filter(r => r.status === 0).map(r => r.slug)
  const otherStatus = pass1.filter(r => ![200, 404, 0].includes(r.status))

  console.log(`\n   Alive:        ${alive.length}`)
  console.log(`   404 (check again): ${suspect404.length}`)
  console.log(`   No answer:    ${noAnswer.length}`)
  if (otherStatus.length) {
    const codes = [...new Set(otherStatus.map(r => r.status))].join(', ')
    console.log(`   Other codes:  ${otherStatus.length}  (${codes})`)
  }

  // Second pass. A single 404 is not enough to delete a company permanently.
  let confirmedDead = []
  let recovered = []
  if (suspect404.length) {
    console.log(`\n🔁 Pass 2 — re-checking the ${suspect404.length} that returned 404...`)
    const pass2 = await checkAll(suspect404, 'pass 2')
    confirmedDead = pass2.filter(r => r.status === 404).map(r => r.slug)
    recovered     = pass2.filter(r => r.status !== 404).map(r => r.slug)
    console.log(`\n   Dead both times: ${confirmedDead.length}`)
    console.log(`   Answered on retry: ${recovered.length}  (kept)`)
  }

  // Anything not proven dead stays. Timeouts, odd status codes and retry-recoveries
  // are all kept: the cost of dropping a live company is permanent, the cost of
  // keeping a dead one is one wasted request per run.
  const deadSet = new Set(confirmedDead)
  const keep = allSlugs.filter(s => !deadSet.has(s))

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(keep, null, 2))
  fs.writeFileSync(DEAD_PATH, JSON.stringify(confirmedDead, null, 2))

  const pct = Math.round((confirmedDead.length / allSlugs.length) * 100)
  console.log('\n' + '─'.repeat(60))
  console.log(`   Before:  ${allSlugs.length} slugs`)
  console.log(`   Removed: ${confirmedDead.length} (${pct}%) — 404 twice`)
  console.log(`   After:   ${keep.length} slugs`)
  console.log('─'.repeat(60))
  console.log(`\n✅ Wrote ${OUTPUT_PATH}`)
  console.log(`✅ Wrote ${DEAD_PATH}  (keep this — proof of what was removed)`)
  console.log('\nNothing was overwritten. To use the cleaned list:')
  console.log('   1. Check the numbers above look sane')
  console.log('   2. Rename greenhouse_companies.json to greenhouse_companies.backup.json')
  console.log('   3. Rename greenhouse_companies.pruned.json to greenhouse_companies.json')
}

main().catch(err => {
  console.error('❌ Failed:', err)
  process.exit(1)
})
