// probeSR.mjs — what does SmartRecruiters actually return, and at what cost?
//
// THE QUESTION THAT DECIDES THIS
// Ashby hands back every posting WITH its full description in one request per board.
// 585 boards, one call each, four minutes.
//
// SmartRecruiters is believed to split it: a list endpoint that returns postings without
// description text, and a second endpoint per posting for the detail. If that is true,
// the filter — which reads descriptions — needs ONE CALL PER JOB. At a few thousand jobs
// that is a different kind of pipeline, and it has to be known before anything is built.
//
// Prints structure and counts. Writes nothing.
//
//   node probeSR.mjs
//   node probeSR.mjs ServiceNow

const SAMPLES = ['ServiceNow', 'Experian', 'WesternDigital', 'AbbVie', 'Visa']

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

  const listUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=10`
  console.log(listUrl)
  try {
    const res = await fetch(listUrl, { signal: AbortSignal.timeout(15000) })
    console.log(`HTTP ${res.status}`)
    if (!res.ok) return

    const data = await res.json()
    console.log('top-level keys:', Object.keys(data).join(', '))
    console.log(`totalFound: ${data.totalFound}  ·  returned: ${(data.content || []).length}  ·  limit: ${data.limit}`)

    const posting = (data.content || [])[0]
    if (!posting) { console.log('no postings'); return }

    console.log('\n--- FIELDS ON A LIST ITEM ---')
    for (const [k, v] of Object.entries(posting)) console.log(`  ${k.padEnd(22)} ${shape(v)}`)

    // The whole point of the probe.
    const descKeys = Object.keys(posting).filter(k => /desc|content|body|ad\b/i.test(k))
    console.log('\n--- IS THERE A DESCRIPTION IN THE LIST? ---')
    if (!descKeys.length) {
      console.log('  NO. The list carries no description text.')
      console.log('  => the filter would need a second request PER JOB.')
    } else {
      for (const k of descKeys) console.log(`  ${k}: ${shape(posting[k])}`)
    }

    console.log('\n--- WHAT THE PIPELINE NEEDS ---')
    console.log(`  id         ${posting.id ?? '(missing)'}`)
    console.log(`  title      ${posting.name ?? '(missing)'}`)
    const loc = posting.location || {}
    console.log(`  location   ${[loc.city, loc.region, loc.country].filter(Boolean).join(', ') || '(missing)'}  remote=${loc.remote}`)
    console.log(`  posted     ${posting.releasedDate ?? '(missing)'}`)
    console.log(`  type       ${posting.typeOfEmployment?.label ?? '(missing)'}`)
    console.log(`  level      ${posting.experienceLevel?.label ?? '(missing)'}`)

    // Now the detail endpoint — is a second call really required, and what does it cost?
    const detailUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${posting.id}`
    console.log(`\n--- DETAIL CALL ---\n${detailUrl}`)
    const t0 = Date.now()
    const dRes = await fetch(detailUrl, { signal: AbortSignal.timeout(15000) })
    const ms = Date.now() - t0
    console.log(`HTTP ${dRes.status}  ·  ${ms}ms`)
    if (dRes.ok) {
      const d = await dRes.json()
      const ad = d.jobAd?.sections || {}
      console.log('jobAd.sections:', Object.keys(ad).join(', ') || '(none)')
      let total = 0
      for (const [k, v] of Object.entries(ad)) {
        const text = v?.text || ''
        total += text.length
        console.log(`   ${k.padEnd(14)} ${text.length} chars ${/<[a-z]/i.test(text) ? 'HTML' : 'plain'}`)
      }
      console.log(`   TOTAL description: ${total} chars`)
      const blob = JSON.stringify(d).toLowerCase()
      const mentions = /sponsor|work authoriz|security clearance|u\.?s\.? citizen|export control/.test(blob)
      console.log(`   mentions status restrictions: ${mentions}`)

      console.log(`\n   COST: ${data.totalFound} postings x ~${ms}ms = ~${Math.round(data.totalFound * ms / 1000)}s for this company alone`)
    }
  } catch (e) {
    console.log(`FAILED: ${e.name} — ${e.message}`)
  }
}

const arg = process.argv[2]
for (const c of (arg ? [arg] : SAMPLES)) await probe(c)
console.log('\n' + '═'.repeat(70))
console.log('The number that matters: whether descriptions come free with the list,')
console.log('or cost one request per job. Paste this back.')
