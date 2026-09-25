// backend/test/unit-chunk2.mjs — Phase 2 chunk 2 unit fixtures (committed, reproducible)
// Extracts the REAL functions from the canonical ../server.js (no copies), then
// runs the schema-v2 validator fixtures (G-series) and the field-envelope /
// provenance fixtures (P-series), containment (C-series) and the affected-profile
// lock (L-series). All fixture data is synthetic.
//
// Run (from backend/):  node test\unit-chunk2.mjs      Exit: 0 all pass · 1 failures · 2 extraction drift
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createHash } from 'crypto'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'server.js'), 'utf8')
const grab = (a, b) => {
  const i = src.indexOf(a), j = i === -1 ? -1 : src.indexOf(b, i)
  if (i === -1 || j === -1 || src.indexOf(a, i + 1) !== -1) { console.error('EXTRACTION FAILED at marker: ' + a); process.exit(2) }
  return src.slice(i, j)
}
const code = [
  "import { createHash } from 'crypto'",
  grab('const COMPLETENESS_HEADING = ', '// baseline (2026-09-23'),
  grab('function buildLineMap(text) {', 'function draftEvidenceFields(text) {'),
  grab('const SCHEMA_V2 = {', '// The copy-never-write rule'),
  grab('function sanitizeResumeData(d) {', '// ── PHASE 2 CHUNK 2 STEP 2'),
  grab('function rescueSummaryFromText(resumeText, opts = {}) {', 'async function parseAndVerifyResume('),
  grab('function parseV2Mode() {', 'async function runParsePipeline('),
  grab('function computeCapLoss(raw, delivered, text) {', 'function draftCapFields(capLoss) {'),
  // Affected-profile lock: the real guard + tracker rule, run against a fake User model.
  'let User = null; const __setUser = u => { User = u }',
  grab('// \u2500\u2500 AFFECTED-PROFILE LOCK', "app.get('/me/job-marks'"),
  'export { __setUser, reimportGuard, reimportLockFor, trackerResumeInvalid, REIMPORT_MESSAGE, RESUME_INVALID_MESSAGE }',
  'export { validateResumeDataV2, buildFieldMetaV2, buildLineMap, projectV2ToV1Shape, sanitizeResumeData, rescueSummaryFromText, v2FromRaw, countV1Loss, parseV2Mode, v2EvidenceSuffix, legacyCapExceed, profileCapExceed, legacyAtCap, computeCapLoss, containSections, containNotices, CONTAIN_SAVE_MESSAGE }',
].join('\n')
const tmp = join(mkdtempSync(join(tmpdir(), 'optyply-unit-')), 'extracted.mjs')
writeFileSync(tmp, code)
let mod
try { mod = await import(pathToFileURL(tmp).href) }
catch (e) { console.error('EXTRACTION FAILED: extracted functions did not load (' + e.message + ') — server.js has drifted; update this runner.'); process.exit(2) }
const { validateResumeDataV2, buildFieldMetaV2, buildLineMap, projectV2ToV1Shape, sanitizeResumeData, rescueSummaryFromText, v2FromRaw, countV1Loss, parseV2Mode, v2EvidenceSuffix, legacyCapExceed, profileCapExceed, legacyAtCap, computeCapLoss, containSections, containNotices, CONTAIN_SAVE_MESSAGE } = mod
if (![validateResumeDataV2, buildFieldMetaV2, buildLineMap, projectV2ToV1Shape, sanitizeResumeData, rescueSummaryFromText, v2FromRaw, countV1Loss, parseV2Mode, v2EvidenceSuffix, legacyCapExceed, profileCapExceed, legacyAtCap, computeCapLoss, containSections, containNotices, CONTAIN_SAVE_MESSAGE].every(f => typeof f === 'function')) { console.error('EXTRACTION FAILED: a required function is missing.'); process.exit(2) }

const results = []
const ok = (name, cond, detail = '') => { console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (detail ? ' — ' + detail : '')); results.push(!!cond) }
const codes = (r, c) => r.issues.filter(i => i.code === c)
console.log('── chunk 2 unit fixtures · server.js sha256=' + createHash('sha256').update(src).digest('hex').slice(0, 12) + ' ──')

