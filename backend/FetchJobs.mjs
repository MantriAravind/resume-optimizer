import mongoose from 'mongoose'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── MongoDB Job Schema ──────────────────────────────────────────────────────
const jobSchema = new mongoose.Schema({
  id:           { type: String, unique: true },
  title:        String,
  company:      String,
  companySlug:  String,
  location:     String,
  isRemote:     Boolean,
  description:  String,
  applyUrl:     String,
  postedAt:     Date,
  sponsorBadge: Boolean,
  ats:          String,
  fetchedAt:    { type: Date, default: Date.now }
})

const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

// ── HTML → Plain Text (decode entities FIRST, then strip tags) ──────────────
function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Normalize (collapse "U.S." -> "us") ─────────────────────────────────────
function normalize(text = '') {
  return text
    .toLowerCase()
    .replace(/u\.s\.a\./g, 'us')
    .replace(/u\.s\./g, 'us')
    .replace(/u\.s\b/g, 'us')
    .replace(/\s+/g, ' ')
}

// ── DISQUALIFIERS — any match = job HIDDEN ──────────────────────────────────
const DISQUALIFIER_PATTERNS = [
  // Citizenship
  /\b(us|u s)?\s*citizenship\s*:?\s*(is\s+)?(required|requirement)\b/,
  /\bcitizenship\s*:\s*this\s+position\s+requires\b/,
  /\brequires?\s+(us\s+|u s\s+)?citizenship\b/,
  /\bwill\s+require\s+(us\s+|u s\s+)?citizenship\b/,
  /\bmust\s+be\s+a?\s*(us|u s)?\s*citizen\b/,
  /\b(us|u s)\s+citizens?\s+only\b/,
  /\bonly\s+(us|u s)\s+citizens?\b/,
  /\bcitizens?\s+(are\s+)?required\b/,
  // Security clearance (incl. colon format, public trust, ts sci variants)
  /\bsecurity\s+clearance\s+(is\s+)?(required|requirement)\b/,
  /\b(require|requires|will require|must have|must possess|must hold|must obtain)\s+(an?\s+)?(active\s+|current\s+)?(security\s+)?clearance\b/,
  /\bactive\s+(security\s+)?clearance\b/,
  /\bclearance\s+required\s*:?\s*(active|public|secret|top)\b/,
  /\bclearance\s*:\s*(active\s+|current\s+|ability to obtain\s+|able to obtain\s+)?(a\s+)?(top[\s-]?secret|secret|public\s+trust|ts\/sci|ts-sci|ts\s+sci)\b/,
  /\bclearance\s+required\b/,
  /\bpublic\s+trust\s+(clearance|required)\b/,
  /\b(ability to obtain|must be able to obtain|eligible to obtain|able to obtain)\s+(a\s+)?(public\s+trust|security|secret|ts\/sci)?\s*clearance\b/,
  /\bactive\s+(top[\s-]?secret|public\s+trust|ts\/sci)\b/,
  /\b(requires?|must have|must hold|must possess)\s+(a\s+|an\s+)?(active\s+|current\s+)?(public\s+trust|top[\s-]?secret|ts\/sci)\b/,
  /\btop\s+secret\b/, /\bts\/sci\b/, /\bts\s+sci\b/, /\bts-sci\b/, /\bsecret\s+clearance\b/, /\bdod\s+clearance\b/,
  /\b\(clearance\s+required\)/,
  /\bclearance\b.{0,20}\bus\s+citizen\b/,
  /\bus\s+citizen\b.{0,20}\bclearance\b/,
  // No sponsorship
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
  // Green card / permanent residency
  /\bgreen\s+card\s+(is\s+)?required\b/,
  /\bgc\s+required\b/,
  /\bpermanent\s+resident\s+(is\s+)?required\b/,
]

function isDisqualified(plainText = '') {
  const norm = normalize(plainText)
  return DISQUALIFIER_PATTERNS.some(re => re.test(norm))
}

