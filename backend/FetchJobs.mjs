import mongoose from 'mongoose'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── MongoDB Job Schema ──────────────────────────────────────────────────────
const jobSchema = new mongoose.Schema({
  id:              { type: String, unique: true },
  title:           String,
  company:         String,
  companySlug:     String,
  location:        String,
  isRemote:        Boolean,
  description:     String,
  applyUrl:        String,
  postedAt:        Date,
  sponsorBadge:    Boolean,
  ats:             String,
  fetchedAt:       { type: Date, default: Date.now },
  experienceLevel: String,
  workType:        String,
  state:           String,
  salaryMin:       Number,
  salaryMax:       Number,
  employmentType:  String,
  yearsMin:        Number,
  yearsMax:        Number,
})

const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

// ── HTML handling ────────────────────────────────────────────────────────
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

// ── CITIZENSHIP / CLEARANCE / SPONSORSHIP DISQUALIFIERS ─────────────────────
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
  /\bclearance\s*:\s*(active\s+|current\s+|ability to obtain\s+|able to obtain\s+)?(a\s+)?(top[\s-]?secret|secret|public\s+trust|ts\/sci|ts-sci|ts\s+sci)\b/,
  /\bclearance\s+required\b/,
  /\bpublic\s+trust\s+(clearance|required)\b/,
  /\b(ability to obtain|must be able to obtain|eligible to obtain|able to obtain)\s+(a\s+)?(public\s+trust|security|secret|ts\/sci)?\s*clearance\b/,
  /\bactive\s+(top[\s-]?secret|public\s+trust|ts\/sci)\b/,
  /\b(requires?|must have|must hold|must possess)\s+(a\s+|an\s+)?(active\s+|current\s+)?(public\s+trust|top[\s-]?secret|ts\/sci)\b/,
  /\btop\s+secret\b/, /\bts\/sci\b/, /\bts\s+sci\b/, /\bts-sci\b/, /\bsecret\s+clearance\b/, /\bdod\s+clearance\b/,
  // Catch-all clearance patterns — "obtain and maintain", filler words, bare mention (aggressive by design)
  /\bsecurity\s+clearance\b/,
  /\b(obtain|maintain|hold|possess|acquire|eligible|able|ability|require|requires|required)\b[^.]{0,40}\bsecurity\s+clearance\b/,
  /\b(obtain|maintain)\b[^.]{0,30}\bclearance\b/,
  /\bsecurity\s+clearance\b[^.]{0,40}\b(required|is required|must|eligib)/,
  /\b\(clearance\s+required\)/,
  /\bclearance\b.{0,20}\bus\s+citizen\b/,
  /\bus\s+citizen\b.{0,20}\bclearance\b/,
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
  /\bgreen\s+card\s+(is\s+)?required\b/,
  /\bgc\s+required\b/,
  /\bpermanent\s+resident\s+(is\s+)?required\b/,
  /\bmust\s+be\s+(us\s+|u s\s+|united states\s+)?citizens?\b/,
  /\bcitizens?\s+or\s+(lawful\s+)?permanent\s+residents?\b/,
  /\bpermanent\s+residents?\s+or\s+citizens?\b/,
  /\b(must\s+not|not|does\s+not|will\s+not|cannot|can not)\s+require\s+(visa\s+)?sponsorship\b/,
  /\bsponsorship\s+(now\s+or\s+in\s+the\s+future|in\s+the\s+future)\b/,
  /\bmust\s+be\s+a?\s*(lawful\s+)?permanent\s+residents?\b/,
]

function isDisqualified(plainText = '') {
  const norm = normalize(plainText)
  return DISQUALIFIER_PATTERNS.some(re => re.test(norm))
}