// ── G-series: schema v2 validator ──
const valid = {
  name: 'Sentinel Alpha', contact: ['Albany, NY', '(518) 555-0100'], summary: null,
  summaryBullets: ['Built things end to end.'],
  skills: [{ label: 'Cloud', items: ['AWS', 'Terraform'] }],
  experience: [{ title: 'Engineer', company: 'Fixture Labs', city: 'Albany', dates: 'Jan 2024 - Present', bullets: ['Did A.', 'Did B.'] }],
  projects: [{ name: 'Optimizer', tech: ['Node'], dates: null, github: null, bullets: ['Shipped.'] }],
  education: [{ degree: 'BS', school: 'Fixture U', city: null, dates: '2020', gpa: null }],
  certifications: [{ name: 'Cert One', org: 'Org', date: '2023' }],
  extraSections: [{ heading: 'Awards', entries: [{ title: 'Winner', details: 'Of things', bullets: [] }] }],
}
const g1 = validateResumeDataV2(valid)
ok('G-01 valid payload accepted with zero issues', g1.ok && g1.issues.length === 0 && g1.data.experience[0].bullets.length === 2)
const g2 = validateResumeDataV2({ ...valid, hobbies: ['x'], experience: [{ ...valid.experience[0], salary: '100k' }] })
ok('G-02 unknown fields → rejected, both paths reported', !g2.ok && g2.data === null && codes(g2, 'unknown_field').some(i => i.path === '$.hobbies') && codes(g2, 'unknown_field').some(i => i.path.endsWith('.salary')))
const g3 = validateResumeDataV2({ ...valid, contact: 'not-an-array', experience: [{ ...valid.experience[0], bullets: 'just one' }], name: 42 })
ok('G-03 invalid types → rejected with paths', !g3.ok && codes(g3, 'invalid_type').some(i => i.path === '$.contact') && codes(g3, 'invalid_type').some(i => i.path.endsWith('.bullets')) && codes(g3, 'invalid_type').some(i => i.path === '$.name'))
const bullets16 = Array.from({ length: 16 }, (_, i) => 'Bullet number ' + (i + 1) + ' with content.')
const g4 = validateResumeDataV2({ ...valid, summary: 'A'.repeat(800), experience: [{ ...valid.experience[0], bullets: bullets16 }] })
ok('G-04 oversize flagged but ALL content kept (16/16 bullets, 800/800 chars)', g4.ok && g4.data.experience[0].bullets.length === 16 && g4.data.summary.length === 800 && codes(g4, 'oversize').length === 2)
const g5 = validateResumeDataV2({ ...valid, skills: [{ label: 'Langs', items: ['Python', 'python', 'SQL', 'sql', 'Go'] }],
  certifications: [{ name: 'Same Cert', org: 'Org', date: '2021' }, { name: 'Same Cert', org: 'Org', date: '2023' }], experience: [valid.experience[0], { ...valid.experience[0] }] })
ok('G-05 atoms deduped (5→3, 2 recorded), duplicate records BOTH preserved', g5.ok && g5.data.skills[0].items.join('|') === 'Python|SQL|Go' && codes(g5, 'duplicate_atom').length === 2 && g5.data.certifications.length === 2 && g5.data.experience.length === 2)
const g6 = validateResumeDataV2({ name: 'X', summary: 'null', education: [{ degree: 'BS', school: '', dates: null }] })
ok('G-06 null semantics: ""/"null"/missing → null, absent arrays → []', g6.ok && g6.data.summary === null && g6.data.education[0].school === null && g6.data.education[0].gpa === null && Array.isArray(g6.data.contact) && g6.data.contact.length === 0)
const g7 = validateResumeDataV2({ name: 'X', summary: 'B'.repeat(500000) })
ok('G-07 oversize payload → rejected at $', !g7.ok && g7.issues[0].path === '$' && g7.issues[0].code === 'oversize')
const g8 = validateResumeDataV2({ ...valid, name: '  Sentinel\n   Alpha  ' })
ok('G-08 whitespace collapsed, content intact', g8.ok && g8.data.name === 'Sentinel Alpha')

// ── P-series: field envelopes / provenance ──
const get = (fm, path) => fm.entries.find(e => e.path === path)
const norm = s => s.toLowerCase().replace(/[\s ]+/g, ' ').trim()
const flat = s => norm(s).replace(/[\s‐-―-]+/g, '')

// Synthetic reference resume
const RAW = [
  'SENTINEL ALPHA',
  'Albany, NY | (518) 555-0100 | sentinel.alpha@example.com',
  'PROFESSIONAL SUMMARY',
  '• Builds reliable data pipelines for analytics teams.',
  'TECHNICAL SKILLS',
  'Languages: Python, Go, SQL',
  'Cloud: AWS, Terraform',
  'PROFESSIONAL EXPERIENCE',
  'Data Engineer | Fixture Labs | Albany, NY | Jan 2024 – Present',
  '• Built streaming service-',
  'performance dashboards for Google Cloud workloads.',
  '• Cut batch runtime by tuning Spark jobs.',
  'EDUCATION',
  'BS Computer Science, Fixture University, 2020',
  'CERTIFICATIONS',
  'Cloud Practitioner - Fixture Academy',
].join('\n')
const LM = buildLineMap(RAW)
const DATA = {
  name: 'Sentinel Alpha', contact: ['Albany, NY', '(518) 555-0100', 'sentinel.alpha@example.com'],
  summary: null, summaryBullets: ['Builds reliable data pipelines for analytics teams.'],
  skills: [{ label: 'Languages', items: ['Python', 'Go', 'SQL'] }, { label: 'Cloud', items: ['AWS', 'Terraform'] }],
  experience: [{ title: 'Data Engineer', company: 'Fixture Labs', city: 'Albany, NY', dates: 'Jan 2024 - Present',
    bullets: ['Built streaming service performance dashboards for Google Cloud workloads.', 'Cut batch runtime by tuning Spark jobs.'] }],
  projects: [], education: [{ degree: 'BS Computer Science', school: 'Fixture University', city: null, dates: '2020', gpa: null }],
  certifications: [{ name: 'Cloud Practitioner', org: 'Fixture Academy', date: null }], extraSections: [],
}
const v = validateResumeDataV2(DATA)
const fm = buildFieldMetaV2(v.data, RAW, LM, { methods: { '$.summaryBullets': 'deterministic' } })

