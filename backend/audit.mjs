// audit.mjs — Scans many real Greenhouse jobs against the FIXED filter patterns
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
  /\bgreen\s+card\s+(is\s+)?required\b/, /\bgc\s+required\b/, /\bpermanent\s+resident\s+(is\s+)?required\b/,
  /\bnot\s+eligible\s+for\s+(work\s+authorization\s+)?(visa\s+)?sponsorship\b/,
  /\bnot\s+eligible\s+for\s+sponsorship\b/,
  /\bineligible\s+for\s+(work\s+authorization\s+)?(visa\s+)?sponsorship\b/,
  /\bare\s+not\s+able\s+to\s+(provide|offer)\s+(visa\s+)?sponsorship\b/,
]
const SPONSOR_PATTERNS = [
  /\bwill\s+sponsor\b/,
  /\bvisa\s+sponsorship\s+(is\s+)?(available|offered|provided)\b/,
  /\b(offer|offers|offering|provide|provides|providing)\s+(visa\s+)?sponsorship\b/,
  /\bh-?1b\s+sponsor/,
  /\bsponsorship\s+(is\s+)?available\b/,
  /\bwe\s+sponsor\b/,
  /\bsponsorship\s+(is\s+)?provided\b/,
  /\bopen\s+to\s+sponsorship\b/,
  /\bimmigration\s+sponsorship\b/,
]
function isDisq(t = '') { return DISQUALIFIER_PATTERNS.some(re => re.test(normalize(t))) }
function hasBadge(t = '') { return SPONSOR_PATTERNS.some(re => re.test(normalize(t))) }

const MENTIONS_SPONSOR = /sponsor/i
const NEGATIVE_NEARBY  = /\b(not|no|never|cannot|can't|unable|without|ineligible)\b/i

const SLUGS = [
  'mcmastercarr','stripe','databricks','coinbase','airbnb','reddit','dropbox',
  'samsara','instacart','pinterest','robinhood','discord','cloudflare',
  'anduril','palantir','scaleai','rippling','brex','plaid','gitlab',
  'asana','airtable','figma','notion','retool','vercel','hashicorp'
]

let total = 0, hidden = 0, badged = 0, plain = 0
const suspicious = []
const oddBadge = []
const sponsorPhrases = new Set()

for (const slug of SLUGS) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) { console.log(`⚠️  ${slug}: HTTP ${res.status}`); continue }
    const data = await res.json()
    const jobs = data.jobs || []

    for (const job of jobs) {
      const full = stripHtml(job.content || '')
      const norm = normalize(full)
      const title = job.title || ''
      const ft = `${title} ${full}`
      total++

      const d = isDisq(ft)
      const b = d ? false : hasBadge(full)

      if (d) hidden++
      else if (b) badged++
      else plain++

      if (!d && MENTIONS_SPONSOR.test(full) && NEGATIVE_NEARBY.test(full)) {
        const idx = norm.indexOf('sponsor')
        const snippet = norm.slice(Math.max(0, idx - 60), idx + 60)
        suspicious.push({ slug, title: title.slice(0, 40), snippet, badged: b })
      }
      if (b && NEGATIVE_NEARBY.test(full)) {
        const idx = norm.indexOf('sponsor')
        const snippet = norm.slice(Math.max(0, idx - 50), idx + 50)
        oddBadge.push({ slug, title: title.slice(0, 40), snippet })
      }
      if (MENTIONS_SPONSOR.test(full)) {
        const m = norm.match(/.{0,25}sponsor.{0,25}/g)
        if (m) m.slice(0, 2).forEach(p => sponsorPhrases.add(p.trim()))
      }
    }
    console.log(`✓ ${slug}: ${jobs.length} jobs`)
  } catch (e) {
    console.log(`⚠️  ${slug}: ${e.message}`)
  }
}

console.log('\n══════════════ SUMMARY ══════════════')
console.log(`Total jobs scanned: ${total}`)
console.log(`  Hidden (disqualified): ${hidden}`)
console.log(`  Badged (sponsors):     ${badged}`)
console.log(`  Plain (silent):        ${plain}`)

console.log(`\n══ ⚠️  SUSPICIOUS: mentions sponsor + negative word but NOT hidden (${suspicious.length}) ══`)
suspicious.slice(0, 40).forEach(s => {
  console.log(`\n  [${s.slug}] ${s.title}${s.badged ? '  *** HAS BADGE ***' : ''}`)
  console.log(`    ...${s.snippet}...`)
})
if (suspicious.length > 40) console.log(`\n  ...and ${suspicious.length - 40} more`)

console.log(`\n══ ❌ ODD BADGES: badged but negative word near "sponsor" (${oddBadge.length}) ══`)
oddBadge.slice(0, 20).forEach(s => {
  console.log(`  [${s.slug}] ${s.title}`)
  console.log(`    ...${s.snippet}...`)
})

console.log(`\n══ 📋 Sample sponsorship phrasings found (${sponsorPhrases.size} unique) ══`)
;[...sponsorPhrases].slice(0, 40).forEach(p => console.log(`  • ${p}`))