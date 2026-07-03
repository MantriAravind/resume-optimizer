// auditDB.mjs — Scans ALL jobs in your MongoDB for no-sponsor phrasings that slipped through.
// Read-only: does NOT modify or delete anything.
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

function normalize(text = '') {
  return text.toLowerCase()
    .replace(/u\.s\.a\./g, 'us').replace(/u\.s\./g, 'us').replace(/u\.s\b/g, 'us')
    .replace(/\s+/g, ' ')
}

const NEGATIVE_SPONSOR_HINTS = [
  /\bnot\b.{0,40}\bsponsor/i,
  /\bno\b.{0,30}\bsponsor/i,
  /\bcannot\b.{0,30}\bsponsor/i,
  /\bunable\b.{0,30}\bsponsor/i,
  /\bwithout\b.{0,30}\bsponsor/i,
  /\bineligible\b.{0,30}\bsponsor/i,
  /\bnever\b.{0,30}\bsponsor/i,
  /\bdo not\b.{0,30}\bsponsor/i,
  /\bdoes not\b.{0,30}\bsponsor/i,
  /\bwill not\b.{0,30}\bsponsor/i,
  /\bunavailable\b.{0,30}\bsponsor/i,
  /\bsponsor\w*\b.{0,40}\b(unavailable|not available|not offered|not provided|is not|are not)\b/i,
]
function looksNegativeSponsor(t = '') {
  return NEGATIVE_SPONSOR_HINTS.some(re => re.test(t))
}

const OTHER_HINTS = [/\bcitizen/i, /\bclearance/i, /\bgreen card/i, /\bsecurity\s+clearance/i, /\bts\/sci/i]
function mentionsOther(t = '') { return OTHER_HINTS.some(re => re.test(t)) }

await mongoose.connect(process.env.MONGODB_URI)
console.log('✅ Connected. Scanning all saved jobs...\n')

const coll = mongoose.connection.db.collection('jobs')
const total = await coll.countDocuments({})
console.log(`Total jobs in DB: ${total}\n`)

const cursor = coll.find({})
let scanned = 0
const negMissed = []
const otherFlagged = []
const phraseCounts = {}

while (await cursor.hasNext()) {
  const job = await cursor.next()
  scanned++
  const desc = job.description || ''
  const fullText = `${job.title || ''} ${desc}`

  if (looksNegativeSponsor(desc)) {
    const norm = normalize(desc)
    const idx = norm.indexOf('sponsor')
    const phrase = norm.slice(Math.max(0, idx - 50), idx + 35).trim()
    negMissed.push({ company: job.company, title: (job.title||'').slice(0,40), phrase, id: job.id })
    const sig = phrase.replace(/[^a-z ]/g, '').replace(/\s+/g,' ').trim().slice(0, 55)
    phraseCounts[sig] = (phraseCounts[sig] || 0) + 1
  }

  if (mentionsOther(fullText)) {
    const norm = normalize(fullText)
    if (/\b(required|must be|must have|only|requires)\b/.test(norm)) {
      const m = norm.match(/.{0,30}(citizen|clearance|green card|ts\/sci).{0,30}/)
      if (m) otherFlagged.push({ company: job.company, title: (job.title||'').slice(0,40), phrase: m[0].trim(), id: job.id })
    }
  }

  if (scanned % 10000 === 0) console.log(`  ...scanned ${scanned}/${total}`)
}

console.log(`\n══════════════ RESULTS ══════════════`)
console.log(`Scanned: ${scanned} jobs`)

console.log(`\n❌ NEGATIVE-SPONSOR phrasing found IN DATABASE (${negMissed.length}):`)
console.log(`(These slipped through — they look like no-sponsor jobs but were saved)\n`)
negMissed.slice(0, 50).forEach(m => {
  console.log(`  [${m.company}] ${m.title}  (id:${m.id})`)
  console.log(`     ...${m.phrase}...`)
})
if (negMissed.length > 50) console.log(`\n  ...and ${negMissed.length - 50} more`)

console.log(`\n📊 MOST COMMON missed phrasings (the patterns we need to add):`)
Object.entries(phraseCounts).sort((a,b) => b[1]-a[1]).slice(0, 25).forEach(([sig, n]) => {
  console.log(`  ${String(n).padStart(4)}x  "${sig}"`)
})

console.log(`\n⚠️  CITIZENSHIP/CLEARANCE mentions with requirement language (${otherFlagged.length}):`)
console.log(`(Review — may be real requirements that slipped, or harmless EOE text)\n`)
otherFlagged.slice(0, 30).forEach(m => {
  console.log(`  [${m.company}] ${m.title}  (id:${m.id})`)
  console.log(`     ...${m.phrase}...`)
})
if (otherFlagged.length > 30) console.log(`\n  ...and ${otherFlagged.length - 30} more`)

await mongoose.disconnect()
console.log('\n🔌 Done.')