// probeOptimize.mjs — A5 step-3 verifier for /optimize.
//
// Same inputs the modal uses (full JD via /jobs/:id), runs /analyze, taps EVERY
// missing skill, runs /optimize, then checks the one thing A5-4 is about:
//   promised (analyze maxScore) === delivered (optimize rubricAfter.total)
// and prints the verified placements so A5-2/3 can be eyeballed.
//
// Usage (from backend/):
//   node probeOptimize.mjs --local --title "Data Engineer"
//   node probeOptimize.mjs --local --job <jobId>
//   node probeOptimize.mjs --local --job <jobId> --tap 2      tap only the first 2 missing
//   node probeOptimize.mjs --local --job <jobId> --tap 2 --letter   also generate the cover letter
//
// Reads MONGODB_URI from the shell/.env. Never writes to Mongo itself.

import dotenv from 'dotenv'
import mongoose from 'mongoose'
dotenv.config()

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1] }
const BACKEND = args.includes('--local') ? 'http://localhost:3001' : (process.env.PROBE_BACKEND || 'https://resume-optimizer-cuii.onrender.com')
const wantTitle = flag('--title') || 'Data Engineer'
const wantJob   = flag('--job')
const tapN      = flag('--tap') ? Number(flag('--tap')) : Infinity

await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db
const user = await db.collection('users').findOne({ resumeText: { $exists: true, $ne: '' } }, { projection: { resumeText: 1 } })
const job = wantJob
  ? await db.collection('jobs').findOne({ id: wantJob })
  : await db.collection('jobs').findOne({ title: new RegExp(wantTitle, 'i'), closed: { $ne: true }, company: { $not: /sandbox|test|demo/i }, ats: { $in: ['greenhouse', 'smartrecruiters', 'ashby'] } }, { sort: { postedAt: -1 } })
await mongoose.disconnect()
if (!user || !job) { console.error('no user or no job'); process.exit(1) }

const post = async (path, body) => {
  const r = await fetch(BACKEND + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) { console.error(path, r.status, j); process.exit(1) }
  return j
}

console.log('job:', job.title, '@', job.company, '| id', job.id)
const full = await (await fetch(BACKEND + '/jobs/' + encodeURIComponent(job.id))).json()
const jobText = full.description || ''
console.log('full JD', jobText.length, 'chars')

const common = { resumeText: user.resumeText, jobText, jobTitle: job.title, yearsMin: job.yearsMin ?? null }
let t = Date.now()
const a = await post('/analyze', common)
console.log('\n/analyze in', Date.now() - t, 'ms · rubric', a.rubric.total, '· maxScore', a.maxScore)
console.log('matched:', a.matchedKeywords.join(' | '))
console.log('missing:', a.missingKeywords.join(' | '))

const confirmed = a.missingKeywords.slice(0, tapN)
console.log('\ntapping', confirmed.length, 'of', a.missingKeywords.length, ':', confirmed.join(' | '))
const promised = confirmed.length === a.missingKeywords.length ? a.maxScore : null

t = Date.now()
const o = await post('/optimize', { ...common, matchedKeywords: a.matchedKeywords, missingKeywords: a.missingKeywords, confirmedSkills: confirmed })
console.log('/optimize in', Date.now() - t, 'ms')
console.log('\nold scoreBefore/After:', o.scoreBefore, '->', o.scoreAfter, '| rubricAfter.total', o.rubricAfter.total)
if (promised !== null) console.log(o.rubricAfter.total === promised ? `PROMISE KEPT: promised ${promised}, delivered ${o.rubricAfter.total}` : `PROMISE BROKEN: promised ${promised}, delivered ${o.rubricAfter.total}`)
console.log('addedKeywords (landed):', o.addedKeywords.length, '/', confirmed.length, o.addedKeywords.length === confirmed.length ? 'all landed' : 'MISSING: ' + confirmed.filter(k => !o.addedKeywords.includes(k)).join(', '))

console.log('\nplacements:')
for (const p of o.placements || []) {
  if (p.where === 'bullet') console.log(`  ✓ ${p.skill.padEnd(22)} bullet @ ${p.employer || '?'}  fragment: "${p.fragment}"`)
  else console.log(`  · ${p.skill.padEnd(22)} skills section only${p.present ? '' : '  (NOT FOUND IN OUTPUT)'}`)
}

const lines = o.optimizedResume.split('\n')
const si = lines.findIndex(l => /skills|proficienc|competenc/i.test(l) && l.trim().length < 40)
console.log('\nskills section of output:')
for (let i = si; i < lines.length && i < si + 8 && i !== -1; i++) { if (i > si && /^[A-Z][A-Z &/]{3,}$/.test(lines[i].trim())) break; console.log('  ' + lines[i]) }
console.log('\nfeedback:', o.feedback)
console.log('\nCheck: (1) PROMISE KEPT, (2) every bullet placement fragment reads as the candidate\'s own work + the skill, (3) skills-only placements are in the skills lines, (4) terminal 1 for "gate retry" / "code-appended" lines.')

if (args.includes('--letter')) {
  t = Date.now()
  const c = await post('/cover-letter', { ...common, company: job.company, confirmedSkills: confirmed, missingKeywords: a.missingKeywords, optimizedResume: o.optimizedResume })
  console.log('\n/cover-letter in', Date.now() - t, 'ms ·', c.wordCount, 'words', c.strippedSkills.length ? '· STRIPPED: ' + c.strippedSkills.join(', ') : '')
  console.log('\n' + c.coverLetter)
  const unconfirmed = a.missingKeywords.filter(k => !confirmed.includes(k))
  const leaks = unconfirmed.filter(k => c.coverLetter.toLowerCase().includes(k.toLowerCase()))
  console.log('\nunconfirmed skills named in letter:', leaks.length ? 'LEAK: ' + leaks.join(', ') : 'none')
  console.log('Check: every claim in the letter is in the resume; no company facts beyond the posting; no dashes; 180-260 words.')
}
