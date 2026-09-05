// Semantic leak audit: the answer to "how many patterns don't we know about?"
// Samples visible jobs evenly across all six sources, pulls FULL ad text via
// our own /jobs/:id endpoint (same path the detail pane uses — full text for
// every ATS), and asks the model one question: does this posting restrict or
// refuse visa-requiring candidates IN ANY WORDING? Flags are for human review;
// every confirmed catch becomes a pattern candidate.
//   node semanticAudit.mjs --prod --n 20      (dry-sized first pass)
//   node semanticAudit.mjs --prod --n 200     (the real audit)
// Cost: gpt-4o-mini-class, roughly $0.05-0.15 per 200 jobs.
import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const PROD = process.argv.includes('--prod')
const nIdx = process.argv.indexOf('--n')
const N = nIdx > -1 ? Number(process.argv[nIdx + 1]) : 20
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
const OPENAI_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini'
const API = 'https://resume-optimizer-cuii.onrender.com'
if (!uri || !OPENAI_KEY) { console.error('❌ URI or OPENAI_API_KEY missing (.env).'); process.exit(1) }

const PROMPT = `You audit job postings for a job board serving international students on F1/OPT visas (they HAVE US work authorization via EAD, but need future visa sponsorship to stay long-term).
Answer: does this posting refuse, exclude, or restrict candidates who would need visa sponsorship — in ANY wording, including acronyms, indirect phrasing, or requirements only citizens/permanent residents can meet (security clearance, ITAR, "US persons")?
NOT restrictions: saying sponsorship IS available; "must be authorized to work in the US" alone (OPT students are); export mentions without a personnel requirement; EEO/anti-discrimination boilerplate ("without regard to ... citizenship status" is a promise NOT to discriminate — never flag it); benefits/relocation scope lines ("US & Puerto Rico only" about benefits pages).
If you cannot point to a specific restricting phrase, answer "clean" — never "unclear" with an empty quote.
Reply STRICT JSON only: {"verdict":"restricts"|"clean"|"unclear","quote":"exact phrase if not clean, else empty"}`

const sleep = ms => new Promise(r => setTimeout(r, ms))
await mongoose.connect(uri)
console.log('DB:', mongoose.connection.name, '· model:', MODEL, '· sampling', N, 'jobs\n')
const J = mongoose.connection.db.collection('jobs')

const per = Math.ceil(N / 6)
let sample = []
for (const ats of ['greenhouse', 'smartrecruiters', 'ashby', 'lever', 'workable', 'workday']) {
  sample = sample.concat(await J.aggregate([
    { $match: { ats, junkClass: null, needsLicense: { $ne: true } } }, { $sample: { size: per } },
    { $project: { id: 1, ats: 1, title: 1, company: 1 } }]).toArray())
}
sample = sample.slice(0, N)

let flags = [], errors = 0, done = 0
const errLog = []
let report = `# Semantic audit — ${new Date().toISOString().slice(0, 16)} · ${sample.length} jobs · ${MODEL}\n\n`
for (const j of sample) {
  done++
  try {
    // /jobs/:id wants the ATS id (job.id), not Mongo _id — probed live 2026-09-06.
    const jr = await fetch(`${API}/jobs/${encodeURIComponent(j.id)}`, { signal: AbortSignal.timeout(20000) })
    if (!jr.ok) { errors++; errLog.push(`fetch ${jr.status} · ${j.ats}/${j.id} · ${j.title}`); continue }
    const full = await jr.json()
    const text = `TITLE: ${j.title}\nCOMPANY: ${j.company}\n\n${String(full.description || '').slice(0, 12000)}`
    const or_ = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_KEY}` },
      // no temperature: gpt-5-family models reject explicit values (only default allowed)
      body: JSON.stringify({ model: MODEL, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!or_.ok) { errors++; errLog.push(`openai ${or_.status} · ${(await or_.text().catch(() => '')).slice(0, 140)} · ${j.title}`); await sleep(400); continue }
    const out = JSON.parse((await or_.json()).choices[0].message.content)
    if (out.verdict !== 'clean' && (out.quote || '').trim()) {
      flags.push({ j, out })
      console.log(`\n🚩 [${out.verdict}] ${j.ats} · ${j.company} · ${j.title}`)
      console.log(`   "${out.quote}"`)
      report += `## 🚩 ${out.verdict} — ${j.ats} · ${j.company} · ${j.title}\n   _id ${j._id}\n   quote: "${out.quote}"\n\n`
    } else process.stdout.write('.')
    await sleep(150)
  } catch (e) { errors++; errLog.push(`exception ${e.message} · ${j.title}`) }
}
console.log(`\n\n${done - errors} audited clean-path · ${flags.length} flagged · ${errors} errors`)
if (errLog.length) { console.log('\nERRORS (first 8):'); errLog.slice(0, 8).forEach(l => console.log('  !', l)) }
if (errors > done / 2) console.log('🛑 MOST CALLS FAILED — this run proves nothing. Fix errors before trusting any count.')
report += `---\n${done} audited · ${flags.length} flagged · ${errors} errors\n`
fs.writeFileSync('semantic-audit.md', report)
console.log('📄 semantic-audit.md written. Every flag needs a human verdict: real leak -> pattern candidate; false alarm -> note why.')
process.exit(0)
