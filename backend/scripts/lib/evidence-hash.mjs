// backend/scripts/lib/evidence-hash.mjs — ONE canonical, versioned fingerprint for
// every script whose output is shared as evidence (reviewer request 2026-09-25).
//
// Version 1, printed "h1:" + the first 12 hex characters of SHA-256 over:
//   string              → its raw UTF-8 bytes (no quotes, no normalization)
//   Buffer / Uint8Array → its bytes; a BSON Binary → the bytes it holds
//   null / undefined    → the 4 bytes "null"
//   anything else       → canonical JSON (object keys sorted at every level,
//                         dates as ISO strings)
// The same value prints the same h1 in every script, so a fingerprint in one
// evidence file can be matched against another. A change to this method must
// bump the version prefix (h2:…), never silently change what h1 means.
//
// Internal database ids are printed only as idLabel(id): "id:" + the 12-hex h1 of
// the id string — enough to tell rows apart, never the id itself.
import { createHash } from 'crypto'

export const EVIDENCE_HASH_VERSION = 'h1'

export function bytesOf(v) {
  if (!v || typeof v !== 'object') return null
  if (Buffer.isBuffer(v)) return v
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  if (v._bsontype === 'Binary' && v.buffer instanceof Uint8Array) return Buffer.from(v.buffer.buffer, v.buffer.byteOffset, v.buffer.byteLength)
  return null
}

function canon(v) {
  if (v === null || v === undefined) return 'null'
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (typeof v === 'object') {
    if (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID') return JSON.stringify(String(v))
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

export function h1(v) {
  const bytes = typeof v === 'string' ? Buffer.from(v, 'utf8') : (bytesOf(v) || Buffer.from(canon(v), 'utf8'))
  return 'h1:' + createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}

export const idLabel = id => 'id:' + h1(String(id)).slice(3)

// Known-answer checks every script runs in its own self-test.
export function evidenceHashChecks() {
  const id = '6aae0662dc1c0054e07e9a03'
  return [
    ['h1 of "abc" is the published SHA-256 prefix (ba7816bf8f01)', h1('abc') === 'h1:ba7816bf8f01'],
    ['h1 of the same text as bytes equals h1 of the string', h1(Buffer.from('résumé', 'utf8')) === h1('résumé') && h1(new Uint8Array(Buffer.from('abc'))) === h1('abc')],
    ['h1 of an object ignores key order; null and undefined agree', h1({ b: 1, a: [2, { d: 3, c: 4 }] }) === h1({ a: [2, { c: 4, d: 3 }], b: 1 }) && h1(null) === h1(undefined)],
    ['idLabel never contains the id itself', idLabel(id).startsWith('id:') && idLabel(id).length === 15 && !idLabel(id).includes(id.slice(0, 8)) && idLabel(id) === idLabel(id)],
  ]
}