// ── CONTRACT / PART-TIME DISQUALIFIER (hardened against false positives) ───
// Multiple rounds of real-data auditing (60 live Greenhouse companies, 501 jobs)
// found several false-positive traps this needed guarding against:
//  - "contractor"/"contract" used as a business/industry term ("Preferred Contractor",
//    "roofing contractors", "government contracts", "smart contract")
//  - Greenhouse form-field leaks: "Job Type (Permanent, fixed term, internship) Permanent"
//    lists ALL possible dropdown options, with "Permanent" as the actual selected value
//  - Benefits-eligibility exclusion clauses: "temporary or intern roles will not be
//    eligible for [benefit]" describes OTHER workers' eligibility, not this job's type
//  - Blanket company policy statements: "Benefits vary for full-time/part-time
//    employment" or "we offer part-time opportunities where possible" describe general
//    company policy/culture, not a declaration that THIS specific role is part-time
const CONTRACT_FALSE_POSITIVES = [
  /\bsmart\s+contract/, /\bgovernment\s+contracts?\b/, /\bcontract\s+negotiations?\b/,
  /\bcontract\s+law\b/, /\bcontract\s+review\b/, /\bmanag(e|ing)\s+contracts?\b/,
  /\bdrafting\s+contracts?\b/, /\bcontract\s+management\b/, /\bcontract\s+compliance\b/,
  /\b(roofing|general|licensed|preferred|certified)\s+contractors?\b/,
]
function isContractOrPartTime(plainText = '', title = '') {
  const t = (title + ' ' + plainText).toLowerCase()

  if (/\([^)]*\bcontracts?\b[^)]*\)/i.test(title)) return true

  const ptMatch = t.match(/\bpart[\s-]?time\b/)
  if (ptMatch) {
    const idx = ptMatch.index
    const window = t.slice(Math.max(0, idx - 25), idx + ptMatch[0].length + 30)
    const isBlanketPolicy = /\bfull[\s-]?time\b/.test(window) || /\bopportunities\b/.test(window)
    if (!isBlanketPolicy) return true
  }

  const hasFalsePositive = CONTRACT_FALSE_POSITIVES.some(re => re.test(t))
  if (hasFalsePositive) return false

  const triggerMatch = t.match(/\b(contractors?|temporary|temp position|fixed[\s-]?term)\b/)
  if (triggerMatch) {
    const idx = triggerMatch.index
    const window = t.slice(Math.max(0, idx - 60), idx + triggerMatch[0].length + 60)
    if (/\bpermanent\b/.test(window)) return false
    if (/\b(eligible|will not)\b/.test(window)) return false
    return true
  }

  if (/\bcontract\s+(position|role|basis|engagement|assignment)\b/.test(t)) return true
  return false
}

// ── US LOCATION ──────────────────────────────────────────────────────────
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
  const US_MARKERS = ['united states', ', us', 'usa', 'u.s.', 'remote - us', 'remote, us', 'us remote', 'remote (us', 'remote us']
  const usStates = [
    'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
    'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
    'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
    'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
    'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
    'wisconsin','wyoming','district of columbia','san francisco','los angeles','chicago','seattle','boston',
    'austin','denver','atlanta','miami'
  ]
  const hasUSState = usStates.some(s => lower.includes(s))
  const hasUSMarker = US_MARKERS.some(m => lower.includes(m))
  if (hasUSState || hasUSMarker) return true
  if (hasForeign) return false
  if (lower.includes('remote')) return true
  return false
}

// ── EXPERIENCE LEVEL (from title) ───────────────────────────────────────────
function detectExperienceLevel(title = '') {
  const t = title.toLowerCase()
  if (/\b(director|vp|vice president|head of|principal)\b/.test(t)) return 'Director'
  if (/\bstaff\b/.test(t)) return 'Staff'
  if (/\b(senior|sr|lead)\b/.test(t)) return 'Senior'
  if (/\b(intern|internship|co-?op)\b/.test(t)) return 'Internship'
  if (/\b(entry|junior|jr|new grad|graduate|associate)\b/.test(t)) return 'Entry'
  if (/\b(engineer|analyst|specialist|developer|coordinator|manager)\s+i\b/.test(t)) return 'Entry'
  if (/\b(engineer|analyst|specialist|developer|coordinator|manager)\s+1\b/.test(t)) return 'Entry'
  return 'Mid'
}

// ── WORK TYPE ────────────────────────────────────────────────────────────
function detectWorkType(location = '', description = '') {
  const loc = location.toLowerCase()
  const descHead = description.toLowerCase().slice(0, 600)
  if (/\bhybrid\b/.test(loc) || /\bhybrid\b/.test(descHead)) return 'Hybrid'
  if (loc.includes('remote')) return 'Remote US'
  return 'Onsite'
}

