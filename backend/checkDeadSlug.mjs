// ── ARE THE DEAD SLUGS REALLY DEAD? ─────────────────────────────────────────
//
// The pipeline calls ONE endpoint:
//     https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
//
// A 404 there is being treated as "this company is gone". That may be wrong.
// Greenhouse has changed its board URLs over the years, and a company that moved
// to a newer one would 404 on the old API while still hiring. 2,973 companies is
// 36% of the list — far too many to write off without checking.
//
// This tries each slug against every Greenhouse URL pattern. If a slug 404s on the
// pipeline's endpoint but answers on another, those companies are RECOVERABLE and
// pruning them would be a mistake.
//
// RUN:  node checkDeadSlug.mjs slug1 slug2 slug3
//
// Get slugs from a pipeline log: find the line
//   📋 CONFIRMED DEAD SLUGS (safe to remove from greenhouse_companies.json):
// and copy any handful from the array that follows.
//
// Read-only. No database, no files written.

const ENDPOINTS = [
  { name: 'pipeline (boards-api v1)', url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true` },
  { name: 'boards-api, no content',   url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs` },
  { name: 'embed job_board',          url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/embed/jobs` },
  { name: 'job-boards.greenhouse.io', url: s => `https://job-boards.greenhouse.io/${s}` },
  { name: 'boards.greenhouse.io',     url: s => `https://boards.greenhouse.io/${s}` },
]

async function hit(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    return { status: res.status, finalUrl: res.url }
  } catch (e) {
    return { status: 0, finalUrl: '', err: e.name }
  }
}

async function main() {
  const slugs = process.argv.slice(2)
  if (slugs.length === 0) {
    console.log('Usage: node checkDeadSlug.mjs slug1 slug2 slug3')
    console.log('\nGrab slugs from the "CONFIRMED DEAD SLUGS" line in a pipeline log.')
    process.exit(1)
  }

  console.log(`Testing ${slugs.length} slug(s) against ${ENDPOINTS.length} endpoints.\n`)

  let recoverable = 0

  for (const slug of slugs) {
    console.log(`\n══ ${slug} ${'═'.repeat(Math.max(0, 50 - slug.length))}`)
    let pipelineStatus = null
    let aliveElsewhere = false

    for (const ep of ENDPOINTS) {
      const { status, finalUrl, err } = await hit(ep.url(slug))
      if (ep.name.startsWith('pipeline')) pipelineStatus = status

      const mark = status === 200 ? '✅' : status === 404 ? '❌' : status === 0 ? '⏱️ ' : '⚠️ '
      const shown = status === 0 ? `no answer (${err})` : status
      console.log(`  ${mark} ${ep.name.padEnd(28)} ${shown}`)

      // A redirect landing somewhere different is a strong hint the board moved.
      if (status === 200 && finalUrl && !finalUrl.includes(slug)) {
        console.log(`       ↳ redirected to: ${finalUrl}`)
      }
      if (status === 200 && !ep.name.startsWith('pipeline')) aliveElsewhere = true
    }

    if (pipelineStatus === 404 && aliveElsewhere) {
      recoverable++
      console.log('  👉 RECOVERABLE — dead on the pipeline endpoint, alive elsewhere.')
    } else if (pipelineStatus === 404) {
      console.log('  👉 Genuinely gone. Nothing answered.')
    } else if (pipelineStatus === 200) {
      console.log('  👉 Alive on the pipeline endpoint — this one is NOT dead.')
    }
  }

  console.log('\n' + '─'.repeat(58))
  if (recoverable > 0) {
    console.log(`⚠️  ${recoverable} of ${slugs.length} answered on a DIFFERENT endpoint.`)
    console.log('   Do NOT prune. The pipeline is asking the wrong URL for these.')
  } else {
    console.log(`✅ None of the ${slugs.length} answered anywhere. Pruning is safe.`)
  }
  console.log('─'.repeat(58))
}

main().catch(e => { console.error('Failed:', e); process.exit(1) })
