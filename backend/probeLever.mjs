// probeLever.mjs — what does Lever actually return?
//
// Written before any fetcher, for the same reason the Ashby and SmartRecruiters probes
// were. The filter reads job DESCRIPTIONS, so the two things that decide the whole build
// are whether descriptions arrive with the job list, and what shape the text is in.
//
// Ashby: descriptions included, one request per board, four minutes for 585 boards.
// SmartRecruiters: NOT included — one request per surviving job, ~15,000 per run.
//
// Which of those Lever resembles decides whether this is a day or a different kind of
// pipeline. Guessing from documentation is how field names end up wrong.
//
// Prints structure. Writes nothing.
//
//   node probeLever.mjs
//   node probeLever.mjs veeva

const SAMPLES = ['veeva', 'sensortower', 'xsolla', 'certik', 'belvederetrading']

function shape(v, d = 0) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return v.length ? `array[${v.length}] of ${shape(v[0], d + 1)}` : 'array[0]'
  if (typeof v === 'object') return d > 1 ? 'object' : '{ ' + Object.keys(v).join(', ') + ' }'
  if (typeof v === 'string') return `string(${v.length})`
  return typeof v
}

async function probe(company) {
  console.log('\n' + '═'.repeat(70))
  console.log(`COMPANY: ${company}`)
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`
  console.log(url)

  try {
    const t0 = Date.now()
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const ms = Date.now() - t0
    console.log(`HTTP ${res.status}  ·  ${ms}ms`)
    if (!res.ok) return

    const data = await res.json()
    const jobs = Array.isArray(data) ? data : (data.data || [])
    console.log(`postings returned: ${jobs.length}`)
    if (!jobs.length) return

    const j = jobs[0]
    console.log('\n--- FIELDS ON ONE POSTING ---')
    for (const [k, v] of Object.entries(j)) console.log(`  ${k.padEnd(22)} ${shape(v)}`)

    // The question the whole build hangs on.
    console.log('\n--- IS THE DESCRIPTION IN THE LIST? ---')
    const descKeys = Object.keys(j).filter(k => /desc|content|body|list/i.test(k))
    if (!descKeys.length) {
      console.log('  NO — a second request per job would be needed.')
    } else {
      for (const k of descKeys) {
        const val = typeof j[k] === 'string' ? j[k] : JSON.stringify(j[k])
        const html = /<[a-z][\s\S]*>/i.test(val)
        console.log(`  ${k}: ${val.length} chars · ${html ? 'HTML' : 'plain'}`)
        console.log(`     ${val.slice(0, 180).replace(/\s+/g, ' ')}`)
      }
      // Lever splits the body into `lists` — requirements, benefits and so on. If the
      // sponsorship sentences live there rather than in `description`, reading only the
      // obvious field would miss exactly what this product exists to catch.
      if (Array.isArray(j.lists)) {
        console.log(`\n  lists: ${j.lists.length} sections`)
        for (const l of j.lists.slice(0, 4)) {
          console.log(`     "${l.text}" — ${String(l.content || '').length} chars`)
        }
      }
    }

    console.log('\n--- WHAT THE PIPELINE NEEDS ---')
    const c = j.categories || {}
    console.log(`  id         ${j.id ?? '(missing)'}`)
    console.log(`  title      ${j.text ?? '(missing)'}`)
    console.log(`  location   ${c.location ?? '(missing)'}`)
    console.log(`  commitment ${c.commitment ?? '(missing)'}`)
    console.log(`  workplace  ${j.workplaceType ?? '(missing)'}`)
    console.log(`  country    ${j.country ?? '(missing)'}`)
    console.log(`  posted     ${j.createdAt ? new Date(j.createdAt).toISOString() : '(missing)'}`)
    console.log(`  applyUrl   ${(j.applyUrl || j.hostedUrl || '(missing)').slice(0, 70)}`)

    // Age distribution decides how much of this source actually reaches a 30-day board.
    // On Ashby that gate alone removed 64%.
    const now = Date.now()
    const buckets = { '0-30d': 0, '31-90d': 0, 'over 90d': 0, 'no date': 0 }
    for (const x of jobs) {
      if (!x.createdAt) { buckets['no date']++; continue }
      const days = (now - x.createdAt) / 86400000
      if (days <= 30) buckets['0-30d']++
      else if (days <= 90) buckets['31-90d']++
      else buckets['over 90d']++
    }
    console.log('\n  age spread:', Object.entries(buckets).map(([k, v]) => `${k}=${v}`).join('  '))

    const hits = jobs.filter(x => /sponsor|work authoriz|security clearance|u\.?s\.? citizen|export control/i.test(JSON.stringify(x)))
    console.log(`  mention status restrictions: ${hits.length} of ${jobs.length}`)
  } catch (e) {
    console.log(`FAILED: ${e.name} — ${e.message}`)
  }
}

const arg = process.argv[2]
for (const c of (arg ? [arg] : SAMPLES)) await probe(c)
console.log('\n' + '═'.repeat(70))
console.log('The number that matters: descriptions with the list, or one call per job?')
