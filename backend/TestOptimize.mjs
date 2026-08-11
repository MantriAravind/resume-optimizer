// testOptimize.mjs — checks the new /optimize response shape against the LOCAL backend.
// Run from the backend folder:  node testOptimize.mjs

const RESUME = `ARAVIND MANTRI
Data Engineer
Poughkeepsie, NY | mantriaravind10@gmail.com

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

console.log('Calling local /optimize... (15-25 sec)\n')

const res = await fetch('http://localhost:3001/optimize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeText: RESUME, jobText: JOB }),
})

if (!res.ok) {
  console.log('FAILED — status', res.status)
  console.log(await res.text())
  process.exit(1)
}

const d = await res.json()

console.log('=== SHAPE CHECK ===')
const need = ['scoreBefore', 'scoreAfter', 'matchedKeywords', 'missingKeywords', 'addedKeywords', 'feedback', 'optimizedResume', 'score']
for (const k of need) {
  const ok = d[k] !== undefined
  console.log(`${ok ? 'OK  ' : 'MISS'}  ${k}`)
}

console.log('\n=== SCORES ===')
console.log(`before: ${d.scoreBefore}   after: ${d.scoreAfter}   climb: +${d.scoreAfter - d.scoreBefore}`)

console.log('\n=== KEYWORDS ===')
console.log('matched: ', d.matchedKeywords)
console.log('missing: ', d.missingKeywords)
console.log('added:   ', d.addedKeywords)

const stillGap = (d.missingKeywords || []).filter(k => !(d.addedKeywords || []).includes(k))
console.log('still a gap (honest, expected):', stillGap)

console.log('\n=== HONESTY CHECK ===')
console.log('The sample resume has NEVER used PySpark, Databricks, or Delta Lake.')
console.log('If addedKeywords contains those, the prompt is fabricating and needs another pass.')

console.log('\n=== VOICE CHECK — read this yourself ===')
console.log(d.optimizedResume)

console.log('\n=== AI-TELL SCAN ===')
const banned = ['spearhead', 'leverag', 'synerg', 'robust', 'seamless', 'cutting-edge', 'innovative', 'passionate', 'dynamic', 'results-driven', 'proven track record', 'myriad', 'delve', 'tapestry', '—']
const hits = banned.filter(w => (d.optimizedResume || '').toLowerCase().includes(w.toLowerCase()))
console.log(hits.length ? `FOUND AI TELLS: ${hits.join(', ')}` : 'clean — none of the banned words appeared')

console.log('\n=== FEEDBACK ===')
console.log(d.feedback)
