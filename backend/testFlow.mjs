// testFlow.mjs — exercises the real modal path against the LOCAL backend.
//   1. /analyze  → what does this job want, what do we already have
//   2. /optimize → rewrite with the skills the student ticked
// Run from the backend folder:  node testFlow.mjs

const RESUME = `ARAVIND MANTRI
Data Engineer
Poughkeepsie, NY | mantriaravind10@gmail.com

SUMMARY
Data engineer with experience building ETL pipelines in Python and SQL.

EXPERIENCE

Data Engineer, Acme Analytics (2023 - present)
- Built ETL pipelines in Python that move sales data into our warehouse each night.
- Wrote SQL queries to clean and join customer records from three source systems.
- Set up Airflow DAGs to schedule the nightly loads and alert on failures.
- Reduced pipeline runtime from 4 hours to 90 minutes by rewriting the join logic.

Data Analyst Intern, Beta Corp (2022)
- Made dashboards in Tableau for the marketing team.
- Cleaned survey data using pandas.

SKILLS
Python, SQL, Airflow, pandas, Tableau, Git

EDUCATION
M.S. Data Science, Pace University, 2023`

const JOB = `Data Scientist - Risk Platform
Stripe | Seattle, WA

We are looking for a Data Scientist to join our Risk team.

What you'll do:
- Build and maintain large-scale data pipelines using PySpark
- Work in Databricks to develop and productionize models
- Manage table versioning and reliability with Delta Lake
- Write production Python and SQL
- Own Airflow orchestration for critical risk jobs

What we're looking for:
- Strong Python and SQL fundamentals
- Hands-on PySpark experience at scale
- Experience with Databricks and Delta Lake
- Familiarity with ETL patterns and Airflow`

const B = 'http://localhost:3001'

// ── 1 · ANALYZE ────────────────────────────────────────────────
console.log('1/2  POST /analyze  (should be fast)\n')
const t0 = Date.now()
const aRes = await fetch(`${B}/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeText: RESUME, jobText: JOB }),
})
if (!aRes.ok) {
  console.log('FAILED —', aRes.status, await aRes.text())
  process.exit(1)
}
const a = await aRes.json()
const aSec = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`took ${aSec}s`)
console.log('score:   ', a.scoreBefore)
console.log('matched: ', a.matchedKeywords)
console.log('missing: ', a.missingKeywords)
console.log('\n→ This is what the modal shows. The student ticks the missing ones.\n')
console.log('─'.repeat(64))

// ── 2 · OPTIMIZE, with all gaps ticked ─────────────────────────
const CONFIRMED = a.missingKeywords
console.log(`\n2/2  POST /optimize  — student ticked all ${CONFIRMED.length}: ${CONFIRMED.join(', ')}\n`)

const t1 = Date.now()
const oRes = await fetch(`${B}/optimize`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeText: RESUME, jobText: JOB, confirmedSkills: CONFIRMED }),
})
if (!oRes.ok) {
  console.log('FAILED —', oRes.status, await oRes.text())
  process.exit(1)
}
const d = await oRes.json()
const oSec = ((Date.now() - t1) / 1000).toFixed(1)
const out = d.optimizedResume || ''

console.log(`took ${oSec}s`)
console.log(`score:   ${d.scoreBefore} → ${d.scoreAfter}   (+${d.scoreAfter - d.scoreBefore})`)
console.log('added:  ', d.addedKeywords)

// ── did the skills actually land? ──────────────────────────────
console.log('\n=== DID THE SKILLS LAND IN THE TEXT? ===')
for (const k of CONFIRMED) {
  const n = (out.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
  console.log(`${n > 0 ? 'YES ' : 'NO  '} ${k}  — appears ${n}×`)
}
console.log('If any say NO, the score is claiming something the resume does not say.')

// ── the fabrication scan ───────────────────────────────────────
// Any number in the output that was not in the input is a metric nobody gave us.
console.log('\n=== FABRICATED METRICS SCAN ===')
const nums = t => new Set((t.match(/\b\d+(?:\.\d+)?\s*(?:TB|GB|PB|MB|k|K|M|%|x|×)?\b/g) || []).map(s => s.trim()))
const before = nums(RESUME)
const after = nums(out)
const invented = [...after].filter(n => !before.has(n))
if (invented.length) {
  console.log(`INVENTED NUMBERS: ${invented.join(', ')}`)
  console.log('These are figures the candidate never stated and cannot defend in an interview.')
} else {
  console.log('clean — every number in the output was already in the original resume')
}

// ── voice ──────────────────────────────────────────────────────
console.log('\n=== AI-TELL SCAN ===')
const banned = ['spearhead', 'leverag', 'synerg', 'robust', 'seamless', 'cutting-edge', 'innovative', 'passionate', 'dynamic', 'results-driven', 'proven track record', 'myriad', 'delve', 'tapestry', '—']
const hits = banned.filter(w => out.toLowerCase().includes(w.toLowerCase()))
console.log(hits.length ? `FOUND: ${hits.join(', ')}` : 'clean — no banned words')

console.log('\n=== RESPONSIBILITY INFLATION — check by eye ===')
console.log('Original said "Set up Airflow DAGs". If the output says "Owned" or "Led" or "Drove",')
console.log('rule 2 is not holding.')

console.log('\n' + '─'.repeat(64))
console.log('\n=== READ THIS AS IF YOU WERE SCREENING RESUMES ===')
console.log('Would you interview this person? Does it sound like a human wrote it?\n')
console.log(out)
console.log('\n' + '─'.repeat(64))
console.log('\n=== FEEDBACK SHOWN TO STUDENT ===')
console.log(d.feedback)
console.log(`\nTiming: analyze ${aSec}s + optimize ${oSec}s`)