// P-01 every non-empty value enveloped; every verified ref round-trips to its value
const nonEmpty = fm.entries.filter(e => e.verificationStatus !== 'not_found')
const roundTrip = fm.entries.filter(e => e.verificationStatus === 'verified').every(e => {
  const val = e.path.split(/\.|\[|\]/).filter(Boolean).slice(1).reduce((o, k) => o?.[isNaN(k) ? k : +k], v.data)
  const slice = RAW.slice(e.sourceRef.rawStart, e.sourceRef.rawEnd)
  return norm(slice) === norm(val) || flat(slice) === flat(val)
})
ok('P-01 every non-empty value enveloped; every verified sourceRef slices rawText back to its value', v.ok && nonEmpty.length > 20 && roundTrip, `entries=${fm.entries.length} verified=${fm.counts.verified}`)

// P-02 line numbers agree with lineMap for every ref
const linesOk = fm.entries.filter(e => e.sourceRef).every(e => {
  const s = LM.lines[e.sourceRef.startLine], t = LM.lines[e.sourceRef.endLine]
  return s.rawStart <= e.sourceRef.rawStart && e.sourceRef.rawEnd <= t.rawEnd && e.sourceRef.startLine <= e.sourceRef.endLine
})
ok('P-02 startLine/endLine consistent with lineMap v1 for every ref', linesOk)

// P-03 multi-line range: wrapped bullet maps to its COMPLETE raw range across two lines (correction 6)
const wrap = get(fm, '$.experience[0].bullets[0]')
ok('P-03 wrap-damaged bullet verified with a range spanning both source lines', wrap?.verificationStatus === 'verified' && wrap?.sourceRef?.endLine === wrap?.sourceRef?.startLine + 1, `lines ${wrap?.sourceRef?.startLine}–${wrap?.sourceRef?.endLine}`)

// P-04 dash variance in dates (model hyphen vs source en-dash) still verified, range exact
const dt = get(fm, '$.experience[0].dates')
ok('P-04 date with hyphen/en-dash variance verified via dash-insensitive pass', dt?.verificationStatus === 'verified' && !!dt?.sourceRef && RAW.slice(dt.sourceRef.rawStart, dt.sourceRef.rawEnd) === 'Jan 2024 – Present')

// P-05 method and status are independent: rescued summary is deterministic AND verified (R1)
const sb = get(fm, '$.summaryBullets[0]')
ok('P-05 extractionMethod separate from verificationStatus (deterministic + verified)', sb.extractionMethod === 'deterministic' && sb.verificationStatus === 'verified' && get(fm, '$.name').extractionMethod === 'model')

// P-06 explicit not_found: null scalars and empty arrays, no ref, no hash, nothing carried
const nf = ['$.summary', '$.projects', '$.extraSections', '$.education[0].city', '$.education[0].gpa', '$.certifications[0].date'].map(p => get(fm, p))
ok('P-06 null scalars + empty arrays → not_found with null ref/hash', nf.every(e => e && e.verificationStatus === 'not_found' && e.sourceRef === null && e.valueSha === null), `${nf.filter(Boolean).length}/6 present`)

// P-07 short-atom word boundary: "Go" located as the word, never inside "Google"
const go = get(fm, '$.skills[0].items[1]')
ok('P-07 "Go" verified at the word in Skills, not inside "Google"', go.verificationStatus === 'verified' && RAW.slice(go.sourceRef.rawStart, go.sourceRef.rawEnd) === 'Go' && go.sourceRef.section === 'skills')

// P-07b word boundary INSIDE the same section: "Go" after "Google"/"Django"; "R" absent as a word
const RAW7 = 'NAME\nSKILLS\nTools: Google Sheets, Django, Rust, Ruby, Go\n'
const fm7 = buildFieldMetaV2({ name: 'NAME', skills: [{ label: 'Tools', items: ['Go', 'R'] }] }, RAW7, buildLineMap(RAW7))
const go7 = get(fm7, '$.skills[0].items[0]'), r7 = get(fm7, '$.skills[0].items[1]')
ok('P-07b same-section trap: "Go" skips "Google"/"Django" to the real word; "R" (only inside Rust/Ruby) → needs_review', go7?.verificationStatus === 'verified' && go7?.sourceRef?.rawStart === RAW7.lastIndexOf('Go') && r7?.verificationStatus === 'needs_review')

