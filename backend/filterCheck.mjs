// filterCheck.mjs ── Sponsorship-filter spot-check / leak finder
//
// WHY THIS EXISTS
// The board's whole promise is "every job here is safe for an F1/OPT student to
// apply to." That promise rests entirely on the disqualifier filter in
// FetchJobs.mjs, and that filter has leaked before (the ITAR gap: one hand-checked
// job revealed 3,300 leaks). This tool finds leaks automatically instead of by
// hand, and surfaces over-blocking (false positives) at the same time.
//
// WHY IT FETCHES FRESH INSTEAD OF READING THE DATABASE
// The DB can't be used for this audit: disqualified jobs are never saved, and
// passed jobs keep only the first 500 chars of description — but citizenship /
// clearance / sponsorship language usually sits near the END of a posting, past
// that cut. So the exact text we're hunting isn't in Mongo. We re-fetch a small
// random sample with FULL text and run the real filter on it.
//
// NO DRIFT
// Every filter function is imported from FetchJobs.mjs — never copied. This audit
// physically cannot test a different filter than the one that ships.
//
// RUN
//   node filterCheck.mjs                            # sample 25 random companies
//   node filterCheck.mjs 60                         # sample 60 random companies
//   node filterCheck.mjs anduril,palantir,shield-ai # check specific companies
// Writes filter-report.md next to this file and prints a summary.

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  stripHtml,
  normalize,
  isUSLocation,
  classifyLocation,
  isDisqualified,
  isContractOrPartTime,
  fetchGreenhouseCompany,
  DISQUALIFIER_PATTERNS,
} from './FetchJobs.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── RED-FLAG KEYWORDS ────────────────────────────────────────────────────────
// Words that hint at a restriction. DELIBERATELY over-inclusive: this tool's job
// is to cut hundreds of postings down to a handful worth reading, not to be
// precise. Expect benign hits ("sponsor a meetup", "export to CSV") — you make the
// final call. If any single line floods the report with noise, delete that line.
// The categories the handoff flagged to audit are all here: public trust,
// polygraph, federal-contractor, agency-specific (DoD/DoE/NASA), CFR/USC cites.
const RED_FLAGS = [
  { label: 'citizen',            re: /\bcitizen(ship)?\b/ },
  { label: 'clearance',          re: /\bclearance\b/ },
  { label: 'secret / ts-sci',    re: /\b(top\s+secret|secret\s+clearance|ts\/sci|ts-sci)\b/ },
  { label: 'visa sponsorship',   re: /\b(visa|h-?1b|opt|cpt|stem\s+opt|immigration|work\s+authoriz\w*|green\s+card|employment\s+authoriz\w*)\b[^.]{0,40}\bsponsor|\bsponsor(ship|ing|ed)?\b[^.]{0,40}\b(visa|h-?1b|opt|cpt|stem\s+opt|immigration|work\s+authoriz\w*|green\s+card|employment\s+authoriz\w*)\b/ },
  { label: 'green card',         re: /\bgreen\s+card\b/ },
  { label: 'permanent resident', re: /\bpermanent\s+resident/ },
  { label: 'ITAR / export-ctrl', re: /\b(itar|export[\s-]?control|ear\s+controlled|export\s+administration)/ },
  // (generic 'export' flag removed — pure noise; the ITAR / export-ctrl flag above still catches the real ones)
  { label: 'u.s. person',        re: /\b(u\.?\s?s\.?|united\s+states)\s+persons?\b/ },
  { label: 'polygraph',          re: /\bpolygraph\b/ },
  { label: 'public trust',       re: /\bpublic\s+trust\b/ },
  { label: 'naturalized',        re: /\bnaturaliz/ },
  { label: 'federal (agency)',   re: /\bfederal\s+(contract|government|agenc|background|clearance|employ|facilit)/ },
  { label: 'defense agency',     re: /\b(dod|department\s+of\s+defense|department\s+of\s+energy|nasa|intelligence\s+community)\b/ },
  { label: 'CFR / USC cite',     re: /\b\d{1,2}\s+(cfr|u\.?s\.?c\.?)\b/ },
]

