// backend/scripts/compare-profile-source.mjs — READ-ONLY source comparison
// (reviewer follow-up, 2026-09-25). For each profile with structured résumé
// data, re-extracts text from the stored ORIGINAL FILE with the same extractor
// the upload path uses (../resumeExtract.mjs), then checks the stored data
// against it across all sections:
//   • coverage — every letter/digit of every non-heading line of the original
//     must be accounted for by stored values (strict: no percentage threshold).
//     Lines below 100% get content-free diagnostics: where the gap sits, which
//     stored values are anchored on the line, and whether a stored scalar value
//     explains the gap (same text attributed to an earlier occurrence, or a URL
//     stored with an added https://). Only the unexplained residual can be loss.
//   • source order — each stored list appears in the original's order
//   • record counts, bullet counts and field presence per section
// Output is numbers, booleans and line numbers only — never résumé text. If
// any lines are unaccounted for, their text is written to a private file in the
// OS temp directory (outside the repo) for the operator's own review; it is
// never printed.
//
// Run from backend/:
//   node scripts/compare-profile-source.mjs --selftest
//   node scripts/compare-profile-source.mjs --db=prod
// Exit: 0 ran · 1 selftest failed · 2 setup error
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createHash } from 'crypto'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'server.js'), 'utf8')
const grab = (a, b) => {
  const i = src.indexOf(a), j = i === -1 ? -1 : src.indexOf(b, i)
  if (i === -1 || j === -1 || src.indexOf(a, i + 1) !== -1) { console.error('SETUP FAILED: server.js marker not found: ' + a); process.exit(2) }
  return src.slice(i, j)
}
const code = [
  "import { createHash } from 'crypto'",
  grab('const COMPLETENESS_HEADING = ', '// baseline (2026-09-23'),
  grab('function buildLineMap(text) {', 'function draftEvidenceFields(text) {'),
  grab('const SCHEMA_V2 = {', '// The copy-never-write rule'),
  'export { buildFieldMetaV2, buildLineMap, locateSectionSpans, completenessKey, buildNormIndex, normValue }',
].join('\n')
const tmp = join(mkdtempSync(join(tmpdir(), 'optyply-cmp-')), 'extracted.mjs')
writeFileSync(tmp, code)
let M
try { M = await import(pathToFileURL(tmp).href) } catch (e) { console.error('SETUP FAILED: ' + e.message); process.exit(2) }
const { buildFieldMetaV2, buildLineMap, locateSectionSpans, completenessKey, buildNormIndex, normValue } = M

const BULLET = /^\s*[•▪●·*\-–—◦]\s*/
const ALNUM = /[\p{L}\p{N}]/u

