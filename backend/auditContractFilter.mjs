import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const CONTRACT_FALSE_POSITIVES = [
  /\bsmart\s+contract/, /\bgovernment\s+contracts?\b/, /\bcontract\s+negotiations?\b/,
  /\bcontract\s+law\b/, /\bcontract\s+review\b/, /\bmanag(e|ing)\s+contracts?\b/,
  /\bdrafting\s+contracts?\b/, /\bcontract\s+management\b/, /\bcontract\s+compliance\b/,
  /\b(roofing|general|licensed|preferred|certified)\s+contractors?\b/,
]
function isContractOrPartTime(plainText = '', title = '') {
  const t = (title + ' ' + plainText).toLowerCase()
  if (/\([^)]*\bcontracts?\b[^)]*\)/i.test(title)) return { hidden: true, reason: 'title parenthetical' }
  const ptMatch = t.match(/\bpart[\s-]?time\b/)
  if (ptMatch) {
    const idx = ptMatch.index
    const window = t.slice(Math.max(0, idx - 25), idx + ptMatch[0].length + 25)
    if (!/\bfull[\s-]?time\b/.test(window)) return { hidden: true, reason: 'part-time' }
  }
  const hasFalsePositive = CONTRACT_FALSE_POSITIVES.some(re => re.test(t))
  if (hasFalsePositive) return { hidden: false, reason: null }
  const triggerMatch = t.match(/\b(contractors?|temporary|temp position|fixed[\s-]?term)\b/)
  if (triggerMatch) {
    const idx = triggerMatch.index
    const window = t.slice(Math.max(0, idx - 50), idx + triggerMatch[0].length + 50)
    if (/\bpermanent\b/.test(window)) return { hidden: false, reason: null }
    return { hidden: true, reason: 'contractor/temp' }
  }
  if (/\bcontract\s+(position|role|basis|engagement|assignment)\b/.test(t)) return { hidden: true, reason: 'contract position (adjacent)' }
  return { hidden: false, reason: null }
}

async function fetchCompany(slug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const data = await res.json()
    return data.jobs || []
  } catch { return [] }
}

async function main() {
  const slugsPath = path.join(__dirname, 'greenhouse_companies.json')
  const allSlugs = JSON.parse(fs.readFileSync(slugsPath, 'utf-8'))
  const sample = allSlugs.slice(0, 60)

  let totalChecked = 0
  const hiddenJobs = []
  const suspiciousKept = []

  console.log(`Checking ${sample.length} companies live from Greenhouse...\n`)

  for (const slug of sample) {
    const jobs = await fetchCompany(slug)
    for (const job of jobs) {
      totalChecked++
      const plainText = stripHtml(job.content || '')
      const result = isContractOrPartTime(plainText, job.title)

      if (result.hidden) {
        hiddenJobs.push({ company: slug, title: job.title, reason: result.reason })
      } else {
        const titleLower = job.title.toLowerCase()
        if (/\b(contract|contractor|temp|temporary|part-?time)\b/.test(titleLower)) {
          suspiciousKept.push({ company: slug, title: job.title })
        }
      }
    }
    await new Promise(r => setTimeout(r, 150))
  }

  console.log(`\n═══════════════════════════════════════════`)
  console.log(`Total jobs checked: ${totalChecked}`)
  console.log(`═══════════════════════════════════════════\n`)

  console.log(`── HIDDEN BY FILTER (${hiddenJobs.length}) ──`)
  hiddenJobs.forEach(j => console.log(`  [${j.company}] ${j.title}  (reason: ${j.reason})`))

  console.log(`\n── TITLE SAYS CONTRACT/TEMP/PART-TIME BUT FILTER DID NOT HIDE (${suspiciousKept.length}) ──`)
  if (suspiciousKept.length === 0) console.log('  None found.')
  else suspiciousKept.forEach(j => console.log(`  [${j.company}] ${j.title}`))

  console.log('\n🔌 Done.')
}

main()