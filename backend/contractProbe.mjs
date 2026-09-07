// Prints WHY the contract/PT gate kills each job at the audit-flagged companies:
// which trigger word, and the exact ±70-char window it judged.
//   node contractProbe.mjs
import { stripHtml, isUSLocation, isContractOrPartTime } from './FetchJobs.mjs'
const BOARDS = { gh: ['2K', 'AfterQuery', 'Antares', 'Crusoe', '1x', '10Beauty'], ashby: [] }
const cutoff = Date.now() - 30 * 864e5
const TRIGGERS = [/\bpart[\s-]?time\b/, /\b(contractors?|temporary|temp position|fixed[\s-]?term)\b/, /\bcontract\s+(position|role|basis|engagement|assignment)\b/]

for (const b of BOARDS.gh) {
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${b.toLowerCase()}/jobs?content=true`, { signal: AbortSignal.timeout(25000) })
    if (!r.ok) { console.log('board fail:', b, r.status); continue }
    for (const j of ((await r.json()).jobs || [])) {
      if (new Date(j.first_published || 0) < cutoff) continue
      const loc = j.location?.name || ''
      if (!loc || !isUSLocation(loc)) continue
      const plain = stripHtml(String(j.content || ''))
      if (!isContractOrPartTime(plain, j.title || '')) continue
      console.log(`\n❌ ${j.title} [${b}]`)
      const t = ((j.title || '') + ' ' + plain).toLowerCase().replace(/https?:\/\/\S+/g, ' ')
      for (const re of TRIGGERS) {
        let m, rx = new RegExp(re.source, 'gi')
        while ((m = rx.exec(t)) && rx.lastIndex < 1e6) {
          console.log(`   [${m[0]}] ...${t.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70).replace(/\s+/g, ' ')}...`)
          if (m.index === rx.lastIndex) rx.lastIndex++
        }
      }
    }
  } catch (e) { console.log('board error:', b, e.message) }
}
process.exit(0)