// Scalar fields may explain an uncovered span; list atoms (bullets, skills,
// tech) may not — they can legitimately recur inside other text.
const SCALAR_PATH = /^\$profile\.|^\$\.name$|^\$\.contact\[\d+\]$|\.(title|company|city|dates|name|degree|school|gpa|org|date|label|heading|github)$/
const pathSection = path => {
  if (/^\$profile\.|^\$\.name$|^\$\.contact\[/.test(path)) return 'header'
  if (/^\$\.summary/.test(path)) return 'summary'
  const k = (path.match(/^\$\.([a-zA-Z]+)/) || [])[1]
  return ['skills', 'experience', 'projects', 'education', 'certifications'].includes(k) ? k : null
}
const valueAt = (d, profile, path) => path.startsWith('$profile.')
  ? profile?.[path.slice(9)]
  : path.replace(/^\$\./, '').split(/\.|\[|\]/).filter(Boolean).reduce((o, k) => (o == null ? o : o[isNaN(k) ? k : +k]), d)
// Same matching rules as production (normalized with word boundaries, then a
// dash/space-insensitive pass for values of 8+ chars); returns [start,end) in T.
function occurs(T, v) {
  for (const flat of [false, true]) {
    const idx = buildNormIndex(T, flat), n = normValue(v, flat)
    if (!n || (flat && n.length < 8)) continue
    let from = 0
    while (true) {
      const at = idx.str.indexOf(n, from)
      if (at === -1) break
      const okB = flat || ((!ALNUM.test(n[0]) || !ALNUM.test(idx.str[at - 1] || '')) && (!ALNUM.test(n[n.length - 1]) || !ALNUM.test(idx.str[at + n.length] || '')))
      if (okB) return [idx.map[at], idx.map[at + n.length - 1] + 1]
      from = at + 1
    }
  }
  return null
}

// Pure comparison: stored data vs extracted source text.
export function compareToSource(resumeData, profile, text) {
  const d = resumeData || {}
  const lm = buildLineMap(text)
  const fm = buildFieldMetaV2(d, text, lm, { profile: profile || null })
  const ranges = fm.entries.filter(e => e.sourceRef).map(e => [e.sourceRef.rawStart, e.sourceRef.rawEnd])
  const { spans } = locateSectionSpans(text)
  const sectionAt = pos => { for (const [k, l] of Object.entries(spans)) if (l.some(x => pos >= x.s && pos < x.e)) return k; return 'header' }

  // Coverage per source line: share of the line's letters/digits inside any stored value's range.
  const covered = new Uint8Array(text.length)
  for (const [a, b] of ranges) for (let i = a; i < b; i++) covered[i] = 1
  const withValue = fm.entries.filter(e => e.valueSha)
  const lines = []
  for (const l of lm.lines) {
    const s = text.slice(l.rawStart, l.rawEnd)
    let n = 0, c = 0
    for (let i = 0; i < s.length; i++) if (ALNUM.test(s[i])) { n++; if (covered[l.rawStart + i]) c++ }
    if (n === 0) continue
    const heading = !!completenessKey(s.replace(/\r$/, ''))
    const x = { line: l.line + 1, section: heading ? 'heading' : sectionAt(l.rawStart), alnum: n, share: c / n, uncovered: n - c, residual: 0, at: null, explainedBy: [], refsOnLine: [], bullet: BULLET.test(s), heading, text: s }
    if (!heading && c < n) strictDiagnose(x, l.rawStart, l.rawEnd)
    lines.push(x)
  }
  // Strict pass (every line below 100%, not a 90% threshold). Content-free
  // diagnostics per line: where the uncovered letters sit (head/tail/middle/
  // mixed/all), which stored values are anchored on the line, and which stored
  // SCALAR values (a title, date, company, contact field — never a bullet,
  // skill or tech atom, which can legitimately recur inside other text) would
  // account for the uncovered letters:
  //   earlier_occurrence — the value occurs on this line, but its reference was
  //                        attributed to an earlier identical occurrence in the
  //                        same section (first-occurrence matching)
  //   url_scheme         — the value occurs here once a URL scheme it adds
  //                        (https://) is ignored
  // residual = letters no stored value accounts for. Only residual can be lost
  // content; a line with residual 0 is present.
  function strictDiagnose(x, s, e) {
    const T = text.slice(s, e)
    const idx = []
    for (let i = 0; i < T.length; i++) if (ALNUM.test(T[i])) idx.push(i)
    const unc = idx.filter(i => !covered[s + i])
    const cov = idx.filter(i => covered[s + i])
    x.at = !cov.length ? 'all' : unc.every(i => i > cov[cov.length - 1]) ? 'tail' : unc.every(i => i < cov[0]) ? 'head'
      : unc.every(i => i > cov[0] && i < cov[cov.length - 1]) ? 'middle' : 'mixed'
    x.refsOnLine = withValue.filter(en => en.sourceRef && en.sourceRef.rawStart < e && en.sourceRef.rawEnd > s).map(en => en.path)
    const alt = new Uint8Array(T.length)
    const cands = []
    for (const en of withValue) {
      if (!SCALAR_PATH.test(en.path)) continue
      if (en.sourceRef && en.sourceRef.rawStart < e && en.sourceRef.rawEnd > s) continue
      const ps = pathSection(en.path)
      if (ps && ps !== x.section) continue
      const v = valueAt(d, profile, en.path)
      if (typeof v !== 'string' || !v.trim()) continue
      let hit = occurs(T, v), kind = 'earlier_occurrence'
      if (!hit) { const u = v.replace(/^\s*https?:\/\//i, ''); if (u !== v) { hit = occurs(T, u); kind = 'url_scheme' } }
      if (!hit) continue
      const gap = []
      for (let i = hit[0]; i < hit[1]; i++) if (ALNUM.test(T[i]) && !covered[s + i]) gap.push(i)
      if (gap.length) cands.push({ en, kind, gap })
    }
    // Largest explanation first; a candidate is listed only for letters no
    // larger one already explains (a name that also spells a URL slug is not
    // credited for the URL the LinkedIn field accounts for).
    cands.sort((a, b) => b.gap.length - a.gap.length)
    for (const c of cands) {
      const fresh = c.gap.filter(i => !alt[i])
      if (!fresh.length) continue
      for (const i of fresh) alt[i] = 1
      x.explainedBy.push({ path: c.en.path, kind: c.kind, refLine: c.en.sourceRef ? c.en.sourceRef.startLine + 1 : null, status: c.en.verificationStatus, letters: fresh.length })
    }
    x.residual = unc.filter(i => !alt[i]).length
  }
  const unaccounted = lines.filter(x => !x.heading && x.uncovered > 0 && x.residual > 0)
  const explained = lines.filter(x => !x.heading && x.uncovered > 0 && x.residual === 0)
  const notInSection = fm.entries.filter(en => en.verificationStatus === 'needs_review').map(en => en.path)

  // Source order: within each stored list, verified refs must move forward.
  const order = []
  const checkOrder = (label, paths) => {
    const starts = paths.map(p => fm.entries.find(e => e.path === p)).filter(e => e && e.verificationStatus === 'verified').map(e => e.sourceRef.rawStart)
    let inv = 0
    for (let i = 1; i < starts.length; i++) if (starts[i] < starts[i - 1]) inv++
    order.push({ list: label, items: starts.length, inversions: inv })
  }
  const first = (arr, base, key) => (arr || []).map((_, i) => `${base}[${i}].${key}`)
  checkOrder('experience records', first(d.experience, '$.experience', 'company').map((p, i) => (d.experience[i]?.company ? p : `$.experience[${i}].title`)))
  checkOrder('project records', first(d.projects, '$.projects', 'name'))
  checkOrder('education records', first(d.education, '$.education', 'school').map((p, i) => (d.education[i]?.school ? p : `$.education[${i}].degree`)))
  checkOrder('certification records', first(d.certifications, '$.certifications', 'name'))
  checkOrder('skill categories', first(d.skills, '$.skills', 'label'))
  ;(d.experience || []).forEach((x, i) => checkOrder(`experience[${i}] bullets`, (x?.bullets || []).map((_, k) => `$.experience[${i}].bullets[${k}]`)))
  ;(d.projects || []).forEach((x, i) => checkOrder(`projects[${i}] bullets`, (x?.bullets || []).map((_, k) => `$.projects[${i}].bullets[${k}]`)))
  ;(d.skills || []).forEach((x, i) => checkOrder(`skills[${i}] items`, (x?.items || []).map((_, k) => `$.skills[${i}].items[${k}]`)))
  checkOrder('summary bullets', (d.summaryBullets || []).map((_, k) => `$.summaryBullets[${k}]`))

  // Counts and field presence per section (stored side) + source-side coverage per section.
  const present = (x, k) => (typeof x?.[k] === 'string' ? !!x[k].trim() : Array.isArray(x?.[k]) ? x[k].length > 0 : false)
  const fields = (arr, keys) => Object.fromEntries(keys.map(k => [k, (arr || []).filter(x => present(x, k)).length]))
  const sections = {
    contact: { stored: (fm.entries.filter(e => e.path.startsWith('$profile.') && e.verificationStatus !== 'not_found')).length },
    summary: { paragraph: !!(d.summary && d.summary.trim()), bullets: (d.summaryBullets || []).length },
    skills: { categories: (d.skills || []).length, items: (d.skills || []).reduce((n, x) => n + (x?.items?.length || 0), 0) },
    experience: { records: (d.experience || []).length, bullets: (d.experience || []).map(x => x?.bullets?.length || 0), fields: fields(d.experience, ['title', 'company', 'city', 'dates']) },
    projects: { records: (d.projects || []).length, bullets: (d.projects || []).map(x => x?.bullets?.length || 0), tech: (d.projects || []).map(x => x?.tech?.length || 0), fields: fields(d.projects, ['name', 'dates', 'github']) },
    education: { records: (d.education || []).length, fields: fields(d.education, ['degree', 'school', 'city', 'dates', 'gpa']) },
    certifications: { records: (d.certifications || []).length, fields: fields(d.certifications, ['name', 'org', 'date']) },
  }
  const bySection = {}
  for (const x of lines.filter(y => !y.heading)) {
    const b = bySection[x.section] = bySection[x.section] || { lines: 0, accounted: 0, unaccounted: 0, unaccountedBullets: 0 }
    b.lines++
    if (x.residual === 0) b.accounted++; else { b.unaccounted++; if (x.bullet) b.unaccountedBullets++ }
  }
  return { sections, bySection, order, unaccounted, explained, notInSection, needsReview: fm.counts.needs_review }
}

function selftest() {
  const res = []
  const ok = (name, cond) => { console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + name); res.push(!!cond) }
  const SRC = ['PAT SAMPLE', 'Boston, MA | pat@example.com', 'SKILLS', 'Languages: Python, Go, Rust', 'EXPERIENCE',
    'Engineer | Acme | 2020 - 2022', '• Built pipelines', '• Ran migrations', 'PROJECTS',
    'Alpha Tool', '• Wrote the parser', 'Beta Tool', '• Shipped the UI', 'EDUCATION', 'BS, State University', 'CERTIFICATIONS', 'Cloud Cert - Vendor'].join('\n')
  const full = { name: 'PAT SAMPLE', skills: [{ label: 'Languages', items: ['Python', 'Go', 'Rust'] }],
    experience: [{ title: 'Engineer', company: 'Acme', city: '', dates: '2020 - 2022', bullets: ['Built pipelines', 'Ran migrations'] }],
    projects: [{ name: 'Alpha Tool', tech: [], dates: '', github: '', bullets: ['Wrote the parser'] }, { name: 'Beta Tool', tech: [], dates: '', github: '', bullets: ['Shipped the UI'] }],
    education: [{ degree: 'BS', school: 'State University', city: '', dates: '', gpa: '' }], certifications: [{ name: 'Cloud Cert', org: 'Vendor', date: '' }] }
  const prof = { firstName: 'Pat', lastName: 'Sample', location: 'Boston, MA', email: 'pat@example.com' }
  const r1 = compareToSource(full, prof, SRC)
  ok('S-01 complete profile → every non-heading line accounted for, lists in source order', r1.unaccounted.length === 0 && r1.order.every(o => o.inversions === 0))
  const r2 = compareToSource({ ...full, projects: [full.projects[0]] }, prof, SRC)
  ok('S-02 a whole project dropped → its lines unaccounted for in projects (2 lines, 1 bullet)', r2.unaccounted.length === 2 && r2.bySection.projects?.unaccountedBullets === 1)
  const r3 = compareToSource({ ...full, skills: [{ label: 'Languages', items: ['Python', 'Go'] }] }, prof, SRC)
  ok('S-03 a shortened skill list → the skills line is not fully accounted for', r3.unaccounted.some(x => x.section === 'skills'))
  const r4 = compareToSource({ ...full, experience: [{ ...full.experience[0], bullets: ['Ran migrations', 'Built pipelines'] }] }, prof, SRC)
  ok('S-04 bullets stored out of source order → inversion detected', r4.order.find(o => o.list === 'experience[0] bullets')?.inversions === 1)
  const r5 = compareToSource({ ...full, certifications: [] }, prof, SRC)
  ok('S-05 a certification dropped → its line unaccounted for', r5.unaccounted.some(x => x.section === 'certifications'))
  // S-07: the line-47 pattern — the same title occurs earlier inside a longer title.
  const SRC7 = ['PAT SAMPLE', 'EXPERIENCE', 'Senior Data Engineer | Acme | 2021 - 2023', '• Led the platform team', 'Data Engineer | Beta | 2019 - 2021', '• Built pipelines'].join('\n')
  const d7 = { name: 'PAT SAMPLE', experience: [
    { title: 'Senior Data Engineer', company: 'Acme', city: '', dates: '2021 - 2023', bullets: ['Led the platform team'] },
    { title: 'Data Engineer', company: 'Beta', city: '', dates: '2019 - 2021', bullets: ['Built pipelines'] }] }
  const r7 = compareToSource(d7, null, SRC7)
  const l7 = r7.explained.find(x => x.line === 5)
  ok('S-07 title attributed to an earlier identical phrase → line explained by that record\'s title (ref line 3), residual 0, not reported missing',
    r7.unaccounted.length === 0 && !!l7 && l7.at === 'head' && l7.explainedBy.some(e => e.path === '$.experience[1].title' && e.kind === 'earlier_occurrence' && e.refLine === 3) && l7.refsOnLine.includes('$.experience[1].dates'))
  // S-08: the line-2 pattern — the stored LinkedIn value adds https://.
  const SRC8 = ['PAT SAMPLE', 'Boston, MA | pat@example.com | www.linkedin.com/in/pat-sample', 'SKILLS', 'Languages: Python'].join('\n')
  const r8 = compareToSource({ name: 'PAT SAMPLE', skills: [{ label: 'Languages', items: ['Python'] }] },
    { firstName: 'Pat', lastName: 'Sample', location: 'Boston, MA', email: 'pat@example.com', linkedin: 'https://www.linkedin.com/in/pat-sample' }, SRC8)
  const l8 = r8.explained.find(x => x.line === 2)
  ok('S-08 stored URL adds https:// → line explained by $profile.linkedin alone (url_scheme, 25 letters; the name spelling the URL slug is not credited), residual 0',
    r8.unaccounted.length === 0 && !!l8 && l8.explainedBy.length === 1 && l8.explainedBy[0].path === '$profile.linkedin' && l8.explainedBy[0].kind === 'url_scheme' && l8.explainedBy[0].letters === 25)
  // S-09: a line short by < 10% (one word cut at the end) — the old 90% rule passed this.
  const long9 = 'Designed and delivered the nightly reconciliation pipeline across ledgers, vendors, regions and currencies for finance'
  const SRC9 = ['PAT SAMPLE', 'EXPERIENCE', 'Engineer | Acme | 2020 - 2022', '• ' + long9].join('\n')
  const r9 = compareToSource({ name: 'PAT SAMPLE', experience: [{ title: 'Engineer', company: 'Acme', city: '', dates: '2020 - 2022', bullets: [long9.replace(/ for finance$/, '')] }] }, null, SRC9)
  const l9 = r9.unaccounted.find(x => x.line === 4)
  ok('S-09 a line cut by one trailing phrase (> 90% present) → still reported, uncovered at the tail',
    !!l9 && l9.share > 0.9 && l9.at === 'tail' && l9.residual === 10)
  // S-10: the real pattern — wrapped lines stored as separate bullets, cap reached, the rest dropped.
  const frag = ['Built the ingestion layer for daily partner', 'feeds with retries', 'Added quality', 'checks to ensure reliable reporting', 'Improved data consistency across', 'teams and reporting speed']
  const SRC10 = ['PAT SAMPLE', 'PROJECTS', 'Data Tool', '• ' + frag[0], frag[1], '• ' + frag[2], frag[3], '• ' + frag[4], frag[5]].join('\n')
  const r10 = compareToSource({ name: 'PAT SAMPLE', projects: [{ name: 'Data Tool', tech: [], dates: '', github: '', bullets: frag.slice(0, 3) }] }, null, SRC10)
  ok('S-10 fragments beyond the stored ones (continuation + next bullet) → each reported missing, uncovered "all"',
    r10.unaccounted.map(x => x.line).join(',') === '7,8,9' && r10.unaccounted.every(x => x.at === 'all' && x.explainedBy.length === 0))
  // S-11: guard — a dropped bullet that mentions a stored tech atom is still missing (atoms never explain).
  const SRC11 = ['PAT SAMPLE', 'PROJECTS', 'Data Tool', 'Python', '• Wrote the parser', '• Rewrote the loader in Python'].join('\n')
  const r11 = compareToSource({ name: 'PAT SAMPLE', projects: [{ name: 'Data Tool', tech: ['Python'], dates: '', github: '', bullets: ['Wrote the parser'] }] }, null, SRC11)
  const l11 = r11.unaccounted.find(x => x.line === 6)
  ok('S-11 a dropped bullet containing a stored tech word → still missing, nothing explains it', !!l11 && l11.explainedBy.length === 0 && l11.residual === l11.uncovered)
  // S-12: guard — a stored value from ANOTHER section never explains a gap (a dropped job line
  // naming a company that is also a certification's issuer stays fully unexplained).
  const SRC12 = ['PAT SAMPLE', 'EXPERIENCE', 'Engineer | Acme | 2020 - 2022', '• Built pipelines', 'Analyst | Vendor | 2018 - 2019', '• Wrote reports', 'CERTIFICATIONS', 'Cloud Cert - Vendor'].join('\n')
  const r12 = compareToSource({ name: 'PAT SAMPLE', experience: [{ title: 'Engineer', company: 'Acme', city: '', dates: '2020 - 2022', bullets: ['Built pipelines'] }],
    certifications: [{ name: 'Cloud Cert', org: 'Vendor', date: '' }] }, null, SRC12)
  const l12 = r12.unaccounted.find(x => x.line === 5)
  ok('S-12 a value stored in another section (certification issuer) never explains a dropped job line', !!l12 && l12.explainedBy.length === 0 && l12.at === 'all')
  // S-13: a job's FINAL bullet missing (below every cap — nothing for a cap check to see).
  const SRC13 = ['PAT SAMPLE', 'EXPERIENCE', 'Engineer | Acme | 2020 - 2022', '• Built pipelines', '• Ran migrations', '• Cut costs by a third', 'EDUCATION', 'BS, State University'].join('\n')
  const r13 = compareToSource({ name: 'PAT SAMPLE', experience: [{ title: 'Engineer', company: 'Acme', city: '', dates: '2020 - 2022', bullets: ['Built pipelines', 'Ran migrations'] }],
    education: [{ degree: 'BS', school: 'State University', city: '', dates: '', gpa: '' }] }, null, SRC13)
  ok('S-13 a job\'s final bullet missing (below the cap) → exactly that line reported missing', r13.unaccounted.length === 1 && r13.unaccounted[0].line === 6 && r13.unaccounted[0].at === 'all' && r13.unaccounted[0].bullet)
  const strip = r => JSON.stringify({ ...r, unaccounted: r.unaccounted.map(({ text, ...rest }) => rest), explained: r.explained.map(({ text, ...rest }) => rest) })
  const pub = [r2, r7, r8, r9, r10, r11, r12, r13].map(strip).join('')
  { const leak = pub.match(/Beta|Shipped|Acme|Python|Sample|pat-sample|example|reconciliation|ingestion|Senior|platform/i); ok('S-06 printable result carries no résumé text' + (leak ? ' (leaked: ' + leak[0] + ')' : ''), !leak) }
  const pass = res.filter(Boolean).length
  console.log(`compare selftest: ${pass}/${res.length} ${pass === res.length ? 'PASS' : 'FAIL'}`)
  return pass === res.length
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest() ? 0 : 1)
if (!selftest()) { console.error('selftest failed — refusing to compare'); process.exit(1) }

const { extractText } = await import(pathToFileURL(join(here, '..', 'resumeExtract.mjs')).href)
const { default: mongoose } = await import('mongoose')
try { await import('dotenv/config') } catch { /* env may already be injected */ }
const prod = args.includes('--db=prod')
const uri = prod ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error(`SETUP FAILED: ${prod ? 'MONGODB_URI_PROD' : 'MONGODB_URI'} not set`); process.exit(2) }
await mongoose.connect(uri)
console.log(`compare: connected to database "${mongoose.connection.name}" (read-only pass)`)
const users = mongoose.connection.db.collection('users')
const cursor = users.find({ resumeData: { $ne: null } }, { projection: { resumeData: 1, resumeText: 1, profile: 1, 'resumeFile.data': 1, 'resumeFile.name': 1, 'resumeFile.size': 1 } })
const sha = t => createHash('sha256').update(String(t || ''), 'utf8').digest('hex').slice(0, 12)
let n = 0
for await (const u of cursor) {
  n++
  const f = u.resumeFile
  if (!f?.data) { console.log(`user=${u._id} original_file=absent -> cannot compare (review)`); continue }
  const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data.buffer || f.data)
  const { text } = await extractText(buf, f.name || '')
  console.log(`user=${u._id} original_file=present bytes=${buf.length} extracted_chars=${text.length} extracted_sha=${sha(text)} confirmed_text_sha=${sha(u.resumeText)} same_text=${sha(text) === sha(u.resumeText)}`)
  const r = compareToSource(u.resumeData, u.profile, text)
  const s = r.sections
  console.log(`  contact: stored_fields=${s.contact.stored}`)
  console.log(`  summary: paragraph=${s.summary.paragraph} bullets=${s.summary.bullets}`)
  console.log(`  skills: categories=${s.skills.categories} items=${s.skills.items}`)
  console.log(`  experience: records=${s.experience.records} bullets_per_record=[${s.experience.bullets}] fields_present=${JSON.stringify(s.experience.fields)}`)
  console.log(`  projects: records=${s.projects.records} bullets_per_record=[${s.projects.bullets}] tech_per_record=[${s.projects.tech}] fields_present=${JSON.stringify(s.projects.fields)}`)
  console.log(`  education: records=${s.education.records} fields_present=${JSON.stringify(s.education.fields)}`)
  console.log(`  certifications: records=${s.certifications.records} fields_present=${JSON.stringify(s.certifications.fields)}`)
  for (const [sec, b] of Object.entries(r.bySection)) console.log(`  coverage ${sec}: source_lines=${b.lines} accounted=${b.accounted} unaccounted=${b.unaccounted} unaccounted_bullet_lines=${b.unaccountedBullets}`)
  const inv = r.order.filter(o => o.inversions > 0)
  console.log(`  source_order: lists_checked=${r.order.length} lists_out_of_order=${inv.length}` + (inv.length ? ' [' + inv.map(o => `${o.list}:${o.inversions}`).join(', ') + ']' : ''))
  const lineRow = x => `line ${x.line} [${x.section}${x.bullet ? ', bullet' : ''}] letters=${x.alnum} uncovered=${x.uncovered} at=${x.at}` +
    ` anchored_here=${x.refsOnLine.length}${x.refsOnLine.length ? '[' + x.refsOnLine.slice(0, 8).join(',') + (x.refsOnLine.length > 8 ? ',…' : '') + ']' : ''}` +
    ` explained_by=${x.explainedBy.length ? '[' + x.explainedBy.map(e => `${e.path} ${e.kind} ref_line=${e.refLine} status=${e.status} letters=${e.letters}`).join('; ') + ']' : 'none'}` +
    ` residual=${x.residual}`
  console.log(`  strict pass (every line below 100%): below_100=${r.explained.length + r.unaccounted.length} present_explained=${r.explained.length} not_accounted=${r.unaccounted.length}`)
  for (const x of r.explained) console.log('   ' + lineRow(x) + ' -> PRESENT (explained)')
  for (const x of r.unaccounted) console.log('   ' + lineRow(x) + (x.at === 'all' ? ' -> MISSING (no stored value holds any of it)' : ' -> REVIEW (part of the line is not in stored data)'))
  console.log(`  stored values not located in their own section: ${r.notInSection.length}${r.notInSection.length ? ' [' + r.notInSection.join(', ') + ']' : ''}`)
  if (r.unaccounted.length || r.explained.length) {
    const dir = mkdtempSync(join(tmpdir(), 'optyply-review-'))
    const file = join(dir, `lines-below-100-${u._id}.txt`)
    writeFileSync(file, [...r.explained.map(x => ['PRESENT', x]), ...r.unaccounted.map(x => [x.at === 'all' ? 'MISSING' : 'REVIEW', x])]
      .map(([v, x]) => `${v} line ${x.line} [${x.section}] residual=${x.residual}: ${x.text}`).join('\n') + '\n')
    console.log(`  text of these lines for YOUR review only (do not paste): ${file}`)
  }
  console.log(`  verdict: ${r.unaccounted.length === 0 && inv.length === 0 ? 'COMPLETE — every line of the original accounted for, all lists in source order' : 'NOT COMPLETE — ' + r.unaccounted.length + ' line(s) not in stored data' + (inv.length ? ', ' + inv.length + ' list(s) out of order' : '')}`)
}
console.log(`compare summary: profiles_compared=${n}`)
await mongoose.disconnect()
process.exit(0)