// P-08 section scoping: value appearing in two sections gets the ref in ITS section
const cityC = get(fm, '$.contact[0]'), cityE = get(fm, '$.experience[0].city')
ok('P-08 same text in two sections → each path refs its own section', cityC.sourceRef.section === 'header' && cityE.sourceRef.section === 'experience' && cityC.sourceRef.rawStart !== cityE.sourceRef.rawStart)

// P-09 AWS-1 structural replica (synthetic): odd contact labels, city only in the job line
const RAW2 = ['JORDAN SAMPLE', 'CLOUD DEVELOPER', 'Contact: 555-010-0199 |', 'Email id: jordan.sample@example.com',
  'PROFESSIONAL SUMMARY', 'Cloud developer with pipeline experience.', 'PROFESSIONAL EXPERIENCE',
  'ACME BANK | Springfield, IL          March 2025 – Present', '• Built serverless ETL jobs.'].join('\n')
const d2 = validateResumeDataV2({ name: 'Jordan Sample', contact: ['location: Springfield, IL', 'phone: 555-010-0199', 'Springfield, IL', '555-010-0199', 'links:'],
  summary: 'Cloud developer with pipeline experience.', experience: [{ title: null, company: 'ACME BANK', city: 'Springfield, IL', dates: 'March 2025 - Present', bullets: ['Built serverless ETL jobs.'] }] })
const fm2 = buildFieldMetaV2(d2.data, RAW2, buildLineMap(RAW2))
const glued = get(fm2, '$.contact[0]'), gluedPhone = get(fm2, '$.contact[1]'), stolen = get(fm2, '$.contact[2]'), phone = get(fm2, '$.contact[3]'), empty = get(fm2, '$.contact[4]')
ok('P-09a label-glued contact values ("location: …", "phone: …", "links:") → needs_review, no ref', [glued, gluedPhone, empty].every(e => e.verificationStatus === 'needs_review' && e.reasonCode === 'source_mismatch' && e.sourceRef === null))
ok('P-09b city taken from a JOB line into contact → needs_review, ref points into experience', stolen.verificationStatus === 'needs_review' && stolen.reasonCode === 'source_mismatch' && stolen.sourceRef?.section === 'experience')
ok('P-09c the genuine header phone → verified in header; the job’s own city → verified', phone.verificationStatus === 'verified' && phone.sourceRef.section === 'header' && get(fm2, '$.experience[0].city').verificationStatus === 'verified')

// P-10 Unicode + CRLF: offsets are UTF-16 code units, exact on non-BMP and CRLF input
const RAW3 = 'José 👨‍💻 Nguyễn\r\nAustin, TX\r\nEXPERIENCE\r\nEngineer | Café Co | 2021 – 2023\r\n'
const fm3 = buildFieldMetaV2({ name: 'José 👨‍💻 Nguyễn', contact: ['Austin, TX'], experience: [{ title: 'Engineer', company: 'Café Co', city: null, dates: '2021 – 2023', bullets: [] }] }, RAW3, buildLineMap(RAW3))
const nm = get(fm3, '$.name'), co = get(fm3, '$.experience[0].company')
ok('P-10 emoji ZWJ + CRLF: ranges slice exactly, well-formed', RAW3.slice(nm.sourceRef.rawStart, nm.sourceRef.rawEnd) === 'José 👨‍💻 Nguyễn' && RAW3.slice(co.sourceRef.rawStart, co.sourceRef.rawEnd) === 'Café Co' && RAW3.slice(nm.sourceRef.rawStart, nm.sourceRef.rawEnd).isWellFormed())

// P-11 invented value (in no section) → needs_review, null ref; blind-spot fields now checked
const fm4 = buildFieldMetaV2({ ...v.data, skills: [{ label: 'Languages', items: ['Python', 'Rust'] }], certifications: [{ name: 'Invented Cert', org: null, date: '2019' }] }, RAW, LM)
ok('P-11 invented skill + invented cert (v1 verifier blind spots) → needs_review', get(fm4, '$.skills[0].items[1]').verificationStatus === 'needs_review' && get(fm4, '$.certifications[0].name').verificationStatus === 'needs_review' && get(fm4, '$.certifications[0].date').verificationStatus === 'needs_review')

// P-12 no content in meta: serialized envelopes contain no value text; valueSha detects edits
const ser = JSON.stringify(fm)
const leaks = ['Sentinel Alpha', 'Fixture Labs', 'sentinel.alpha@example.com', 'Terraform', 'dashboards'].filter(s => ser.includes(s))
const shaNow = createHash('sha256').update('Fixture Labs', 'utf8').digest('hex').slice(0, 12)
ok('P-12 envelopes carry hashes not content; valueSha matches value and changes on edit', leaks.length === 0 && get(fm, '$.experience[0].company').valueSha === shaNow && shaNow !== createHash('sha256').update('Fixture Labs Inc', 'utf8').digest('hex').slice(0, 12), `leaks=${leaks.length}`)