// ── STATE EXTRACTION (all 50 states + DC, full names + abbreviations) ──────
const US_STATES_FULL = {
  'alabama':'Alabama','alaska':'Alaska','arizona':'Arizona','arkansas':'Arkansas','california':'California',
  'colorado':'Colorado','connecticut':'Connecticut','delaware':'Delaware','florida':'Florida','georgia':'Georgia',
  'hawaii':'Hawaii','idaho':'Idaho','illinois':'Illinois','indiana':'Indiana','iowa':'Iowa','kansas':'Kansas',
  'kentucky':'Kentucky','louisiana':'Louisiana','maine':'Maine','maryland':'Maryland','massachusetts':'Massachusetts',
  'michigan':'Michigan','minnesota':'Minnesota','mississippi':'Mississippi','missouri':'Missouri','montana':'Montana',
  'nebraska':'Nebraska','nevada':'Nevada','new hampshire':'New Hampshire','new jersey':'New Jersey','new mexico':'New Mexico',
  'new york':'New York','north carolina':'North Carolina','north dakota':'North Dakota','ohio':'Ohio',
  'oklahoma':'Oklahoma','oregon':'Oregon','pennsylvania':'Pennsylvania','rhode island':'Rhode Island',
  'south carolina':'South Carolina','south dakota':'South Dakota','tennessee':'Tennessee','texas':'Texas',
  'utah':'Utah','vermont':'Vermont','virginia':'Virginia','washington':'Washington','west virginia':'West Virginia',
  'wisconsin':'Wisconsin','wyoming':'Wyoming','district of columbia':'District of Columbia',
}
const STATE_ABBR = {
  'al':'Alabama','ak':'Alaska','az':'Arizona','ar':'Arkansas','ca':'California','co':'Colorado','ct':'Connecticut',
  'de':'Delaware','fl':'Florida','ga':'Georgia','hi':'Hawaii','id':'Idaho','il':'Illinois','in':'Indiana','ia':'Iowa',
  'ks':'Kansas','ky':'Kentucky','la':'Louisiana','me':'Maine','md':'Maryland','ma':'Massachusetts','mi':'Michigan',
  'mn':'Minnesota','ms':'Mississippi','mo':'Missouri','mt':'Montana','ne':'Nebraska','nv':'Nevada','nh':'New Hampshire',
  'nj':'New Jersey','nm':'New Mexico','ny':'New York','nc':'North Carolina','nd':'North Dakota','oh':'Ohio',
  'ok':'Oklahoma','or':'Oregon','pa':'Pennsylvania','ri':'Rhode Island','sc':'South Carolina','sd':'South Dakota',
  'tn':'Tennessee','tx':'Texas','ut':'Utah','vt':'Vermont','va':'Virginia','wa':'Washington','wv':'West Virginia',
  'wi':'Wisconsin','wy':'Wyoming','dc':'District of Columbia',
}
function extractState(location = '') {
  const lower = location.toLowerCase()
  for (const [key, full] of Object.entries(US_STATES_FULL)) {
    if (new RegExp(`\\b${key}\\b`).test(lower)) return full
  }
  for (const [abbr, full] of Object.entries(STATE_ABBR)) {
    if (new RegExp(`(^|,\\s*|\\s)${abbr}(\\s*,|\\s*$)`).test(lower)) return full
  }
  return null
}

// ── SALARY EXTRACTION ────────────────────────────────────────────────────
function extractSalary(text = '') {
  const patterns = [
    /\$\s?(\d{2,3}(?:,\d{3})+)\s?[-–—]\s?\$?\s?(\d{2,3}(?:,\d{3})+)/,
    /(\d{2,3}(?:,\d{3})+)\s?[-–—]\s?(\d{2,3}(?:,\d{3})+)\s?(?:USD|usd)\b/,
    /\$\s?(\d{2,3})[kK]\s?[-–—]\s?\$?\s?(\d{2,3})[kK]\b/,
    /\$\s?(\d{2,3}(?:,\d{3})+)\s+to\s+\$?\s?(\d{2,3}(?:,\d{3})+)/,
  ]
  const salaryContext = /\b(salary|compensation|pay range|base pay|annual salary|base salary|total compensation|salary range|\/\s?year|per year)\b/i
  const notSalaryContext = /\b(raised|funding|valuation|revenue|series [a-e]|investment|market size|arr|assets under management|aum)\b/i

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const idx = match.index
    const window = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + match[0].length + 80))
    if (notSalaryContext.test(window) && !salaryContext.test(window)) continue

    let low = match[1].replace(/,/g, '')
    let high = match[2].replace(/,/g, '')
    if (/[kK]$/i.test(match[0].trim().split(/[-–—]/)[1] || '') || parseInt(low) < 1000) {
      low = String(parseInt(low) * 1000)
      high = String(parseInt(high) * 1000)
    }
    low = parseInt(low); high = parseInt(high)
    if (low < 20000 || high > 1000000 || low > high) continue
    return { min: low, max: high }
  }
  return null
}