// ── "LOOKS US" CHECK (audit-only) ────────────────────────────────────────────
// isUSLocation() in FetchJobs.mjs matches full state names and ~15 major cities,
// but NOT the bare 2-letter state in "City, VA" form. So a US job posted that way
// gets dropped as non-US. This helper (audit-only, NOT the shipping filter) catches
// that format, so the report can show which "non-US" jobs actually look US and are
// probably being thrown away. Note: a few foreign 2-letter codes collide with state
// abbreviations (e.g. "Berlin, DE" — DE is also Delaware), so eyeball the list.
const US_STATE_ABBRS = ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc']
export function looksUS(location = '') {
  const lower = location.toLowerCase()
  if (/\b(usa|u\.?s\.?a\.?|united\s+states)\b/.test(lower)) return true
  for (const ab of US_STATE_ABBRS) {
    if (new RegExp(`(^|,\\s*|\\s)${ab}(\\s*,|\\s*$)`).test(lower)) return true
  }
  return false
}

// ── "LOOKS FOREIGN" CHECK (audit-only, watch-list) ───────────────────────────
// After the isUSLocation fix, a foreign city NOT in isUSLocation's foreign list,
// written with a 2-letter code that collides with a US state (e.g. "Munich, DE",
// "Calgary, CA"), can slip through as US. This broader list flags such passed jobs
// for review. Low stakes (a student just skips a foreign job), but worth watching.
// Curated to avoid the most common small US towns that share a foreign city name.
const FOREIGN_CITY_HINTS = [
  // countries
  'canada','united kingdom','india','germany','france','ireland','australia','singapore',
  'netherlands','spain','portugal','sweden','norway','denmark','finland','switzerland',
  'belgium','austria','poland','romania','ukraine','turkey','israel','united arab emirates',
  'saudi arabia','egypt','nigeria','kenya','south africa','argentina','chile','colombia',
  'brazil','mexico','japan','china','south korea','taiwan','hong kong','thailand','vietnam',
  'malaysia','indonesia','philippines','pakistan','bangladesh','sri lanka','new zealand',
  // cities (low US-collision)
  'london','manchester','edinburgh','glasgow','dublin','toronto','vancouver','montreal',
  'calgary','ottawa','edmonton','winnipeg','bengaluru','bangalore','hyderabad','chennai',
  'mumbai','pune','gurgaon','gurugram','noida','kolkata','ahmedabad','new delhi','munich',
  'frankfurt','hamburg','cologne','stuttgart','dusseldorf','sydney','melbourne','brisbane',
  'perth','adelaide','amsterdam','rotterdam','madrid','barcelona','lisbon','porto','stockholm',
  'gothenburg','copenhagen','oslo','helsinki','zurich','geneva','brussels','prague','warsaw',
  'krakow','budapest','bucharest','istanbul','dubai','abu dhabi','riyadh','doha','cairo',
  'lagos','nairobi','tel aviv','tokyo','osaka','shanghai','beijing','shenzhen','guangzhou',
  'hangzhou','seoul','taipei','bangkok','jakarta','manila','kuala lumpur','sao paulo',
  'buenos aires','santiago','bogota','montevideo','auckland','wellington',
]
function looksForeign(location = '') {
  const lower = location.toLowerCase()
  if (/\bremote\b[\s\-–—,()\/|]*\b(eu|uk|apac|emea|latam|anz|europe|asia|africa|india|brazil|canada|mexico|ireland|germany|france|spain|italy|poland|ukraine|australia|singapore|japan|china|philippines|latin\s+america|middle\s+east|united\s+kingdom)\b/.test(lower)) return 'remote-foreign'
  for (const hint of FOREIGN_CITY_HINTS) {
    if (new RegExp('\\b' + hint + '\\b').test(lower)) return hint
  }
  return null
}

