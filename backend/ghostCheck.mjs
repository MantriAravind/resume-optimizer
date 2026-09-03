// ghostCheck.mjs — which companies on the board look like ghost-posting mills?
// READ-ONLY. Ranks suspects; a human reads and decides. Nothing is deleted here.
//
// Born 2026-09-03, the night alphabeinsightinc (390 postings) was found by
// accident: a logo question led to three clicks, and each posting's first line
// introduced a DIFFERENT company ("Catch Vibe Voice is...", "NextShining is a
// leading recruitment and staffing agency..."). Same night, bjakcareer: 155
// "onsite" postings whose location was the bare word "United States", all
// reposted daily. Both removals were manual. This automates the LOOKING —
// the three tells, computed from data already stored:
//
//   1. NAME MISMATCH   the stored description's opening introduces a company
//                      that is not the account's name. The 500-char stored
//                      excerpt keeps the first sentence, where mills brand
//                      their shells.
//   2. BARE COUNTRY    location is a country with no city. An onsite job that
//                      cannot name its city is a funnel, not a job.
//   3. ALL FRESH       nearly every posting "posted" within the last day —
//                      churn that games freshness-sorted boards.
//
// Run from backend against production:
//   node ghostCheck.mjs            companies with >= 15 live jobs
//   node ghostCheck.mjs 5          lower the bar to >= 5

import 'dotenv/config'
import mongoose from 'mongoose'

const MIN_JOBS = Math.max(2, Number(process.argv[2]) || 15)
const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

await mongoose.connect(process.env.MONGODB_URI)
console.log(`Database: ${mongoose.connection.db.databaseName} · companies with >= ${MIN_JOBS} live jobs\n`)

const jobs = await Job.find(
  { closed: { $ne: true } },
  { company: 1, companySlug: 1, ats: 1, location: 1, postedAt: 1, description: 1 }
).lean()

// "Acme, Inc. is a leading..." -> "Acme, Inc." Company-ish name at the start of
// the description, captured only when followed by an is/was/seeks verb so plain
// prose ("We are...") doesn't match.
const INTRO = /^\s*([A-Z][\w&.,'’\- ]{2,48}?)\s+(?:is|was|has been|seeks|is seeking|provides|specializes)\b/
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function introName(desc) {
  const m = INTRO.exec(String(desc || '').slice(0, 200))
  if (!m) return null
  const name = m[1].replace(/[,.]$/, '').trim()
  // Generic openers are not names.
  // Whole-name generics AND article-led phrases ("The Opportunity", "Our Team").
  if (/^(we|our|the|this|it|they|you|a|an|founded|established|headquartered|located|job|role|position|company|about)\b/i.test(name)) return null
  return name
}

const BARE = /^(united states( of america)?|usa|us|remote|anywhere|worldwide|global)$/i

const now = Date.now()
const byCompany = new Map()
for (const j of jobs) {
  const k = `${j.ats}|${j.companySlug}`
  if (!byCompany.has(k)) byCompany.set(k, { name: j.company, ats: j.ats, slug: j.companySlug, n: 0, mismatch: 0, intros: new Map(), bare: 0, fresh: 0 })
  const c = byCompany.get(k)
  c.n++
  if (BARE.test(String(j.location || '').trim())) c.bare++
  if (j.postedAt && now - new Date(j.postedAt).getTime() < 36 * 3600 * 1000) c.fresh++
  const intro = introName(j.description)
  if (intro) {
    const a = norm(intro), b = norm(c.name), s = norm(c.slug)
    const match = a && (b.includes(a) || a.includes(b) || s.includes(a) || a.includes(s))
    if (!match) {
      c.mismatch++
      c.intros.set(intro, (c.intros.get(intro) || 0) + 1)
    }
  }
}

const rows = []
for (const c of byCompany.values()) {
  if (c.n < MIN_JOBS) continue
  const mismatchShare = c.mismatch / c.n
  const bareShare = c.bare / c.n
  const freshShare = c.fresh / c.n
  // Distinct foreign intros matter more than one: a mill brands MANY shells.
  const shells = c.intros.size
  const score = mismatchShare * 3 + (shells > 1 ? 1 : 0) + bareShare * 2 + (freshShare > 0.9 ? 1 : 0)
  if (score >= 1) rows.push({ ...c, mismatchShare, bareShare, freshShare, shells, score })
}
rows.sort((a, b) => b.score - a.score)

if (!rows.length) {
  console.log('No companies over the suspicion threshold. Clean scan.')
} else {
  console.log(`${rows.length} suspect(s), worst first. READ before acting — signals are evidence, not verdicts.\n`)
  for (const r of rows.slice(0, 25)) {
    console.log(`━━ ${r.name}  (${r.ats}/${r.slug}) · ${r.n} jobs · score ${r.score.toFixed(1)}`)
    console.log(`   name-mismatch ${(100 * r.mismatchShare).toFixed(0)}% (${r.shells} distinct shell name${r.shells === 1 ? '' : 's'}) · bare-country ${(100 * r.bareShare).toFixed(0)}% · posted<36h ${(100 * r.freshShare).toFixed(0)}%`)
    for (const [name, n] of [...r.intros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      console.log(`      "${name}" × ${n}`)
    }
    console.log()
  }
  console.log('Next step for any real suspect: open 3 of its postings on the board,')
  console.log('then remove slug + jobs + company record, evidence in the commit — the')
  console.log('alphabeinsightinc / bjakcareer procedure.')
}

await mongoose.disconnect()