// P-13 counts are numbers only and add up
ok('P-13 counts consistent', fm.counts.fields === fm.entries.length && fm.counts.verified + fm.counts.needs_review + fm.counts.not_found + fm.counts.conflict === fm.counts.fields && fm.counts.conflict === 0, JSON.stringify(fm.counts))

// P-14 more than 30 fields needing review: none silently verified (verifier cap independence)
const many = { name: 'X', experience: [{ title: 'T', company: 'C', city: null, dates: null, bullets: Array.from({ length: 35 }, (_, i) => 'Invented bullet number ' + i) }] }
const fm5 = buildFieldMetaV2(validateResumeDataV2(many).data, RAW, LM)
const b = fm5.entries.filter(e => e.path.includes('.bullets['))
ok('P-14 35 invented bullets → all 35 needs_review (no 30-cap leakage)', b.length === 35 && b.every(e => e.verificationStatus === 'needs_review'))


// ── Step 4 pure pieces ──
// P-15 contact-form fields (separate model read) enveloped with header scoping (F10b)
const prof = { firstName: 'Jordan', lastName: 'Sample', location: 'Springfield, IL', phone: '555-010-0199', email: 'jordan.sample@example.com', linkedin: '', targetRole: 'Invented Role' }
const fm15 = buildFieldMetaV2(d2.data, RAW2, buildLineMap(RAW2), { profile: prof })
const pl = get(fm15, '$profile.location'), pp = get(fm15, '$profile.phone'), pf = get(fm15, '$profile.firstName'), pli = get(fm15, '$profile.linkedin'), pg = get(fm15, '$profile.github')
ok('P-15 contact form: location copied from a job line → needs_review (ref experience); phone/name verified in header; empty links not_found; inferred targetRole not enveloped',
  pl?.verificationStatus === 'needs_review' && pl?.sourceRef?.section === 'experience' && pp?.verificationStatus === 'verified' && pp?.sourceRef?.section === 'header' &&
  pf?.verificationStatus === 'verified' && pli?.verificationStatus === 'not_found' && pg?.verificationStatus === 'not_found' && !get(fm15, '$profile.targetRole'))

// P-16 summary rescue: v1 caps unchanged (8 bullets / 1200 chars); v2 asks for everything
const tenB = ['NAME', 'SUMMARY', ...Array.from({ length: 10 }, (_, i) => '• Summary point ' + (i + 1)), 'EXPERIENCE', 'x'].join('\n')
const longP = ['NAME', 'SUMMARY', 'W'.repeat(1500), 'EXPERIENCE', 'x'].join('\n')
ok('P-16 rescue: v1 path still capped (8 / 1200); v2 path uncapped (10 / 1500)',
  rescueSummaryFromText(tenB).summaryBullets.length === 8 && rescueSummaryFromText(tenB, { uncapped: true }).summaryBullets.length === 10 &&
  rescueSummaryFromText(longP).summary.length === 1200 && rescueSummaryFromText(longP, { uncapped: true }).summary.length === 1500)

// P-17 projection to the review screen's shape: nulls → '', NOTHING capped or dropped
const pj = projectV2ToV1Shape(g4.data)
ok('P-17 projection keeps all 16 bullets and 800 chars; nulls become empty strings; record counts unchanged',
  pj.experience[0].bullets.length === 16 && pj.summary.length === 800 && pj.education[0].city === '' && pj.projects[0].dates === '' &&
  pj.experience.length === g4.data.experience.length && pj.certifications.length === g4.data.certifications.length)

// P-18 v2FromRaw: rescue marks method deterministic; invalid raw rejected
const rawNoSummary = { name: 'NAME', experience: [{ title: 'x', company: null, city: null, dates: null, bullets: [] }] }
const e18 = v2FromRaw(rawNoSummary, tenB), e18b = v2FromRaw({ ...rawNoSummary, hobbies: [] }, tenB)
ok('P-18 v2FromRaw: missing summary rescued uncapped (10) with method deterministic; unknown field → rejected',
  e18.ok && e18.data.summaryBullets.length === 10 && e18.methods['$.summaryBullets'] === 'deterministic' && !e18b.ok && e18b.issues.some(i => i.code === 'unknown_field'))

// P-19 countV1Loss measures what the v1 sanitizer silently drops (shadow evidence)
const rawBig = { ...valid, experience: [{ ...valid.experience[0], bullets: bullets16 }], skills: [{ label: 'L', items: Array.from({ length: 45 }, (_, i) => 'skill' + i) }] }
const lost = countV1Loss(sanitizeResumeData(rawBig), validateResumeDataV2(rawBig).data)
ok('P-19 v1 loss counter: 16→15 bullets + 45→40 skills = 6 items silently dropped by v1', lost === 6, 'dropped=' + lost)

