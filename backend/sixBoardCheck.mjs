// C6-lite: 50 random VISIBLE jobs per source, stored text vs the leak phrases.
// Honest scope: stored descriptions are truncated — this checks what we hold,
// and reports per-source text depth so the blind spot is measured, not ignored.
//   node sixBoardCheck.mjs --prod
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
const uri = process.argv.includes('--prod') ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set'); process.exit(1) }

const PHRASES = [
  [/\b(us|u\.?s\.?)\s+citizens?\s+only\b/i, 'citizens only'],
  [/\bmust\s+be\s+a?\s*(us|u\.?s\.?)?\s*citizen\b/i, 'must be citizen'],
  [/\bno\s+(visa\s+)?sponsorship\b/i, 'no sponsorship'],
  [/\bunable\s+to\s+sponsor\b/i, 'unable to sponsor'],
  [/\bwill\s+not\s+sponsor\b/i, 'will not sponsor'],
  [/\bsecurity\s+clearance\s+(is\s+)?required\b/i, 'clearance required'],
  [/\buscs?\s*(\/|,|\s+(and|or)\s+)\s*gc\b/i, 'USC/GC'],
  [/\bgreen\s+card\s+holders?\s+only\b/i, 'GC holders only'],
  [/\bno\s+other\s+visas?\b/i, 'no other visas'],
  [/\bitar\b/i, 'ITAR'],
  [/\bpermanent\s+work\s+authorization\b/i, 'permanent work auth'],
]

await mongoose.connect(uri)
console.log('DB:', mongoose.connection.name, '\n')
const J = mongoose.connection.db.collection('jobs')
let totalLeaks = 0
for (const ats of ['greenhouse', 'smartrecruiters', 'ashby', 'lever', 'workable', 'workday']) {
  const sample = await J.aggregate([
    { $match: { ats, junkClass: null } },
    { $sample: { size: 50 } },
    { $project: { title: 1, company: 1, description: 1 } },
  ]).toArray()
  const lens = sample.map(j => (j.description || '').length).sort((a, b) => a - b)
  const med = lens[Math.floor(lens.length / 2)] || 0
  let leaks = 0
  for (const j of sample) {
    const text = `${j.title}\n${j.description || ''}`
    for (const [re, label] of PHRASES) {
      if (re.test(text)) {
        leaks++; totalLeaks++
        const m = text.match(new RegExp(`.{0,45}${re.source}.{0,45}`, 'i'))
        console.log(`❌ ${ats} · ${j.company} · ${j.title}`)
        console.log(`   [${label}] ...${(m ? m[0] : '').replace(/\s+/g, ' ').trim()}...`)
        break
      }
    }
  }
  console.log(`${ats.padEnd(16)} sampled ${String(sample.length).padStart(2)} · leaks ${leaks} · text depth: median ${med} chars${med >= 500 ? ' (truncated — deep text unseen)' : ''}`)
}
console.log(totalLeaks === 0 ? '\n✅ 0 leaks across all six samples (stored-text scope).' : `\n🛑 ${totalLeaks} leak(s) above — each needs a pattern or a purge.`)
process.exit(0)
