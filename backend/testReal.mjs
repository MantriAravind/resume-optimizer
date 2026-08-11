// testReal.mjs — real posting, same field. Data Engineer resume -> Data Engineer job.
// Run from the backend folder:  node testReal.mjs
//
// TO TEST YOUR OWN RESUME: replace everything between the backticks below.

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
- Wrote documentation for the pipelines so the analysts could trace where numbers came from.

Data Analyst Intern, Beta Corp (2022)
- Made dashboards in Tableau for the marketing team.
- Cleaned survey data using pandas.

SKILLS
Python, SQL, Airflow, pandas, Tableau, Git

EDUCATION
M.S. Data Science, Pace University, 2023`

const JOB = `Data Engineer
Aldridge

What we are looking for:
Aldridge is seeking an experienced and dedicated Data Engineer to join our talented and energetic team. The Data Engineer builds, maintains, and continuously improves the pipelines and dbt projects that move data from our source systems into our cloud data platform, helping ensure clean, reliable data is available to the teams who depend on it.

What you'll do:
- Building, maintaining, and optimizing batch and ELT pipelines that load data into Google BigQuery and Azure SQL Server
- Designing, developing, and testing dbt models - from staging and intermediate models through mart-level transformations
- Owning dbt project structure, macros, testing, and CI/CD deployment
- Writing clean, well-documented SQL transformations and Python scripts and automation to process and prepare data
- Building, maintaining, and optimizing Tableau data sources and dashboards in partnership with the analytics team
- Building and maintaining integrations from ERP, field-operations, and finance source systems
- Implementing data-quality tests, data-freshness checks, and monitoring on owned datasets
- Acting as a point of contact for pipeline failures and data-freshness alerts, and troubleshooting root causes
- Identifying bottlenecks in existing data workflows and implementing automated solutions
- Documenting data sources, pipelines, and dbt models to support team consistency
- Collaborating with analysts, operations teams, and leadership to understand data requirements and present solutions
- Applying and helping establish team standards for data quality, testing, version control, and documentation
- Writing and maintaining recurring operational and departmental reports in Tableau to defined specifications
- Supporting the department's report writers with curated Tableau data sources and report-writing guidance

