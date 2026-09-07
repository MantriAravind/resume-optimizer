// FILTER FALSE-POSITIVE AUDIT — the systematic version of the jobright moment.
// Pulls FULL descriptions in bulk from real company boards (Greenhouse +
// Ashby list endpoints), runs every fresh US job through each disqualifier
// pattern INDIVIDUALLY plus the contract/PT gate, and reports per pattern:
// kills, companies, sample titles + matched snippets. Mainstream titles under
// a pattern = a 401k-class bug. Refusal boilerplate = pattern working.
//   node patternAudit.mjs --gh 120 --ashby 120     (~240 boards, a few minutes)
import fs from 'fs'
import { DISQUALIFIER_PATTERNS, stripHtml, isUSLocation, isContractOrPartTime } from './FetchJobs.mjs'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? Number(process.argv[i + 1]) : d }
const N_GH = arg('--gh', 120), N_ASHBY = arg('--ashby', 120)
const cutoff = Date.now() - 30 * 864e5
const sleep = ms => new Promise(r => setTimeout(r, ms))

const ghBoards = fs.readFileSync('companies.txt', 'utf-8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).slice(0, N_GH)
const ashbyBoards = fs.readFileSync('ashby_boards.txt', 'utf-8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).slice(0, N_ASHBY)

const stats = new Map()  // patternSource -> {kills, companies:Set, samples:[]}
let contractStats = { kills: 0, companies: new Set(), samples: [] }
let scanned = 0, boardsOk = 0

function judge(title, fullText, company) {
  const text = `${title}\n${fullText}`
  for (const re of DISQUALIFIER_PATTERNS) {
    const m = text.match(re)
    if (m) {
      const k = re.source.slice(0, 70)
      const s = stats.get(k) || { kills: 0, companies: new Set(), samples: [] }
      s.kills++; s.companies.add(company)
      if (s.samples.length < 8) {
        const i = m.index || 0
        s.samples.push(`${title} [${company}]  →  "...${text.slice(Math.max(0, i - 45), i + (m[0]?.length || 10) + 45).replace(/\s+/g, ' ').trim()}..."`)
      }
      stats.set(k, s)
      return
    }
  }
  if (isContractOrPartTime(fullText, title)) {
    contractStats.kills++; contractStats.companies.add(company)
    if (contractStats.samples.length < 40) {
      // capture WHICH trigger fired and its judgment window — the evidence
      const t = (title + ' ' + fullText).toLowerCase().replace(/https?:\/\/\S+/g, ' ')
      const trig = t.match(/\bpart[\s-]?time\b/) || t.match(/\b(contractors?|temporary|temp position|fixed[\s-]?term)\b/) || t.match(/\bcontract\s+(position|role|basis|engagement|assignment)\b/) || t.match(/\bprn\b/)
      const i = trig ? trig.index : -1
      const win = i > -1 ? `[${trig[0]}] ...${t.slice(Math.max(0, i - 65), i + trig[0].length + 65).replace(/\s+/g, ' ')}...` : '(field-format or title rule)'
      contractStats.samples.push(`${title} [${company}]\n    ${win}`)
    }
  }
}

for (const b of ghBoards) {
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`, { signal: AbortSignal.timeout(25000) })
    if (!r.ok) continue
    boardsOk++
    for (const j of ((await r.json()).jobs || [])) {
      const posted = new Date(j.first_published || j.updated_at || 0)
      if (posted < cutoff) continue
      const loc = j.location?.name || ''
      if (!loc || !isUSLocation(loc)) continue
      scanned++
      judge(j.title || '', stripHtml(String(j.content || '')), b)
    }
    await sleep(120)
  } catch {}
}
for (const b of ashbyBoards) {
  try {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${b}`, { signal: AbortSignal.timeout(25000) })
    if (!r.ok) continue
    boardsOk++
    for (const j of ((await r.json()).jobs || [])) {
      if (j.isListed === false) continue
      const posted = new Date(j.publishedAt || 0)
      if (posted < cutoff) continue
      const loc = [j.location, ...(j.secondaryLocations || []).map(s => s.location)].filter(Boolean).join(' · ')
      if (!loc || !isUSLocation(loc)) continue
      scanned++
      judge(j.title || '', String(j.descriptionPlain || ''), b)
    }
    await sleep(120)
  } catch {}
}

let rep = `# Filter false-positive audit — ${new Date().toISOString().slice(0, 16)}\nboards ${boardsOk} · fresh US jobs scanned ${scanned}\n\n## Disqualifier patterns, by kills\n`
for (const [k, s] of [...stats.entries()].sort((a, b) => b[1].kills - a[1].kills)) {
  rep += `\n### ${s.kills} kills · ${s.companies.size} companies · /${k}/\n`
  for (const x of s.samples) rep += `- ${x}\n`
}
rep += `\n## Contract/part-time gate — ${contractStats.kills} kills · ${contractStats.companies.size} companies\n`
for (const x of contractStats.samples) rep += `- ${x}\n`
fs.writeFileSync('filter-audit.md', rep)
console.log(`boards ${boardsOk} · scanned ${scanned} · disqualifier patterns fired: ${stats.size} · contract kills: ${contractStats.kills}`)
console.log('📄 filter-audit.md — read EVERY pattern\'s samples. Mainstream titles = bug.')
process.exit(0)