// Caps keep the report readable. Raise MAX_SUSPICIOUS if you want to see them all.
const MAX_SUSPICIOUS    = 60   // passed-but-flagged jobs to print
const MAX_DISQUALIFIED  = 15   // blocked jobs to sample (false-positive hunt)
const MAX_FLAGS_PER_JOB = 3
const DEFAULT_SAMPLE    = 25
const MAX_NONUS_LOOKS_US = 40  // "non-US but looks US" jobs to print (wrongly dropped)
const MAX_NONUS_OTHER    = 15  // genuinely-foreign sample, for a sanity check
const MAX_FOREIGN_SLIPS  = 40  // passed-but-looks-foreign jobs to print (watch-list)

// ── PURE HELPERS (no network — unit-testable) ────────────────────────────────

// A short, readable snippet of the ORIGINAL text around a match index.
function snippet(original, index, matchLen = 0, pad = 55) {
  const start = Math.max(0, index - pad)
  const end   = Math.min(original.length, index + matchLen + pad)
  let s = original.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '…' + s
  if (end < original.length) s = s + '…'
  return s
}

// Which red flags a passed job contains, with context for each (distinct labels).
// Equal-opportunity boilerplate ("we do not discriminate on the basis of race, religion,
// alienage or citizenship status...") is the OPPOSITE of a restriction, but it contains
// the same words. One company's standard footer used to fill 39 of 50 slots in the
// suspicious list and buried a real leak underneath. These phrases mark that context.
const EEO_CONTEXT = [
  'without regard to', 'regardless of', 'equal opportunity', 'equal employment',
  'does not discriminate', 'do not discriminate', 'discriminat', 'protected veteran',
  'affirmative action', 'genetic information', 'gender identity', 'sexual orientation',
  'marital status', 'alienage', 'protected characteristic', 'protected by federal',
  'protected class', 'eeo', 'diversity, equity',
]

// Is the match sitting inside an anti-discrimination sentence? Looks at a window either
// side, since the list of protected classes can be long.
function inEEOContext(lower, index, matchLen) {
  // Sentence-bounded, not a fixed window: a real requirement often sits right after the
  // EEO paragraph ("...we do not discriminate. This role requires U.S. citizenship."),
  // and a wide window would swallow both and hide the real one.
  const before = lower.slice(Math.max(0, index - 400), index)
  const startRel = Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n'),
                            before.lastIndexOf(';'), before.lastIndexOf('•'))
  const from = startRel === -1 ? Math.max(0, index - 400) : index - (before.length - startRel) + 1
  const rest = lower.slice(index + matchLen, index + matchLen + 400)
  const endRel = rest.search(/[.\n;•]/)
  const to = endRel === -1 ? Math.min(lower.length, index + matchLen + 400) : index + matchLen + endRel
  const sentence = lower.slice(Math.max(0, from), to)
  return EEO_CONTEXT.some(p => sentence.includes(p))
}

// Flags where boilerplate is the usual false positive. A real requirement elsewhere in
// the posting still fires — we skip the flag only if EVERY mention is boilerplate.
const EEO_PRONE = new Set(['citizen', 'federal (agency)'])

export function scanRedFlags(plainText = '') {
  const lower = plainText.toLowerCase()
  const hits = []
  const seen = new Set()
  for (const { label, re } of RED_FLAGS) {
    if (seen.has(label)) continue
    let m
    if (EEO_PRONE.has(label)) {
      // walk every occurrence and keep the first that is NOT boilerplate
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      let found = null, x
      while ((x = g.exec(lower)) !== null) {
        if (!inEEOContext(lower, x.index, x[0].length)) { found = x; break }
        if (x.index === g.lastIndex) g.lastIndex++
      }
      m = found
    } else {
      m = lower.match(re)
    }
    if (!m) continue
    seen.add(label)
    hits.push({ label, context: snippet(plainText, m.index, m[0].length) })
    if (hits.length >= MAX_FLAGS_PER_JOB) break
  }
  return hits
}