Who you are:
- Bachelor's degree in Computer Science, Data Engineering, Information Systems, or a related field
- Experience building, supporting, or architecting data pipelines, preferably in the construction industry
- Proficiency in SQL and Python, with experience using dbt for transformation and pipeline management
- Experience building, optimizing, and mentoring others on Tableau data sources, dashboards, and reports
- Hands-on experience with Google BigQuery and/or Azure SQL Server
- Experience designing, maintaining, and optimizing ELT/ETL pipelines and data models
- Strong attention to detail and accuracy in deliverables
- Strong problem-solving skills and the ability to manage data initiatives independently
- Good communication and relationship-building skills
- Strong organizational and time-management skills
- Strong Tableau report-writing skills`

const B = 'http://localhost:3001'

console.log('Data Engineer resume  ->  Data Engineer posting  (same field, real job)\n')

// ── 1 · ANALYZE ────────────────────────────────────────────────
const t0 = Date.now()
const aRes = await fetch(`${B}/analyze`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeText: RESUME, jobText: JOB }),
})
if (!aRes.ok) { console.log('FAILED —', aRes.status, await aRes.text()); process.exit(1) }
const a = await aRes.json()
const aSec = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`1/2  /analyze  ${aSec}s`)
console.log('     score:   ', a.scoreBefore)
console.log('     matched: ', a.matchedKeywords)
console.log('     missing: ', a.missingKeywords)

console.log('\n     >>> DID IT CATCH THE FILLER? <<<')
console.log('     This posting is full of "strong attention to detail", "good communication",')
console.log('     "strong organizational skills". None of that is what an ATS screens on.')
console.log('     If any appear above, the prompt is not filtering filler.\n')
console.log('─'.repeat(66))

// ── 2 · OPTIMIZE ───────────────────────────────────────────────
const CONFIRMED = a.missingKeywords
console.log(`\n2/2  /optimize  — student ticks all ${CONFIRMED.length}: ${CONFIRMED.join(', ')}\n`)

const t1 = Date.now()
const oRes = await fetch(`${B}/optimize`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    resumeText: RESUME,
    jobText: JOB,
    confirmedSkills: CONFIRMED,
    matchedKeywords: a.matchedKeywords,   // the modal already has these
    missingKeywords: a.missingKeywords,   // pass them so /optimize doesn't re-extract
  }),
})
if (!oRes.ok) { console.log('FAILED —', oRes.status, await oRes.text()); process.exit(1) }
const d = await oRes.json()
const oSec = ((Date.now() - t1) / 1000).toFixed(1)
const out = d.optimizedResume || ''

console.log(`     ${oSec}s`)
console.log(`     score:   ${d.scoreBefore} -> ${d.scoreAfter}   (+${d.scoreAfter - d.scoreBefore})`)
console.log('     added:  ', d.addedKeywords)

// ── keyword drift between the two calls ────────────────────────
console.log('\n=== KEYWORD DRIFT (known bug) ===')
const aSet = [...a.matchedKeywords, ...a.missingKeywords].sort()
const oSet = [...(d.matchedKeywords || []), ...(d.missingKeywords || [])].sort()
console.log(`analyze  found ${aSet.length}: ${aSet.join(', ')}`)
console.log(`optimize found ${oSet.length}: ${oSet.join(', ')}`)
if (a.scoreBefore !== d.scoreBefore) {
  console.log(`DRIFT — modal shows ${a.scoreBefore}, backend recomputes ${d.scoreBefore}. Same resume, two numbers.`)
} else {
  console.log('no drift this run (does not mean it is fixed — it is luck)')
}

// ── did they land ──────────────────────────────────────────────
console.log('\n=== DID THE SKILLS LAND? ===')
for (const k of CONFIRMED) {
  const n = (out.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
  console.log(`${n > 0 ? 'YES ' : 'NO  '} ${k}  — ${n}x`)
}

// ── fabrication scan ───────────────────────────────────────────
console.log('\n=== FABRICATED METRICS ===')
const nums = t => new Set((t.match(/\b\d+(?:\.\d+)?\s*(?:TB|GB|PB|MB|k|K|M|%|x|×)?\b/g) || []).map(s => s.trim()))
const invented = [...nums(out)].filter(n => !nums(RESUME).has(n))
console.log(invented.length ? `INVENTED: ${invented.join(', ')}` : 'clean — no numbers the candidate never stated')

// ── the phrase-lift scanner ────────────────────────────────────
// Rule 3: no four consecutive words from the job description may appear in
// the resume. This turns "it feels lifted" into a count.
console.log('\n=== LIFTED PHRASES (rule 3) ===')
const words = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
const jw = words(JOB)
const ow = words(out).join(' ')
const lifts = []
for (let i = 0; i <= jw.length - 4; i++) {
  const run = jw.slice(i, i + 4).join(' ')
  if (ow.includes(run) && !lifts.includes(run)) lifts.push(run)
}
if (lifts.length) {
  console.log(`FOUND ${lifts.length} four-word run(s) copied from the posting:`)
  lifts.forEach(l => console.log(`   "${l}"`))
  console.log('The recruiter wrote these sentences. Reading them back is the tell.')
} else {
  console.log('clean — no four-word run from the posting appears in the resume')
}

// ── bullet count per role ──────────────────────────────────────
console.log('\n=== BULLETS PER ROLE (rule 4: max 5-6) ===')
const roles = out.split(/\n(?=[A-Z][^\n]*\(\d{4})/).slice(1)
if (roles.length) {
  roles.forEach(r => {
    const title = r.split('\n')[0].trim()
    const n = (r.match(/^\s*-\s/gm) || []).length
    console.log(`${n <= 6 ? 'OK  ' : 'OVER'} ${n} bullets — ${title}`)
  })
} else {
  console.log('(could not split roles — check by eye)')
}

// ── skills section ─────────────────────────────────────────────
console.log('\n=== SKILLS SECTION (rule 7: grouped?) ===')
const skillsBlock = (out.match(/SKILLS\s*\n([\s\S]*?)(\n\s*\n|\nEDUCATION|$)/i) || [])[1] || ''
const grouped = /^\s*[A-Za-z][\w\s&/-]*:/m.test(skillsBlock)
console.log(grouped ? 'grouped — category headers found' : 'FLAT — still a comma dump')
console.log(skillsBlock.trim() || '(none found)')

// ── voice ──────────────────────────────────────────────────────
console.log('\n=== AI TELLS ===')
const banned = ['spearhead', 'leverag', 'synerg', 'robust', 'seamless', 'cutting-edge', 'innovative', 'passionate', 'dynamic', 'results-driven', 'proven track record', 'myriad', 'delve', 'tapestry', '—']
const hits = banned.filter(w => out.toLowerCase().includes(w.toLowerCase()))
console.log(hits.length ? `FOUND: ${hits.join(', ')}` : 'clean')

// ── the copywriter check ───────────────────────────────────────
console.log('\n=== TALKING TO THE READER? ===')
const chatty = [' your ', ' you ', " you're ", ' we ']
const chattyHits = chatty.filter(w => out.toLowerCase().includes(w))
console.log(chattyHits.length
  ? `FOUND: ${chattyHits.map(s => `"${s.trim()}"`).join(', ')} — last run it wrote "quietly doubling your runtime". Resumes do not address the reader.`
  : 'clean — no second person')

// ── seniority ──────────────────────────────────────────────────
console.log('\n=== WHAT THE SCORE CANNOT SEE ===')
console.log('This posting wants: mentoring others on Tableau, owning CI/CD, construction industry,')
console.log('managing initiatives independently. The candidate has ~2 years and no mentoring.')
console.log(`Coverage will still say ${d.scoreAfter}. Coverage counts words, not depth.`)

console.log('\n' + '─'.repeat(66))
console.log('\n=== READ AS IF SCREENING ===\n')
console.log(out)
console.log('\n' + '─'.repeat(66))
console.log('\n=== FEEDBACK SHOWN TO STUDENT ===')
console.log(d.feedback)
console.log(`\nTiming: ${aSec}s + ${oSec}s`)
