// Validate candidate companies LIVE against the exact endpoints the pipeline
// uses. A candidate survives only if the ATS answers 200 with valid JSON AND
// at least one job. Empty boards and 404s are rejected; network errors are
// retried once, then marked 'error' (NOT rejected — rerun picks them up).
//
// Run from C:\Users\Mantr\ats-sources:
//     node validateCandidates.mjs            all three ATS
//     node validateCandidates.mjs sr         one ATS only (gh | sr | ashby)
//
// RESUMABLE: progress saved to .validate_progress.json after every batch.
// Stop it any time; rerunning skips everything already decided.
// Outputs: validated_gh.txt / validated_sr.txt / validated_ashby.txt

import fs from 'fs'

const ONLY = (process.argv[2] || '').toLowerCase()

// Exact pipeline endpoints (from FetchJobs.mjs / fetchSR.mjs / fetchAshby.mjs).
// The "has jobs" check mirrors each fetcher's own reading of the response.
const ATS = {
  gh: {
    file: 'candidates_gh.txt', out: 'validated_gh.txt',
    url: s => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs`,
    hasJobs: d => Array.isArray(d?.jobs) && d.jobs.length > 0,
  },
  sr: {
    file: 'candidates_sr.txt', out: 'validated_sr.txt',
    url: s => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(s)}/postings?limit=1&offset=0`,
    hasJobs: d => (Array.isArray(d?.content) && d.content.length > 0) || (d?.totalFound ?? 0) > 0,
  },
  ashby: {
    file: 'candidates_ashby.txt', out: 'validated_ashby.txt',
    url: s => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}`,
    hasJobs: d => Array.isArray(d?.jobs) && d.jobs.length > 0,
  },
}

const PROGRESS = '.validate_progress.json'
const CONCURRENCY = 3          // parallel requests per ATS batch
const DELAY_MS = 350           // pause between batches ≈ 3 req/sec
const TIMEOUT_MS = 12000

// progress: { "gh:slug": "ok" | "no" | "error" }
const progress = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : {}
const saveProgress = () => fs.writeFileSync(PROGRESS, JSON.stringify(progress))

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function check(kind, slug) {
  const key = `${kind}:${slug.toLowerCase()}`
  if (progress[key] === 'ok' || progress[key] === 'no') return   // decided already
  const { url, hasJobs } = ATS[kind]
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      const res = await fetch(url(slug), { signal: ctrl.signal, headers: { accept: 'application/json' } })
      clearTimeout(t)
      if (res.status === 404) { progress[key] = 'no'; return }
      if (res.status === 429) { await sleep(5000); continue }     // backoff, retry
      if (!res.ok) { if (attempt === 2) progress[key] = 'error'; continue }
      const data = await res.json().catch(() => null)
      if (data === null) { progress[key] = 'no'; return }         // 200 but not JSON: wrong shape
      progress[key] = hasJobs(data) ? 'ok' : 'no'
      return
    } catch {
      if (attempt === 2) progress[key] = 'error'                  // network/timeout: retry on rerun
      else await sleep(1000)
    }
  }
}

async function run(kind) {
  const { file, out } = ATS[kind]
  if (!fs.existsSync(file)) { console.log(`(no ${file}, skipping ${kind})`); return }
  const slugs = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const pending = slugs.filter(s => {
    const st = progress[`${kind}:${s.toLowerCase()}`]
    return st !== 'ok' && st !== 'no'                             // 'error' and unseen both run
  })
  console.log(`\n${kind.toUpperCase()}: ${slugs.length} candidates, ${pending.length} to check`)

  let done = 0
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(pending.slice(i, i + CONCURRENCY).map(s => check(kind, s)))
    done += Math.min(CONCURRENCY, pending.length - i)
    if (done % 60 < CONCURRENCY) {
      const ok = slugs.filter(s => progress[`${kind}:${s.toLowerCase()}`] === 'ok').length
      console.log(`   ${done}/${pending.length} checked · ${ok} valid so far`)
      saveProgress()
    }
    await sleep(DELAY_MS)
  }
  saveProgress()

  const okList  = slugs.filter(s => progress[`${kind}:${s.toLowerCase()}`] === 'ok')
  const noCount = slugs.filter(s => progress[`${kind}:${s.toLowerCase()}`] === 'no').length
  const errCount = slugs.filter(s => progress[`${kind}:${s.toLowerCase()}`] === 'error').length
  fs.writeFileSync(out, okList.join('\n') + (okList.length ? '\n' : ''))
  console.log(`${kind.toUpperCase()} DONE: ${okList.length} valid (with jobs) · ${noCount} rejected · ${errCount} errors (rerun to retry) → ${out}`)
}

const kinds = ONLY && ATS[ONLY] ? [ONLY] : ['gh', 'sr', 'ashby']
for (const k of kinds) await run(k)
console.log('\nAll done. Rerun the same command to retry any errors.')