// P-20 mode switch: unset/unknown → off; recognized values honored
const saved = process.env.PARSE_V2
const modes = [undefined, 'shadow', 'ON', 'bogus'].map(v => { if (v === undefined) delete process.env.PARSE_V2; else process.env.PARSE_V2 = v; return parseV2Mode() })
if (saved === undefined) delete process.env.PARSE_V2; else process.env.PARSE_V2 = saved
ok('P-20 PARSE_V2: unset→off, shadow→shadow, ON→on, bogus→off', modes.join(',') === 'off,shadow,on,off', modes.join(','))

// P-21 evidence suffix: field PATHS only, never values; display capped with explicit "+N more"
const sfx = v2EvidenceSuffix(g4.issues, fm15)
const many21 = v2EvidenceSuffix(Array.from({ length: 13 }, (_, i) => ({ path: '$.x[' + i + ']', code: 'oversize' })), null)
ok('P-21 log suffix names paths only (oversize at bullets + summary; profile location flagged), no values; >10 paths shows "+3 more"',
  sfx.includes('$.experience[0].bullets') && sfx.includes('$.summary') && sfx.includes('$profile.location') &&
  !sfx.includes('Springfield') && !sfx.includes('Jordan') && many21.includes(',+3 more]') && !sfx.includes('duplicate'))

// P-22 rescued summary is size-checked too: kept whole AND flagged (correction 4)
const e22a = v2FromRaw(rawNoSummary, tenB), e22b = v2FromRaw(rawNoSummary, longP)
ok('P-22 rescue over limits: 10 bullets (limit 8) and a 1500-char paragraph (limit 600) are kept whole AND flagged oversize',
  e22a.data.summaryBullets.length === 10 && e22a.issues.some(i => i.path === '$.summaryBullets' && i.code === 'oversize') &&
  e22b.data.summary.length === 1500 && e22b.issues.some(i => i.path === '$.summary' && i.code === 'oversize'))

// ── Containment (2026-09-25): the v1 path must refuse, never cut ──
const hit = (list, path) => list.find(x => x.path === path)
const S758 = 'S'.repeat(758), S600 = 'S'.repeat(600)
const job = (bullets, extra = {}) => ({ title: 'Engineer', company: 'Fixture Labs', city: null, dates: '2020', bullets, ...extra })
const nb = n => Array.from({ length: n }, (_, i) => 'Real bullet ' + (i + 1))

ok('C-01 summary: 758 chars flagged (limit 600, actual 758); exactly 600 NOT flagged',
  hit(legacyCapExceed({ summary: S758 }), '$.summary')?.actual === 758 && legacyCapExceed({ summary: S600 }).length === 0)
ok('C-02 bullets: 16 flagged at $.experience[0].bullets; exactly 15 NOT flagged and v1 keeps all 15',
  hit(legacyCapExceed({ experience: [job(nb(16))] }), '$.experience[0].bullets')?.actual === 16 &&
  legacyCapExceed({ experience: [job(nb(15))] }).length === 0 && sanitizeResumeData({ experience: [job(nb(15))] }).experience[0].bullets.length === 15)
const trap = ['', '', ...nb(14)]
ok('C-03 slice-before-filter trap: 2 blanks + 14 real (16 slots) → v1 really keeps only 13, and the detector flags it',
  sanitizeResumeData({ experience: [job(trap)] }).experience[0].bullets.length === 13 && !!hit(legacyCapExceed({ experience: [job(trap)] }), '$.experience[0].bullets'))
const headless = { title: '', company: '', city: null, dates: '2020 - 2021', bullets: ['Did a real thing'] }
ok('C-04 whole record dropped by v1 (no title/company but real bullets) → flagged record_dropped',
  sanitizeResumeData({ experience: [job(nb(2)), headless] }).experience.length === 1 && hit(legacyCapExceed({ experience: [job(nb(2)), headless] }), '$.experience[1]')?.reason === 'record_dropped')
ok('C-05 no false positives: an ordinary full resume (all sections, below every cap) → nothing flagged', legacyCapExceed(valid).length === 0)
const longURL = 'https://example.com/' + 'p'.repeat(110)
ok('C-06 contact field of 130 chars: flagged at the save limit (120), NOT at the autosave limit (200)',
  profileCapExceed({ portfolio: longURL }, 120, ['portfolio']).length === 1 && profileCapExceed({ portfolio: longURL }, 200, ['portfolio']).length === 0)
ok('C-07 pre-containment drafts (conservative): exactly 15 bullets or a 600-char summary flagged; 14 bullets / 599 chars not',
  !!hit(legacyAtCap({ experience: [job(nb(15))] }), '$.experience[0].bullets') && legacyAtCap({ experience: [job(nb(14))] }).length === 0 &&
  !!hit(legacyAtCap({ summary: S600 }), '$.summary') && legacyAtCap({ summary: 'S'.repeat(599) }).length === 0)
