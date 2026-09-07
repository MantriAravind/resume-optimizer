// Pattern-round measurement: candidate junk additions read against every
// VISIBLE title before any pattern ships. Prints ALL matches per candidate.
//   node measureSales.mjs --prod
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
const uri = process.argv.includes('--prod') ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set'); process.exit(1) }

const CANDIDATES = [
  { label: 'salesperson',      re: /\bsales\s?persons?\b/i },
  { label: 'hiring event',     re: /\bhiring\s+event\b|\bjob\s+fair\b|\bopen\s+interviews?\b|\bwalk-?in\s+(interviews?|hiring)\b/i },
  { label: 'commercial spec.', re: /\bcommercial\s+specialists?\b/i },
  { label: 'store GM',         re: /\b(assistant\s+)?general\s+manager\b/i },  // deliberately broad — READ ONLY, decides scoping
]
await mongoose.connect(uri)
console.log('DB:', mongoose.connection.name)
const J = mongoose.connection.db.collection('jobs')
const jobs = await J.find({ junkClass: null }, { projection: { title: 1, company: 1 } }).toArray()
console.log('visible jobs scanned:', jobs.length, '\n')
for (const c of CANDIDATES) {
  const hits = new Map()
  for (const j of jobs) if (c.re.test(j.title || '')) { const k = `${j.title}   [${j.company}]`; hits.set(k, (hits.get(k) || 0) + 1) }
  const total = [...hits.values()].reduce((a, b) => a + b, 0)
  console.log(`## ${c.label} — ${total} visible matches`)
  for (const [k, n] of [...hits.entries()].sort()) console.log(`  - ${k}${n > 1 ? ' x' + n : ''}`)
  console.log()
}
process.exit(0)