// ── EMPLOYMENT TYPE (display tag) ────────────────────────────────────────
// Only checks for "Full-time" — by the time a job reaches this function, it has
// already passed isContractOrPartTime() above, meaning any genuine contract/temp/
// part-time signal already caused it to be hidden. Previously this duplicated
// that detection with older, unguarded patterns, which could show a wrong
// "Contract" tag on a job the improved hiding logic had already correctly kept.
function detectEmploymentType(text = '') {
  const t = text.toLowerCase()
  if (/\bfull[\s-]?time\b/.test(t)) return 'Full-time'
  return null
}

// ── YEARS OF EXPERIENCE ──────────────────────────────────────────────────
function extractYearsExperience(text = '') {
  const patterns = [
    { re: /(\d{1,2})\s*-\s*(\d{1,2})\s*\+?\s*years?\b/i, type: 'range' },
    { re: /(\d{1,2})\+\s*years?\b/i, type: 'plus' },
    { re: /(?:minimum|at least)\s*(?:of\s*)?(\d{1,2})\s*years?\b/i, type: 'plus' },
  ]
  const expContext = /\b(experience|exp\b|background|similar role|in this field|working in|industry experience|relevant experience)\b/i
  const notExpContext = /\b(founded|established|in business|company history|since \d{4}|anniversary|celebrating|been around|has been|have been|for more than|for over)\b/i

  for (const { re, type } of patterns) {
    const match = text.match(re)
    if (!match) continue
    const idx = match.index
    const window = text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + match[0].length + 60))
    if (notExpContext.test(window) && !expContext.test(window)) continue

    const min = parseInt(match[1])
    const max = type === 'range' ? parseInt(match[2]) : min
    // Sanity ceiling — same pattern as extractSalary's $20k-$1M bound.
    // Blocks demographic ranges ("18-55" age) and any stray >15 that slips
    // past the context guard above. 15+ isn't relevant to F1/OPT students anyway.
    if (min > 15 || max > 15) continue

    return type === 'range' ? { min, max } : { min, max: null }
  }
  return null
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

  let saved = 0, skipped = 0, disqualified = 0, nonUS = 0, contractOrPartTime = 0
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
        if (isContractOrPartTime(plainText, job.title || '')) { contractOrPartTime++; continue }

        const companyName = slug.charAt(0).toUpperCase() + slug.slice(1)
        const experienceLevel = detectExperienceLevel(job.title || '')
        const workType = detectWorkType(location, plainText)
        const state = extractState(location)
        const salary = extractSalary(plainText)
        const employmentType = detectEmploymentType(plainText)
        const years = extractYearsExperience(plainText)

        try {
          await Job.findOneAndUpdate(
            { id: String(job.id) },
            {
              id:              String(job.id),
              title:           job.title || '',
              company:         companyName,
              companySlug:     slug,
              location:        location || 'United States',
              isRemote:        location.toLowerCase().includes('remote'),
              description:     plainText.slice(0, 500),
              applyUrl:        job.absolute_url || '',
              postedAt:        job.updated_at ? new Date(job.updated_at) : new Date(),
              sponsorBadge:    false,
              ats:             'greenhouse',
              fetchedAt:       new Date(),
              experienceLevel,
              workType,
              state,
              salaryMin:       salary ? salary.min : null,
              salaryMax:       salary ? salary.max : null,
              employmentType,
              yearsMin:        years ? years.min : null,
              yearsMax:        years ? years.max : null,
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
      console.log(`⏳ ${done}/${allSlugs.length} companies | 💾 ${saved} saved | 🚫 ${disqualified} disqualified | 📋 ${contractOrPartTime} contract/part-time | 🌍 ${nonUS} non-US`)
    }

    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n✅ Done!`)
  console.log(`   💾 Saved:              ${saved}`)
  console.log(`   🚫 Disqualified:       ${disqualified}`)
  console.log(`   📋 Contract/Part-time: ${contractOrPartTime}`)
  console.log(`   🌍 Non-US:             ${nonUS}`)
  console.log(`   ⚠️  DB errors:          ${skipped}`)

  await mongoose.disconnect()
  console.log('🔌 Disconnected from MongoDB')
}

fetchAllJobs().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})