const bigText = 'x'.repeat(25000)
const c8a = computeCapLoss({ name: 'N' }, { name: 'N' }, bigText)
const c8b = computeCapLoss({ name: 'N', summary: null, summaryBullets: [] }, { name: 'N', summary: null, summaryBullets: nb(8) }, tenB)
const c8c = computeCapLoss({ name: 'N' }, { name: 'N', summary: S758 }, 'N')
ok('C-08 parse-time loss: 25,000-char input → $input; rescue of 10 summary bullets (cap 8) → flagged; delivered 758-char summary → flagged',
  hit(c8a, '$input')?.actual === 25000 && hit(c8b, '$.summaryBullets')?.actual === 10 && hit(c8c, '$.summary')?.actual === 758)
const msg = CONTAIN_SAVE_MESSAGE(containSections([{ path: '$.summary' }, { path: '$.experience[2].bullets' }, { path: '$profile.portfolio' }]))
const nts = containNotices([{ path: '$.summaryBullets' }, { path: '$profile.portfolio' }, { path: '$.experience[0].bullets' }])
ok('C-09 user messages name sections only (Summary, Experience, Contact) — no values; notices land in summary/contact/experience',
  msg.includes('Summary') && msg.includes('Experience') && msg.includes('Contact') && msg.includes('unchanged') && !msg.includes('$') &&
  nts.map(n => n.section).sort().join(',') === 'contact,experience,summary')

// C-10 randomized equivalence (fixed seed): the detector flags a payload EXACTLY when
// sanitizeResumeData loses content. Loss is measured independently: total characters of
// non-empty collapsed strings (contact excluded — re-derived at save) before vs after.
{
  let seed = 20260925
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const pick = a => a[Math.floor(rnd() * a.length)]
  // Mostly within limits so both outcomes occur often: over-limit text ~1 in 60, arrays over cap ~1 in 20.
  const txt = () => { const u = rnd(); return u < 0.30 ? '' : u < 0.80 ? 'Short item' : u < 0.95 ? 'S'.repeat(598 + Math.floor(rnd() * 3)) : u < 0.983 ? 'x' : pick(['S'.repeat(601), 'Word '.repeat(130)]) }
  const list = (cap) => Array.from({ length: rnd() < 0.95 ? Math.floor(rnd() * (cap + 1)) : cap + 1 + Math.floor(rnd() * 3) }, txt)
  const rec = keys => Object.fromEntries(keys.map(k => [k, rnd() < 0.04 ? '' : 'K']))
  const gen = () => ({
    name: txt(), summary: rnd() < 0.5 ? txt() : null, summaryBullets: list(8),
    skills: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ label: rnd() < 0.1 ? '' : 'L', items: list(40) })),
    experience: Array.from({ length: Math.floor(rnd() * 5) }, () => ({ ...rec(['title', 'company']), city: txt(), dates: '2020', bullets: list(15) })),
    projects: Array.from({ length: Math.floor(rnd() * 3) }, () => ({ name: rnd() < 0.1 ? '' : 'P', tech: list(12), dates: '2021', github: '', bullets: list(12) })),
    education: Array.from({ length: Math.floor(rnd() * 3) }, () => ({ ...rec(['degree', 'school']), city: txt(), dates: '2019', gpa: '' })),
    certifications: Array.from({ length: rnd() < 0.95 ? Math.floor(rnd() * 5) : 13 + Math.floor(rnd() * 2) }, () => ({ name: rnd() < 0.1 ? '' : 'C', org: txt(), date: '' })),
    extraSections: [],
  })
  const chars = d => { let n = 0; const walk = (v, k) => { if (k === 'contact') return
    if (typeof v === 'string') { const c = v.replace(/[\s ]+/g, ' ').trim(); if (c && c.toLowerCase() !== 'null') n += c.length }
    else if (Array.isArray(v)) v.forEach(x => walk(x)); else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, x]) => walk(x, kk)) }
    walk(d); return n }
  let agree = 0, lossy = 0, missed = 0, falseAlarm = 0
  const N = 3000
  for (let i = 0; i < N; i++) {
    const d = gen()
    const lost = chars(sanitizeResumeData(d) || {}) < chars(d)
    const flagged = legacyCapExceed(d).length > 0
    if (lost) lossy++
    if (lost === flagged) agree++; else if (lost) missed++; else falseAlarm++
  }
  ok(`C-10 randomized: detector flags EXACTLY the payloads v1 truncates (${N} payloads: ${lossy} lossy, ${N - lossy} lossless) — missed=0, false alarms=0`,
    agree === N && lossy >= 300 && N - lossy >= 300, `agree=${agree} missed=${missed} falseAlarm=${falseAlarm}`)
}

