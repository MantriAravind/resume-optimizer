// backend/scripts/audit-truncation.mjs — ONE-TIME, READ-ONLY truncation assessment
// (reviewer request 2026-09-25). For every CONFIRMED profile, finds structured
// values sitting at a legacy cap and checks them against the profile's own
// confirmed source text (user.resumeText) to decide whether content was cut.
// Sitting at a cap alone is never treated as proof (a real bullet list can
// have exactly 15 items); the source text decides.
//
// Output: internal Mongo _id, field path, stored vs expected counts/lengths,
// status, whether re-import is required. NEVER names, emails, or resume text.
// The script performs no writes of any kind (find() with projection only).
//
// Run from backend/:
//   node scripts/audit-truncation.mjs --selftest          synthetic checks, no DB
//   node scripts/audit-truncation.mjs                     dev DB (MONGODB_URI)
//   node scripts/audit-truncation.mjs --db=prod           prod DB (MONGODB_URI_PROD)
// Exit: 0 ran clean · 1 selftest failed · 2 server.js drifted / setup error
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'server.js'), 'utf8')
const grab = (a, b) => {
  const i = src.indexOf(a), j = i === -1 ? -1 : src.indexOf(b, i)
  if (i === -1 || j === -1 || src.indexOf(a, i + 1) !== -1) { console.error('SETUP FAILED: server.js marker not found: ' + a); process.exit(2) }
  return src.slice(i, j)
}
// Reuse the production definitions (caps, at-cap rule, normalization) — no copies.
const code = [
  "import { createHash } from 'crypto'",
  grab('const COMPLETENESS_HEADING = ', '// baseline (2026-09-23'),
  grab('function buildLineMap(text) {', 'function draftEvidenceFields(text) {'),
  grab('const SCHEMA_V2 = {', '// The copy-never-write rule'),
  'export { legacyAtCap, buildNormIndex, completenessKey, LEGACY_CAPS }',
].join('\n')
const tmp = join(mkdtempSync(join(tmpdir(), 'optyply-audit-')), 'extracted.mjs')
writeFileSync(tmp, code)
let M
try { M = await import(pathToFileURL(tmp).href) } catch (e) { console.error('SETUP FAILED: ' + e.message); process.exit(2) }
const { legacyAtCap, buildNormIndex, completenessKey } = M

const BULLET = /^\s*[•▪●·*\-–—]\s+/
const getPath = (d, path) => path.replace(/^\$\./, '').split(/\.|\[|\]/).filter(Boolean).reduce((o, k) => (o == null ? o : o[isNaN(k) ? k : +k]), d)

// Locate a stored value in the source; return raw [start,end) or null.
function locate(source, value) {
  const N = buildNormIndex(source, false)
  const n = buildNormIndex(String(value), false).str.trim()
  if (!n) return null
  const at = N.str.indexOf(n)
  if (at === -1) return null
  return { start: N.map[at], end: N.map[at + n.length - 1] + 1 }
}
// Text that continues the SAME paragraph after `end`: rest of the line, then
// following lines until a blank line, a bullet line, or a section heading.
function continuation(source, end) {
  const rest = source.slice(end)
  const lines = rest.split('\n')
  let out = lines[0]
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '')
    if (!l.trim() || BULLET.test(l) || completenessKey(l)) break
    out += ' ' + l
  }
  return out.replace(/[\s ]+/g, ' ').trim()
}
// Bullet-looking lines after `end`, before a heading or a blank-line-separated
// non-bullet line (the next record's header). Returns a count.
function bulletsAfter(source, end) {
  const lines = source.slice(end).split('\n').slice(1)
  let n = 0
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '')
    if (!l.trim()) continue
    if (completenessKey(l)) break
    if (BULLET.test(l)) { n++; continue }
    break
  }
  return n
}

// Pure decision for one profile: [{path, stored, expected, status, reimport}]
export function assessTruncation(resumeData, source) {
  const out = []
  for (const c of legacyAtCap(resumeData)) {
    const v = getPath(resumeData, c.path)
    if (typeof v === 'string') {
      const loc = source ? locate(source, v) : null
      if (!loc) { out.push({ path: c.path, stored: v.length, expected: '?', status: 'undetermined', reimport: 'review' }); continue }
      const cont = continuation(source, loc.end)
      if (/[\p{L}\p{N}]/u.test(cont)) out.push({ path: c.path, stored: v.length, expected: v.length + 1 + cont.length, status: 'affected', reimport: 'required' })
      else out.push({ path: c.path, stored: v.length, expected: v.length, status: 'not_affected', reimport: 'no' })
    } else if (Array.isArray(v)) {
      const last = [...v].reverse().find(x => typeof x === 'string' && x.trim())
      const loc = (source && last) ? locate(source, last) : null
      if (!loc) { out.push({ path: c.path, stored: v.length, expected: '?', status: 'undetermined', reimport: 'review' }); continue }
      const more = bulletsAfter(source, loc.end)
      if (more > 0) out.push({ path: c.path, stored: v.length, expected: v.length + more, status: 'affected', reimport: 'required' })
      else out.push({ path: c.path, stored: v.length, expected: v.length, status: 'not_affected', reimport: 'no' })
    }
  }
  return out
}