// ── US LOCATION — rejects foreign-remote, keeps US-remote ───────────────────
function isUSLocation(location = '') {
  if (!location) return false
  const lower = location.toLowerCase()

  const FOREIGN_MARKERS = [
    'emea','apac','latam','anz','international','united kingdom','canada',
    'india','singapore','ireland','germany','australia','france','netherlands',
    'spain','japan','china','brazil','mexico','poland','romania','ukraine',
    'london','toronto','bangalore','dublin','berlin','sydney','paris',
    'amsterdam','tokyo','mumbai','manila','warsaw','tel aviv',
    'europe','asia','africa','oceania','remote international',
    'remote - eu','remote-eu','remote – eu','vienna','austria'
  ]
  
  const hasForeign = FOREIGN_MARKERS.some(m => lower.includes(m))

  const US_MARKERS = [
    'united states', ', us', 'usa', 'u.s.', 'remote - us', 'remote, us',
    'us remote', 'remote (us', 'remote us'
  ]
  const usStates = [
    'alabama','alaska','arizona','arkansas','california','colorado',
    'connecticut','delaware','florida','georgia','hawaii','idaho',
    'illinois','indiana','iowa','kansas','kentucky','louisiana','maine',
    'maryland','massachusetts','michigan','minnesota','mississippi',
    'missouri','montana','nebraska','nevada','new hampshire','new jersey',
    'new mexico','new york','north carolina','north dakota','ohio',
    'oklahoma','oregon','pennsylvania','rhode island','south carolina',
    'south dakota','tennessee','texas','utah','vermont','virginia',
    'washington','west virginia','wisconsin','wyoming','district of columbia',
    'san francisco','los angeles','chicago','seattle','boston','austin',
    'denver','atlanta','miami'
  ]
  const hasUSState = usStates.some(s => lower.includes(s))
  const hasUSMarker = US_MARKERS.some(m => lower.includes(m))

  if (hasUSState || hasUSMarker) return true   // explicit US signal wins
  if (hasForeign) return false                 // foreign, no US signal -> reject
  if (lower.includes('remote')) return true    // bare remote -> default US
  return false
}

// ── Fetch from Greenhouse ───────────────────────────────────────────────────
async function fetchGreenhouseCompany(slug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const data = await res.json()
    return data.jobs || []
  } catch {
    return []
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function fetchAllJobs() {
  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected to MongoDB')

  const slugsPath = path.join(__dirname, 'greenhouse_companies.json')
  const allSlugs = JSON.parse(fs.readFileSync(slugsPath, 'utf-8'))
  console.log(`📋 Loaded ${allSlugs.length} Greenhouse slugs`)

  let saved = 0, skipped = 0, disqualified = 0, nonUS = 0
  const BATCH_SIZE = 10

  for (let i = 0; i < allSlugs.length; i += BATCH_SIZE) {
    const batch = allSlugs.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (slug) => ({ slug, jobs: await fetchGreenhouseCompany(slug) }))
    )

    for (const { slug, jobs } of results) {
      for (const job of jobs) {
        const location  = job.location?.name || ''
        const plainText = stripHtml(job.content || '')

        if (location !== '' && !isUSLocation(location)) { nonUS++; continue }

        const fullText = `${job.title || ''} ${plainText}`
        if (isDisqualified(fullText)) { disqualified++; continue }

        try {
          await Job.findOneAndUpdate(
            { id: String(job.id) },
            {
              id:           String(job.id),
              title:        job.title || '',
              company:      slug.charAt(0).toUpperCase() + slug.slice(1),
              companySlug:  slug,
              location:     location || 'United States',
              isRemote:     location.toLowerCase().includes('remote'),
              description:  plainText.slice(0, 500),
              applyUrl:     job.absolute_url || '',
              postedAt:     job.updated_at ? new Date(job.updated_at) : new Date(),
              sponsorBadge: false,
              ats:          'greenhouse',
              fetchedAt:    new Date()
            },
            { upsert: true, new: true }
          )
          saved++
        } catch {
          skipped++
        }
      }
    }

    if ((i + BATCH_SIZE) % 50 === 0) {
      const done = Math.min(i + BATCH_SIZE, allSlugs.length)
      console.log(`⏳ ${done}/${allSlugs.length} companies | 💾 ${saved} saved | 🚫 ${disqualified} disqualified | 🌍 ${nonUS} non-US`)
    }

    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n✅ Done!`)
  console.log(`   💾 Saved:        ${saved}`)
  console.log(`   🚫 Disqualified: ${disqualified}`)
  console.log(`   🌍 Non-US:       ${nonUS}`)
  console.log(`   ⚠️  DB errors:    ${skipped}`)

  await mongoose.disconnect()
  console.log('🔌 Disconnected from MongoDB')
}

fetchAllJobs().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})