// Which disqualifier pattern fired. Mirrors isDisqualified EXACTLY (normalize, then
// first matching pattern), so what's reported is truly what blocked the job.
export function whichDisqualifier(fullText = '') {
  const norm = normalize(fullText)
  for (const re of DISQUALIFIER_PATTERNS) {
    const m = norm.match(re)
    if (m) return { source: re.source, context: snippet(norm, m.index, m[0].length) }
  }
  return null
}

// Classify a raw Greenhouse job exactly like the FetchJobs main loop does, in the
// same order, so 'passed' here means the same thing it means in production.
export function classifyJob(job) {
  const location  = job.location?.name || ''
  const plainText = stripHtml(job.content || '')
  const fullText  = `${job.title || ''} ${plainText}`
  const base = { title: job.title || '', location, plainText, applyUrl: job.absolute_url || '' }

  if (location !== '' && !isUSLocation(location)) return { ...base, verdict: 'nonUS', locKind: classifyLocation(location) }
  if (isDisqualified(fullText))                   return { ...base, verdict: 'disqualified', hit: whichDisqualifier(fullText) }
  if (isContractOrPartTime(plainText, job.title || '')) return { ...base, verdict: 'contract' }
  return { ...base, verdict: 'passed', flags: scanRedFlags(plainText) }
}

// Fisher–Yates shuffle, then take n. Used for random company + job sampling.
function pick(arr, n) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

