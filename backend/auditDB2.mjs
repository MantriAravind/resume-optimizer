// auditDB2.mjs — Re-scans ALL saved jobs using the EXPANDED patterns. Read-only.
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

function normalize(text = '') {
  return text.toLowerCase()
    .replace(/u\.s\.a\./g, 'us').replace(/u\.s\./g, 'us').replace(/u\.s\b/g, 'us')
    .replace(/\s+/g, ' ')
}

const DISQUALIFIER_PATTERNS = [
  /\b(us|u s)?\s*citizenship\s*:?\s*(is\s+)?(required|requirement)\b/,
  /\bcitizenship\s*:\s*this\s+position\s+requires\b/,
  /\brequires?\s+(us\s+|u s\s+)?citizenship\b/,
  /\bwill\s+require\s+(us\s+|u s\s+)?citizenship\b/,
  /\bmust\s+be\s+a?\s*(us|u s)?\s*citizen\b/,
  /\b(us|u s)\s+citizens?\s+only\b/,
  /\bonly\s+(us|u s)\s+citizens?\b/,
  /\bcitizens?\s+(are\s+)?required\b/,
  /\bsecurity\s+clearance\s+(is\s+)?(required|requirement)\b/,
  /\b(require|requires|will require|must have|must possess|must hold|must obtain)\s+(an?\s+)?(active\s+|current\s+)?(security\s+)?clearance\b/,
  /\bactive\s+(security\s+)?clearance\b/,
  /\bclearance\s+required\s*:?\s*(active|public|secret|top)\b/,
  /\bclearance\s*:\s*(public\s+trust|active\s+secret|secret|top\s+secret|ts\/sci)\b/,
  /\bclearance\s+required\b/,
  /\bpublic\s+trust\s+(clearance|required)\b/,
  /\btop\s+secret\b/, /\bts\/sci\b/, /\bsecret\s+clearance\b/, /\bdod\s+clearance\b/,
  /\b\(clearance\s+required\)/,
  /\bno\s+(visa\s+)?sponsorship\b/,
  /\b(will\s+not|cannot|can not|unable to|not able to|does not|do not|won't|are not able to|is not able to)\s+(offer|provide|sponsor)\b/,
  /\b(unable|not able)\s+to\s+(offer|provide)\s+(work\s+)?(visa\s+)?sponsorship\b/,
  /\b(does|do)\s+not\s+(offer|provide)\s+(work\s+)?(visa\s+)?sponsorship\b/,
  /\b(is\s+)?not\s+open\s+to\s+(visa\s+)?sponsorship\b/,
  /\bsponsorship\s*:?\s*(is\s+)?not\s+(available|offered|provided)\b/,
  /\bsponsorship\s+not\s+available\b/,
  /\b(visa\s+)?sponsorship\s+(is\s+)?(not\s+available|unavailable)\b/,
  /\bwithout\s+(employer\s+)?sponsorship\b/,
  /\bmust\s+be\s+authorized\s+to\s+work\s+(in\s+the\s+us\s+)?without\b/,
  /\bnot\s+eligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bineligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bno\s+h-?1b\s+or\s+opt\s+(visa\s+)?sponsorship\b/,
  /\bregret\s+that\s+we\s+are\s+unable\s+to\s+(offer|provide)/,
  /\bgreen\s+card\s+(is\s+)?required\b/, /\bgc\s+required\b/, /\bpermanent\s+resident\s+(is\s+)?required\b/,
]
function isDisq(t = '') { return DISQUALIFIER_PATTERNS.some(re => re.test(normalize(t))) }

const NEGATIVE_SPONSOR_HINTS = [
  /\bnot\b.{0,40}\bsponsor/i, /\bno\b.{0,30}\bsponsor/i, /\bcannot\b.{0,30}\bsponsor/i,
  /\bunable\b.{0,30}\bsponsor/i, /\bwithout\b.{0,30}\bsponsor/i, /\bineligible\b.{0,30}\bsponsor/i,
  /\bnever\b.{0,30}\bsponsor/i, /\bdo not\b.{0,30}\bsponsor/i, /\bdoes not\b.{0,30}\bsponsor/i,
  /\bwill not\b.{0,30}\bsponsor/i, /\bunavailable\b.{0,30}\bsponsor/i,
  /\bsponsor\w*\b.{0,40}\b(unavailable|not available|not offered|not provided|is not|are not)\b/i,
  /\bnot open to\b.{0,30}\bsponsor/i,
]
function looksNegativeSponsor(t = '') { return NEGATIVE_SPONSOR_HINTS.some(re => re.test(t)) }

const CLEARANCE_CITIZEN_HINTS = [/\bcitizen/i, /\bclearance/i, /\bgreen card/i, /\bts\/sci/i, /\bpublic trust/i, /\bsecret\b/i]
function mentionsClearanceCitizen(t = '') { return CLEARANCE_CITIZEN_HINTS.some(re => re.test(t)) }

await mongoose.connect(process.env.MONGODB_URI)
console.log('✅ Connected. Re-scanning with EXPANDED patterns...\n')

const coll = mongoose.connection.db.collection('jobs')
const total = await coll.countDocuments({})
const cursor = coll.find({})
let scanned = 0
const stillMissedSponsor = []
const stillFlaggedClearance = []
const sponsorPhrases = {}
const clearancePhrases = {}

while (await cursor.hasNext()) {
  const job = await cursor.next()
  scanned++
  const desc = job.description || ''
  const ft = `${job.title || ''} ${desc}`

  if (looksNegativeSponsor(desc) && !isDisq(ft)) {
    const norm = normalize(desc)
    const idx = norm.indexOf('sponsor')
    const phrase = norm.slice(Math.max(0, idx - 50), idx + 35).trim()
    stillMissedSponsor.push({ company: job.company, title: (job.title||'').slice(0,38), phrase, id: job.id })
    const sig = phrase.replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim().slice(0,55)
    sponsorPhrases[sig] = (sponsorPhrases[sig]||0)+1
  }

  if (mentionsClearanceCitizen(ft) && !isDisq(ft)) {
    const norm = normalize(ft)
    if (/\b(required|must be|must have|only|requires|clearance|public trust)\b/.test(norm)) {
      const m = norm.match(/.{0,35}(citizen|clearance|green card|ts\/sci|public trust|secret).{0,25}/)
      if (m) {
        stillFlaggedClearance.push({ company: job.company, title: (job.title||'').slice(0,38), phrase: m[0].trim(), id: job.id })
        const sig = m[0].replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim().slice(0,55)
        clearancePhrases[sig] = (clearancePhrases[sig]||0)+1
      }
    }
  }

  if (scanned % 10000 === 0) console.log(`  ...scanned ${scanned}/${total}`)
}

console.log(`\n══════════════ RESULTS (after expanded fix) ══════════════`)
console.log(`Scanned: ${scanned}`)

console.log(`\n❌ NO-SPONSOR jobs STILL slipping through (${stillMissedSponsor.length}):`)
stillMissedSponsor.slice(0, 40).forEach(m => {
  console.log(`  [${m.company}] ${m.title} (id:${m.id})`)
  console.log(`     ...${m.phrase}...`)
})
if (stillMissedSponsor.length > 40) console.log(`  ...and ${stillMissedSponsor.length-40} more`)
console.log(`\n  Top still-missed sponsor phrasings:`)
Object.entries(sponsorPhrases).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([s,n]) => console.log(`    ${n}x  "${s}"`))

console.log(`\n⚠️  CLEARANCE/CITIZENSHIP still flagged (${stillFlaggedClearance.length}):`)
console.log(`(Review: real requirement = bug to fix | EOE boilerplate = fine to leave)`)
stillFlaggedClearance.slice(0, 40).forEach(m => {
  console.log(`  [${m.company}] ${m.title} (id:${m.id})`)
  console.log(`     ...${m.phrase}...`)
})
if (stillFlaggedClearance.length > 40) console.log(`  ...and ${stillFlaggedClearance.length-40} more`)
console.log(`\n  Top still-flagged clearance/citizen phrasings:`)
Object.entries(clearancePhrases).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([s,n]) => console.log(`    ${n}x  "${s}"`))

await mongoose.disconnect()
console.log('\n🔌 Done.')