// probeAshby.mjs — look at what Ashby actually returns before writing anything against it.
//
// WHY THIS EXISTS
// The Greenhouse fetcher was built against Greenhouse's real response shape. Writing an
// Ashby fetcher from memory or from documentation would mean guessing at field names,
// and the filter that keeps this product honest reads job DESCRIPTIONS — so the exact
// shape of the description field decides whether 95 patterns work or silently do not.
//
// This prints the structure of a few real boards. Nothing is saved and nothing in the
// pipeline is touched.
//
//   node probeAshby.mjs
//   node probeAshby.mjs baseten          look at one specific board

const SAMPLES = ['baseten', 'pylon', 'shiftsmart', 'solace', '1password']

function shape(v, depth = 0) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return v.length ? `array[${v.length}] of ${shape(v[0], depth + 1)}` : 'array[0]'
  if (typeof v === 'object') return depth > 1 ? 'object' : '{ ' + Object.keys(v).join(', ') + ' }'
  if (typeof v === 'string') return `string(${v.length})`
  return typeof v
}

async function probe(board) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`
  console.log('\n' + '═'.repeat(70))
  console.log(`BOARD: ${board}`)
  console.log(url)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    console.log(`HTTP ${res.status}`)
    if (!res.ok) return

    const data = await res.json()
    console.log('top-level keys:', Object.keys(data).join(', '))

    const jobs = data.jobs || data.postings || []
    console.log(`jobs returned: ${jobs.length}`)
    if (!jobs.length) return

    const j = jobs[0]
    console.log('\n--- FIELDS ON ONE JOB ---')
    for (const [k, v] of Object.entries(j)) console.log(`  ${k.padEnd(24)} ${shape(v)}`)

    // The description is the whole game: the visa filter reads it, and if it arrives as
    // HTML it has to be stripped before 95 regexes will match anything.
    console.log('\n--- DESCRIPTION FIELDS ---')
    for (const key of Object.keys(j)) {
      if (!/desc|content|body/i.test(key)) continue
      const val = String(j[key] ?? '')
      const looksHtml = /<[a-z][\s\S]*>/i.test(val)
      console.log(`  ${key}: ${val.length} chars · ${looksHtml ? 'HTML' : 'plain text'}`)
      console.log(`     first 220: ${val.slice(0, 220).replace(/\s+/g, ' ')}`)
    }

    console.log('\n--- WHAT THE PIPELINE NEEDS ---')
    console.log(`  title      ${j.title ?? '(missing)'}`)
    console.log(`  location   ${j.location ?? j.locationName ?? '(missing)'}`)
    console.log(`  remote     ${j.isRemote ?? '(missing)'}`)
    console.log(`  published  ${j.publishedAt ?? j.updatedAt ?? '(missing)'}`)
    console.log(`  applyUrl   ${(j.applyUrl || j.jobUrl || '(missing)').slice(0, 70)}`)
    console.log(`  id         ${j.id ?? '(missing)'}`)
    console.log(`  listed     ${j.isListed ?? '(missing)'}`)

    // Does anything on this board even mention sponsorship? If a whole ATS phrases it
    // differently, that is what the filter has to be re-tuned against.
    const hits = jobs.filter(x => {
      const t = JSON.stringify(x).toLowerCase()
      return t.includes('sponsor') || t.includes('work authorization')
    })
    console.log(`\n  jobs mentioning sponsorship / work authorization: ${hits.length} of ${jobs.length}`)
    if (hits.length) {
      const t = JSON.stringify(hits[0]).toLowerCase()
      const i = t.indexOf('sponsor') > -1 ? t.indexOf('sponsor') : t.indexOf('work authorization')
      console.log(`  sample: …${t.slice(Math.max(0, i - 120), i + 160).replace(/\\[a-z]/g, ' ')}…`)
    }
  } catch (e) {
    console.log(`FAILED: ${e.name} — ${e.message}`)
  }
}

const arg = process.argv[2]
const list = arg ? [arg] : SAMPLES
for (const b of list) await probe(b)
console.log('\n' + '═'.repeat(70))
console.log('Paste this output back. The fetcher gets written against what is above,')
console.log('not against what the docs claim.')