// Build the full markdown report from classified jobs. Pure: feed it fake jobs in
// a test and the output is stable except for the random disqualified sample.
export function buildReport(classified, meta = {}) {
  const passed       = classified.filter(j => j.verdict === 'passed')
  const disqualified = classified.filter(j => j.verdict === 'disqualified')
  const contract     = classified.filter(j => j.verdict === 'contract')
  const nonUS        = classified.filter(j => j.verdict === 'nonUS')
  const nonUSLooksUS = nonUS.filter(j => looksUS(j.location))
  const nonUSOther   = nonUS.filter(j => !looksUS(j.location))
  const suspicious   = passed.filter(j => j.flags && j.flags.length > 0)
  const foreignSlips = passed.filter(j => looksForeign(j.location))

  const L = []
  L.push('# Filter spot-check')
  L.push('')
  L.push(`Companies reached: ${meta.companies ?? '?'}  ·  Jobs seen: ${classified.length}`)
  L.push(`Passed ${passed.length} · Disqualified ${disqualified.length} · Contract/PT ${contract.length} · Non-US ${nonUS.length}`)
  L.push(`**Passed-but-flagged (review these): ${suspicious.length}**`)
  L.push(`**Non-US but look US (maybe wrongly dropped): ${nonUSLooksUS.length}**`)
  L.push(`**Passed but look FOREIGN (possible slips): ${foreignSlips.length}**`)
  L.push('')
  L.push('---')
  L.push('')

  L.push(`## ⚠️  Passed but suspicious — likely leaks (${suspicious.length})`)
  L.push('')
  L.push('Got through the filter but still mention restriction language. Each is a')
  L.push('candidate leak: read it and decide whether the filter needs a new pattern.')
  L.push('')
  if (suspicious.length === 0) {
    L.push('_None in this sample._')
    L.push('')
  } else {
    suspicious.slice(0, MAX_SUSPICIOUS).forEach((j, i) => {
      L.push(`**${i + 1}. ${j.title}** — ${j.location || 'US'}`)
      j.flags.forEach(f => L.push(`- \`${f.label}\`: ${f.context}`))
      if (j.applyUrl) L.push(`- ${j.applyUrl}`)
      L.push('')
    })
    if (suspicious.length > MAX_SUSPICIOUS) {
      L.push(`_…and ${suspicious.length - MAX_SUSPICIOUS} more. Raise MAX_SUSPICIOUS to see all._`)
      L.push('')
    }
  }

  L.push('---')
  L.push('')
  L.push(`## 🚫 Disqualified sample — check for over-blocking (${Math.min(MAX_DISQUALIFIED, disqualified.length)} of ${disqualified.length})`)
  L.push('')
  L.push('These were blocked. Skim for FALSE positives — good jobs wrongly hidden.')
  L.push('The regex that fired and the text it matched are shown.')
  L.push('')
  if (disqualified.length === 0) {
    L.push('_None in this sample._')
    L.push('')
  } else {
    pick(disqualified, MAX_DISQUALIFIED).forEach((j, i) => {
      L.push(`**${i + 1}. ${j.title}** — ${j.location || 'US'}`)
      L.push(`- fired: \`${j.hit ? j.hit.source : '(unknown)'}\``)
      if (j.hit) L.push(`- matched: ${j.hit.context}`)
      if (j.applyUrl) L.push(`- ${j.applyUrl}`)
      L.push('')
    })
  }

  // The allow-list drops anything it does not recognise, so the risk is losing real US
  // jobs silently. Show exactly what was dropped and why.
  const dropped = nonUS
  const byKind = {}
  for (const j of dropped) { const k = j.locKind || '?'; (byKind[k] ||= []).push(j) }
  L.push('---')
  L.push('')
  L.push(`## 🧭 Location allow-list — what got dropped (${dropped.length})`)
  L.push('')
  L.push('`foreign` = matched a known foreign name. `unknown` = no US signal recognised —')
  L.push('THIS is the bucket to read: any real US job in here is being silently lost.')
  L.push('')
  Object.entries(byKind).sort((a, b) => b[1].length - a[1].length).forEach(([k, arr]) => {
    L.push(`**${k}: ${arr.length}**`)
    const sample = pick(arr, 25).map(j => j.location).filter(Boolean)
    sample.forEach(loc => L.push(`- \`${loc}\``))
    L.push('')
  })

  L.push('---')
  L.push('')
  L.push(`## 🌐 Passed but the location looks FOREIGN — possible slips (${foreignSlips.length})`)
  L.push('')
  L.push('Reached the board as US, but the location contains a foreign city/country name.')
  L.push('Likely a foreign job that slipped the location filter (e.g. "Munich, DE"). Low')
  L.push('stakes — a student just skips it — but listed so you can keep an eye on it. A few')
  L.push('may be small US towns that share a foreign city name, so eyeball them.')
  L.push('')
  if (foreignSlips.length === 0) {
    L.push('_None in this sample._')
    L.push('')
  } else {
    foreignSlips.slice(0, MAX_FOREIGN_SLIPS).forEach((j, i) => {
      L.push(`**${i + 1}. ${j.title}** — \`${j.location}\`  (matched: ${looksForeign(j.location)})`)
      if (j.applyUrl) L.push(`- ${j.applyUrl}`)
      L.push('')
    })
    if (foreignSlips.length > MAX_FOREIGN_SLIPS) {
      L.push(`_…and ${foreignSlips.length - MAX_FOREIGN_SLIPS} more._`)
      L.push('')
    }
  }

  L.push('---')
  L.push('')
  L.push(`## 📍 Dropped as Non-US but the location LOOKS US — probably wrongly dropped (${nonUSLooksUS.length})`)
  L.push('')
  L.push('Removed as non-US, but the location reads like a US one — usually the "City, VA"')
  L.push('abbreviation format isUSLocation does not recognize. Each is likely a good US job')
  L.push('being thrown away. A long list here means the location filter needs the fix.')
  L.push('')
  if (nonUSLooksUS.length > 0) {
    const bySlug = {}
    for (const j of nonUSLooksUS) { const k = j.slug || '(unknown)'; bySlug[k] = (bySlug[k] || 0) + 1 }
    L.push('**Breakdown by company (how concentrated it is):**')
    Object.entries(bySlug).sort((a, b) => b[1] - a[1]).forEach(([slug, n]) => L.push(`- ${slug}: ${n}`))
    L.push('')
  }
  if (nonUSLooksUS.length === 0) {
    L.push('_None in this sample._')
    L.push('')
  } else {
    nonUSLooksUS.slice(0, MAX_NONUS_LOOKS_US).forEach((j, i) => {
      L.push(`**${i + 1}. ${j.title}** — \`${j.location}\``)
      if (j.applyUrl) L.push(`- ${j.applyUrl}`)
      L.push('')
    })
    if (nonUSLooksUS.length > MAX_NONUS_LOOKS_US) {
      L.push(`_…and ${nonUSLooksUS.length - MAX_NONUS_LOOKS_US} more._`)
      L.push('')
    }
  }

  L.push('---')
  L.push('')
  L.push(`## 🌍 Other Non-US sample — should genuinely be foreign (${Math.min(MAX_NONUS_OTHER, nonUSOther.length)} of ${nonUSOther.length})`)
  L.push('')
  L.push('Sanity check that the filter is correctly catching real foreign jobs.')
  L.push('')
  if (nonUSOther.length === 0) {
    L.push('_None in this sample._')
    L.push('')
  } else {
    pick(nonUSOther, MAX_NONUS_OTHER).forEach(j => {
      L.push(`- ${j.title} — \`${j.location}\``)
    })
    L.push('')
  }

  return L.join('\n')
}