// ── L-series: affected-profile lock (reviewer ruling 2026-09-25) ──
{
  const { __setUser, reimportGuard, reimportLockFor, trackerResumeInvalid, REIMPORT_MESSAGE, RESUME_INVALID_MESSAGE } = mod
  const fakeUser = docs => ({ findOne: q => ({ select: () => ({ lean: async () => {
    if (docs === 'throw') throw new Error('db down')
    return docs[q.clerkUserId] || null } }) }) })
  const t0 = new Date('2026-09-25T12:00:00Z'), before = new Date('2026-09-25T11:00:00Z'), after = new Date('2026-09-25T13:00:00Z')
  const locked = { reimportRequired: true, markedAt: t0 }
  const repaired = { reimportRequired: false, markedAt: t0, repairedAt: t0 }
  const opt = (resumeAt) => ({ optimized: true, resumeAt })
  ok('L-01 tracker rule: locked → every generated resume invalid (with or without a timestamp); marked but repair not recorded → invalid; direct applies and never-marked profiles never invalid',
    trackerResumeInvalid(opt(after), locked) && trackerResumeInvalid(opt(null), locked) && !trackerResumeInvalid({ optimized: false }, locked) &&
    !trackerResumeInvalid(opt(null), null) && trackerResumeInvalid(opt(null), { reimportRequired: true }) && !trackerResumeInvalid(opt(null), { reimportRequired: false }) &&
    trackerResumeInvalid(opt(after), { reimportRequired: false, markedAt: t0 }))
  ok('L-02 tracker rule after repair: made after the repair → valid; before it, or with no timestamp (legacy row) → still invalid',
    !trackerResumeInvalid(opt(after), repaired) && trackerResumeInvalid(opt(before), repaired) && trackerResumeInvalid(opt(null), repaired) && trackerResumeInvalid(opt(t0), repaired))
  const run = async (docs, userId) => {
    __setUser(fakeUser(docs))
    const out = { status: null, body: null, next: 0, logs: [] }
    const res = { status(c) { out.status = c; return { json(b) { out.body = b } } } }
    const realLog = console.log
    console.log = (...a) => { out.logs.push(a.join(' ')) }
    try { await reimportGuard('/download-word')({ userId }, res, () => { out.next++ }) } finally { console.log = realLog }
    return out
  }
  const g1 = await run({ u1: { repair: locked } }, 'u1')
  ok('L-03 guard, locked profile → 423 reimport_required with the plain message; the route handler never runs',
    g1.status === 423 && g1.body.error === 'reimport_required' && g1.body.message === REIMPORT_MESSAGE && /original/.test(REIMPORT_MESSAGE) && g1.next === 0)
  const g2 = await run({ u1: { repair: repaired }, u2: {} }, 'u1'), g3 = await run({ u2: {} }, 'u2')
  ok('L-04 guard, repaired or never-marked profile → passes straight through (no response written)', g2.next === 1 && g2.status === null && g3.next === 1 && g3.status === null)
  const g4 = await run({ u1: { repair: { reimportRequired: 'true', markedAt: t0 } } }, 'u1')
  ok('L-05 guard only honours a real boolean lock (the marker script writes true, never a string)', g4.next === 1)
  const g5 = await run('throw', 'u1')
  ok('L-06 guard fails CLOSED: lock unreadable → 503, nothing generated', g5.status === 503 && g5.next === 0)
  ok('L-07 guard logs route + outcome only (no user id)', g1.logs.length === 1 && g1.logs[0].startsWith('repair lock: /download-word refused 423') && !g1.logs[0].includes('u1') && g5.logs.length === 1 && !g5.logs[0].includes('u1'))
  ok('L-08 lock lookup: no user id → no lookup, not locked', (await reimportLockFor(null)) === null && typeof RESUME_INVALID_MESSAGE === 'string' && /Do not send it again/.test(RESUME_INVALID_MESSAGE))
  // Static rule: NO request path in server.js may write the lock. Every code line that
  // mentions it must be a read (the schema line and the /me/resume status are the only
  // allowed `repair:` keys). The marker script is the only writer.
  const lines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\brepair\b/.test(l) && !/^\s*\/\//.test(l))
  const writes = lines.filter(([, l]) =>
    /\$set|\$unset|\$setOnInsert|\$push|\$pull|updateOne|updateMany|findOneAndUpdate|replaceOne|bulkWrite/.test(l) ||
    /['"`]repair\./.test(l) || /['"`]repair['"`]\s*\]\s*=/.test(l) || /\.repair\s*=[^=]/.test(l) || /[{,]\s*repair\s*[,}]/.test(l) ||
    (/(^|[^.\w])repair\s*=[^=]/.test(l) && !/^\s*const repair = owner\?\.repair \|\| null\s*$/.test(l)) ||
    (/(^|[\s{,])repair\s*:/.test(l) && !/^\s*repair:\s+\{ type: mongoose\.Schema\.Types\.Mixed, default: null \},\s*$/.test(l) && !/^\s*repair: user\?\.repair\?\.reimportRequired === true\s*$/.test(l)))
  ok('L-09 static: server.js has no write to the lock anywhere (reads only)', lines.length >= 8 && writes.length === 0,
    'lines=' + lines.length + (writes.length ? ' writes at ' + writes.map(([n]) => n).join(',') : ''))
}

const pass = results.filter(Boolean).length
console.log('── chunk 2 unit fixtures: ' + pass + '/' + results.length + ' PASS ' + (pass === results.length ? '— ALL GREEN' : '— FAILURES ABOVE') + ' ──')
process.exit(pass === results.length ? 0 : 1)
