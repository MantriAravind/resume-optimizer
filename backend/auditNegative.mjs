// auditNegative.mjs — Hunts for EVERY phrasing of "we will not sponsor"
// Read-only. Does NOT touch the database.

function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
function normalize(text = '') {
  return text.toLowerCase()
    .replace(/u\.s\.a\./g, 'us').replace(/u\.s\./g, 'us').replace(/u\.s\b/g, 'us')
    .replace(/\s+/g, ' ')
}

const DISQUALIFIER_PATTERNS = [
  /\b(us|u s)?\s*citizenship\s+(is\s+)?(required|requirement)\b/,
  /\brequires?\s+(us\s+|u s\s+)?citizenship\b/,
  /\bwill\s+require\s+(us\s+|u s\s+)?citizenship\b/,
  /\bmust\s+be\s+a?\s*(us|u s)?\s*citizen\b/,
  /\b(us|u s)\s+citizens?\s+only\b/,
  /\bonly\s+(us|u s)\s+citizens?\b/,
  /\bcitizens?\s+(are\s+)?required\b/,
  /\bsecurity\s+clearance\s+(is\s+)?(required|requirement)\b/,
  /\b(require|requires|will require|must have|must possess|must hold|must obtain)\s+(an?\s+)?(active\s+|current\s+)?(security\s+)?clearance\b/,
  /\bactive\s+(security\s+)?clearance\b/,
  /\btop\s+secret\b/, /\bts\/sci\b/, /\bsecret\s+clearance\b/, /\bdod\s+clearance\b/,
  /\bno\s+(visa\s+)?sponsorship\b/,
  /\b(will\s+not|cannot|can not|unable to|not able to|does not|do not)\s+sponsor\b/,
  /\bsponsorship\s+(is\s+)?not\s+(available|offered|provided)\b/,
  /\bwithout\s+(employer\s+)?sponsorship\b/,
  /\bmust\s+be\s+authorized\s+to\s+work\s+(in\s+the\s+us\s+)?without\b/,
  /\bnot\s+eligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bineligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bgreen\s+card\s+(is\s+)?required\b/, /\bgc\s+required\b/, /\bpermanent\s+resident\s+(is\s+)?required\b/,
]
function isDisq(t = '') { return DISQUALIFIER_PATTERNS.some(re => re.test(normalize(t))) }

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
  /\bsponsor\w*\b.{0,30}\bnot\b/i,
  /\bunavailable\b.{0,30}\bsponsor/i,
  /\bsponsor\w*\b.{0,40}\b(unavailable|not available|not offered|not provided)\b/i,
]
function looksNegativeSponsor(t = '') {
  return NEGATIVE_SPONSOR_HINTS.some(re => re.test(t))
}

const SLUGS = [
  'accordion','mcmastercarr','stripe','databricks','coinbase','airbnb','reddit',
  'dropbox','samsara','instacart','pinterest','robinhood','discord','cloudflare',
  'scaleai','brex','gitlab','asana','airtable','figma','vercel','flexport',
  'gusto','benchling','doordash','affirm','chime','toast','sofi','wealthfront',
  'nerdwallet','crowdstrike','datadog','snowflake','hashicorp','elastic','twilio'
]

let total = 0
const MISSED = []
const phraseCounts = {}

for (const slug of SLUGS) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) { console.log(`⚠️  ${slug}: HTTP ${res.status}`); continue }
    const data = await res.json()
    const jobs = data.jobs || []

    for (const job of jobs) {
      const full = stripHtml(job.content || '')
      const ft = `${job.title || ''} ${full}`
      total++

      const negative = looksNegativeSponsor(full)
      const hidden = isDisq(ft)

      if (negative && !hidden) {
        const norm = normalize(full)
        const idx = norm.indexOf('sponsor')
        const phrase = norm.slice(Math.max(0, idx - 45), idx + 30).trim()
        MISSED.push({ slug, title: (job.title||'').slice(0,40), phrase })
        const sig = phrase.replace(/[^a-z ]/g,'').slice(0,50)
        phraseCounts[sig] = (phraseCounts[sig] || 0) + 1
      }
    }
    console.log(`✓ ${slug}: ${jobs.length}`)
  } catch (e) {
    console.log(`⚠️  ${slug}: ${e.message}`)
  }
}

console.log(`\n══════════════ RESULTS ══════════════`)
console.log(`Total jobs scanned: ${total}`)
console.log(`\n❌ NEGATIVE-SPONSOR PHRASING that current patterns MISSED (${MISSED.length}):`)
console.log(`(These look like no-sponsor jobs but would NOT be hidden — need new patterns)\n`)
MISSED.slice(0, 60).forEach(m => {
  console.log(`  [${m.slug}] ${m.title}`)
  console.log(`     ...${m.phrase}...`)
})
if (MISSED.length > 60) console.log(`\n  ...and ${MISSED.length - 60} more`)

console.log(`\n📊 MOST COMMON missed phrasings:`)
Object.entries(phraseCounts).sort((a,b) => b[1]-a[1]).slice(0, 20).forEach(([sig, n]) => {
  console.log(`  ${n}x  "${sig}"`)
})