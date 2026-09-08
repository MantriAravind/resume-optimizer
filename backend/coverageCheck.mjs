// C13 part 2 — COVERAGE CHECK: the counting alarm (the automated jobright moment).
// For our biggest Greenhouse + Ashby companies: how many fresh, US, full-text-
// passing jobs does THEIR live board hold vs how many are on OUR board?
// A big gap = silent suppression (the OpenAI class). Weekly, ~2 minutes.
//   node coverageCheck.mjs --prod --top 40
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { stripHtml, isUSLocation, isDisqualified, isContractOrPartTime } from './FetchJobs.mjs'
dotenv.config()

const tIdx = process.argv.indexOf('--top')
const TOP = tIdx > -1 ? Number(process.argv[tIdx + 1]) : 40
const uri = process.argv.includes('--prod') ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set'); process.exit(1) }
const cutoff = Date.now() - 30 * 864e5

await mongoose.connect(uri)
const J = mongoose.connection.db.collection('jobs')

// our biggest gh+ashby companies by visible jobs
const ours = await J.aggregate([
  // No junkClass filter: "theirs" isn't junk/license-gated either, so counting
  // ours unfiltered keeps the comparison symmetric (bayada's ~130 license-
  // hidden nurses created a permanent phantom gap).
  { $match: { ats: { $in: ['greenhouse', 'ashby'] } } },
  { $group: { _id: { ats: '$ats', slug: '$companySlug' }, n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $limit: TOP },
]).toArray()
console.log(`comparing our top ${ours.length} gh+ashby companies vs their live boards\n`)

const rows = []
for (const o of ours) {
  const { ats, slug } = o._id
  try {
    let theirs = 0
    if (ats === 'greenhouse') {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, { signal: AbortSignal.timeout(25000) })
      if (!r.ok) { rows.push({ slug, ats, ours: o.n, theirs: -1 }); continue }
      for (const j of ((await r.json()).jobs || [])) {
        if (new Date(j.first_published || 0) < cutoff) continue
        const loc = j.location?.name || ''
        if (!loc || !isUSLocation(loc)) continue
        const plain = stripHtml(String(j.content || ''))
        if (isDisqualified(`${j.title}\n${plain}`, j.title)) continue
        if (isContractOrPartTime(plain, j.title || '')) continue
        theirs++
      }
    } else {
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(25000) })
      if (!r.ok) { rows.push({ slug, ats, ours: o.n, theirs: -1 }); continue }
      for (const j of ((await r.json()).jobs || [])) {
        if (j.isListed === false) continue
        if (new Date(j.publishedAt || 0) < cutoff) continue
        const loc = [j.location, ...(j.secondaryLocations || []).map(s => s.location)].filter(Boolean).join(' · ')
        if (!loc || !isUSLocation(loc)) continue
        const plain = String(j.descriptionPlain || '')
        if (isDisqualified(`${j.title}\n${plain}`, j.title)) continue
        if (isContractOrPartTime(plain, j.title || '')) continue
        theirs++
      }
    }
    rows.push({ slug, ats, ours: o.n, theirs })
    await new Promise(r => setTimeout(r, 120))
  } catch { rows.push({ slug, ats, ours: o.n, theirs: -2 }) }
}

let alarms = 0
console.log('company'.padEnd(28), 'ours'.padStart(5), 'theirs'.padStart(7), '  verdict')
for (const r of rows.sort((a, b) => (b.theirs - b.ours) - (a.theirs - a.ours))) {
  const gap = r.theirs - r.ours
  let v = 'ok'
  if (r.theirs === -1) v = 'board fetch failed'
  else if (r.theirs === -2) v = 'error'
  else if (r.theirs > 20 && r.ours < r.theirs * 0.5) { v = '🛑 SUPPRESSION? ours < half of theirs'; alarms++ }
  else if (gap > 30) { v = '⚠️ large gap'; alarms++ }
  console.log(r.slug.slice(0, 27).padEnd(28), String(r.ours).padStart(5), String(r.theirs).padStart(7), ' ', v)
}
console.log(`\n${alarms} alarm(s). Note: ours < theirs by a little is NORMAL (junk-hidden, sweep timing).`)
console.log('ours >> theirs is also normal (their count is fresh-only re-judged today; ours spans 30 days).')
process.exit(0)