function selftest() {
  const res = []
  const ok = (name, cond) => { console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + name); res.push(!!cond) }
  const long = 'Word '.repeat(151).trim()  // 754 chars
  const cut = long.slice(0, 600)
  const srcA = ['NAME', 'SUMMARY', long, 'EXPERIENCE', 'Engineer | Co | 2020', ...Array.from({ length: 16 }, (_, i) => '• Bullet ' + i)].join('\n')
  const rA = assessTruncation({ summary: cut, experience: [{ title: 'Engineer', company: 'Co', bullets: Array.from({ length: 15 }, (_, i) => 'Bullet ' + i) }] }, srcA)
  const sA = rA.find(x => x.path === '$.summary'), bA = rA.find(x => x.path === '$.experience[0].bullets')
  ok('A-01 summary cut at 600 mid-paragraph → affected, expected ≈ source length', sA?.status === 'affected' && sA.expected >= 750)
  ok('A-02 15 stored bullets but 16 in source → affected, expected 16', bA?.status === 'affected' && bA.expected === 16)
  const exact = 'Sentence. '.repeat(59) + 'Final end.'   // exactly 600 chars, ends the paragraph
  if (exact.length !== 600) throw new Error('fixture length ' + exact.length)
  const srcB = ['NAME', 'SUMMARY', exact, 'EXPERIENCE', 'Engineer | Co | 2020', ...Array.from({ length: 15 }, (_, i) => '• Bullet ' + i), 'EDUCATION', 'BS, U']. join('\n')
  const rB = assessTruncation({ summary: exact, experience: [{ title: 'Engineer', company: 'Co', bullets: Array.from({ length: 15 }, (_, i) => 'Bullet ' + i) }] }, srcB)
  ok('A-03 exactly 600 chars that really end the paragraph → not_affected (cap alone is not proof)', rB.find(x => x.path === '$.summary')?.status === 'not_affected')
  ok('A-04 exactly 15 bullets that really are all of them → not_affected', rB.find(x => x.path === '$.experience[0].bullets')?.status === 'not_affected')
  const rC = assessTruncation({ summary: cut }, 'unrelated text only')
  ok('A-05 value not found in source → undetermined / review (never a guess)', rC[0]?.status === 'undetermined' && rC[0].reimport === 'review')
  const ser = JSON.stringify([...rA, ...rB, ...rC])
  ok('A-06 output carries paths and numbers only — no text', !/Word|Bullet|Sentence|Engineer/.test(ser))
  const pass = res.filter(Boolean).length
  console.log(`audit selftest: ${pass}/${res.length} ${pass === res.length ? 'PASS' : 'FAIL'}`)
  return pass === res.length
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest() ? 0 : 1)

// ── Database pass (read-only) ──
if (!selftest()) { console.error('selftest failed — refusing to audit'); process.exit(1) }
const { default: mongoose } = await import('mongoose')
try { await import('dotenv/config') } catch { /* env may already be injected */ }
const prod = args.includes('--db=prod')
const uri = prod ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error(`SETUP FAILED: ${prod ? 'MONGODB_URI_PROD' : 'MONGODB_URI'} not set`); process.exit(2) }
await mongoose.connect(uri)
console.log(`audit: connected to database "${mongoose.connection.name}" (read-only pass)`)
const users = mongoose.connection.db.collection('users')
let scanned = 0, candidates = 0, affectedUsers = 0, rows = 0
const cursor = users.find({ resumeData: { $ne: null } }, { projection: { resumeData: 1, resumeText: 1 } })
for await (const u of cursor) {
  scanned++
  const found = assessTruncation(u.resumeData, u.resumeText || '')
  if (found.length) candidates++
  if (found.some(x => x.status === 'affected')) affectedUsers++
  for (const x of found) {
    rows++
    console.log(`user=${u._id} path=${x.path} stored=${x.stored} expected=${x.expected} status=${x.status} reimport=${x.reimport}`)
  }
}
console.log(`audit summary: profiles_scanned=${scanned} profiles_at_a_cap=${candidates} profiles_affected=${affectedUsers} rows=${rows}`)
await mongoose.disconnect()
process.exit(0)