// ── ORCHESTRATION (network — runs only when executed directly) ───────────────
async function main() {
  const arg = process.argv[2]
  const slugsPath = path.join(__dirname, 'greenhouse_companies.json')
  const allSlugs = JSON.parse(fs.readFileSync(slugsPath, 'utf-8'))

  let targets
  if (arg && /^\d+$/.test(arg)) {
    targets = pick(allSlugs, parseInt(arg, 10))
  } else if (arg) {
    targets = arg.split(',').map(s => s.trim()).filter(Boolean)
  } else {
    targets = pick(allSlugs, DEFAULT_SAMPLE)
  }

  console.log(`🔎 Spot-checking ${targets.length} companies for filter leaks...`)
  const classified = []
  let reached = 0

  for (const slug of targets) {
    const { ok, jobs } = await fetchGreenhouseCompany(slug)
    if (!ok) { console.log(`   ⏭️  ${slug}: no response`); continue }
    reached++
    for (const job of jobs) classified.push({ ...classifyJob(job), slug })
    await new Promise(r => setTimeout(r, 200))   // be polite to Greenhouse
  }

  const report  = buildReport(classified, { companies: reached })
  const outPath = path.join(__dirname, 'filter-report.md')
  fs.writeFileSync(outPath, report, 'utf-8')

  const passed       = classified.filter(j => j.verdict === 'passed')
  const suspicious   = passed.filter(j => j.flags && j.flags.length > 0)
  const nonUS        = classified.filter(j => j.verdict === 'nonUS')
  const nonUSLooksUS = nonUS.filter(j => looksUS(j.location))
  console.log('')
  console.log(`✅ Done. ${classified.length} jobs from ${reached} companies.`)
  const foreignSlips = passed.filter(j => looksForeign(j.location))
  console.log(`   Passed ${passed.length} · Passed-but-flagged ${suspicious.length} · Passed-but-foreign ${foreignSlips.length}`)
  const unknownDrops = nonUS.filter(j => j.locKind === 'unknown')
  console.log(`   Non-US ${nonUS.length} — of those, ${nonUSLooksUS.length} look US (maybe wrongly dropped)`)
  console.log(`   Allow-list: ${unknownDrops.length} dropped as UNKNOWN (read these in the report)`)
  const bySlug = {}
  for (const j of nonUSLooksUS) { const k = j.slug || '(unknown)'; bySlug[k] = (bySlug[k] || 0) + 1 }
  const top = Object.entries(bySlug).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (top.length) console.log(`   Top companies dropped: ${top.map(([s, n]) => `${s} (${n})`).join(', ')}`)
  console.log(`   📄 Full report: ${outPath}`)
  console.log('   👉 Open filter-report.md — check "Passed but suspicious" AND "looks US".')
}

// Only run the fetch when executed directly (node filterCheck.mjs). Stays quiet
// when imported by a test, so the pure functions above can be checked offline.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => { console.error('❌ Error:', err); process.exit(1) })
}
