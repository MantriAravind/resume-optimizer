// pdfCompat.mjs — A7-S2. Can this PDF be edited in place (surgical path), or does it
// go to the HTML layout renderer (fallback)?
//
//   import { checkPdfCompat } from './pdfCompat.mjs'
//   const compat = checkPdfCompat(buffer)
//   // { mode: 'surgical' | 'html', reason, message, pages, fonts: [...], columns, textChars }
//
//   node pdfCompat.mjs resume.pdf          // prints the verdict and the font table
//
// Four gates, in order; the first failure decides. Each failure carries one plain
// sentence for the student (message) and a code for us (reason).
//
//   1. text-based    — extractable text on every page, not a scan
//   2. not locked    — no password, edit permission not withheld
//   3. fonts writable — every body font can be written back: either we ship a
//                       substitute for the family, or the embedded font itself has
//                       glyphs for the whole working character set
//   4. ≤ 1 column    — no run of wide side-by-side text on one page
//
// Why gate 3 is about substitutes, not "fonts readable": Word, Google Docs and LaTeX
// embed SUBSETS — only the glyphs the document used. On the reference resume the
// regular Century Gothic subset has no J U X Z ' : ; ? &, and the bold has no digits
// 5–9. Rewritten text hits missing glyphs immediately, and a missing glyph renders as
// nothing. So the original font is reusable only when its subset happens to cover the
// working set; otherwise the rewritten lines are written in a look-alike we ship
// (decision B, 2026-09-11): original font when it covers the whole rewrite,
// substitute otherwise, decided per document, never per block.
//
// Pure read. No model call. Synchronous — mupdf is WASM and already loaded.

import * as m from 'mupdf'
import fs from 'node:fs'

// Family → substitute we can ship (all free). metric: true means the substitute has
// the same advance widths as the original, so a swapped line wraps identically and
// the swap is invisible. metric: false is a look-alike: same feel, slightly different
// widths — the fit rule measures in the substitute, so nothing overflows, but the
// on-screen note must say a look-alike was used.
export const SUBSTITUTES = {
  'Arial':            { file: 'LiberationSans',  metric: true },
  'Helvetica':        { file: 'LiberationSans',  metric: true },
  'Times New Roman':  { file: 'LiberationSerif', metric: true },
  'Courier New':      { file: 'LiberationMono',  metric: true },
  'Calibri':          { file: 'Carlito',         metric: true },
  'Cambria':          { file: 'Caladea',         metric: true },
  'Georgia':          { file: 'Gelasio',         metric: true },
  'Century Gothic':   { file: 'TeXGyreAdventor', metric: false },
  'Garamond':         { file: 'EBGaramond',      metric: false },
  'Verdana':          { file: 'DejaVuSans',      metric: false },
}

// What a rewritten resume line can contain. Anything outside this set is the
// optimizer's problem (it must not emit it), not the font's.
export const WORKING_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,;:\'"-–()/&%+'

const MIN_TEXT_CHARS = 200        // fewer than this across the whole file = not a text PDF
const COLUMN_GAP = 18             // pt: two fragments on one baseline further apart than this are separate runs
                                  // (a word space is ~3pt; a two-column gutter is 20pt+; a split date line 60pt+)
const COLUMN_MIN_WIDTH = 0.25     // each run must be at least this fraction of page width to count as a column
const COLUMN_MIN_ROWS = 5         // this many wide side-by-side rows on one page = two columns
const BULLET_ONLY = /^[\s•\-–—·▪●o\u2022\u25AA\u25CF\u2023\u2043\uF0B7\uF0A7]*$/

// Same normalisation as pdfLayout.mjs fontFacts(), kept here so this module has no
// pdfjs dependency. "ABCDEF+CenturyGothic-Bold" → { family: 'Century Gothic', bold }.
export function fontFamily(name = '') {
  const n = name.replace(/^[A-Z]{6}\+/, '')
  const lower = n.toLowerCase()
  const fam = lower.replace(/[^a-z]/g, '')
  const bold = /bold|black|heavy|semibold|demibold/.test(lower)
  const italic = /italic|oblique/.test(lower)
  let family = n.split(/[-,+]/)[0].replace(/(PS|MT|PSMT)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  if (/liberationserif|dejavuserif|nimbusroman|freeserif|timesnewroman|^times/.test(fam)) family = 'Times New Roman'
  else if (/liberationmono|dejavusansmono|couriernew|^courier/.test(fam)) family = 'Courier New'
  else if (/liberationsans|dejavusans|nimbussans|freesans|^arial/.test(fam)) family = 'Arial'   // same mapping as pdfLayout.mjs
  else if (/verdana/.test(fam)) family = 'Verdana'
  else if (/helvetica/.test(fam)) family = 'Helvetica'
  else if (/carlito|calibri/.test(fam)) family = 'Calibri'
  else if (/caladea|cambria/.test(fam)) family = 'Cambria'
  else if (/gelasio|georgia/.test(fam)) family = 'Georgia'
  else if (/garamond/.test(fam)) family = 'Garamond'
  else if (/centurygothic|adventor|urwgothic/.test(fam)) family = 'Century Gothic'
  return { family, bold, italic, raw: n }
}

// Reads one page's font dictionary. For each resource: which characters of the
// working set it cannot draw. Decided from the Widths array — a subset font written
// by Word/Docs/LaTeX has a zero width for every code it dropped (verified against the
// embedded TrueType's cmap on the reference resume: identical lists). Type0/CID fonts
// have no simple Widths; they are marked so, and gate 3 then relies on a substitute.
function pageFontResources(page) {
  const out = {}
  let res = page.getObject().get('Resources')
  if (!res || res.isNull()) return out
  if (res.isIndirect()) res = res.resolve()
  let fonts = res.get('Font')
  if (!fonts || fonts.isNull()) return out
  if (fonts.isIndirect()) fonts = fonts.resolve()
  if (!fonts.isDictionary()) return out
  const keys = []
  fonts.forEach((v, k) => keys.push(String(k)))
  for (const key of keys) {
    try {
      let f = fonts.get(key)
      if (f.isIndirect()) f = f.resolve()
      const subtype = String(f.get('Subtype')?.asName?.() || '')
      const base = String(f.get('BaseFont')?.asName?.() || '')
      let fd = f.get('FontDescriptor')
      if (fd && fd.isIndirect()) fd = fd.resolve()
      const embedded = Boolean(fd && !fd.isNull() && (fd.get('FontFile')?.isIndirect?.() || fd.get('FontFile2')?.isIndirect?.() || fd.get('FontFile3')?.isIndirect?.()))
      const enc = f.get('Encoding')
      const encoding = !enc || enc.isNull() ? 'builtin' : enc.isName() ? enc.asName() : 'dict'
      let missing = null
      if (subtype === 'Type0') {
        missing = 'cid'
      } else if (subtype === 'Type3') {
        missing = 'type3'
      } else if (!embedded) {
        missing = []          // the viewer substitutes a full font; so will we
      } else if (!/^(WinAnsiEncoding|StandardEncoding|MacRomanEncoding)$/.test(encoding)) {
        // A custom or built-in encoding (reportlab, some Docs exports) assigns codes in
        // order of first use: code 65 is not 'A'. Our writer emits WinAnsi codes, so
        // such a font cannot be reused even if its Widths look complete.
        missing = 'encoding:' + encoding
      } else {
        const fc = f.get('FirstChar')?.asNumber?.()
        let w = f.get('Widths')
        if (w && w.isIndirect()) w = w.resolve()
        if (Number.isFinite(fc) && w && w.isArray()) {
          const has = new Set()
          for (let i = 0; i < w.length; i++) if (w.get(i).asNumber() > 0) has.add(fc + i)
          has.add(32)
          missing = [...WORKING_SET].filter(ch => !has.has(winAnsiCode(ch)))
        } else {
          missing = 'nowidths'
        }
      }
      out[base] = { key, subtype, base, embedded, encoding, missing, ...fontFamily(base) }
    } catch (e) {
      out[key] = { key, subtype: '?', base: key, embedded: false, encoding: '?', missing: 'error:' + e.message, family: key, bold: false, italic: false, raw: key }
    }
  }
  return out
}

// WinAnsi code for the working-set characters. Only the en dash lives outside ASCII.
function winAnsiCode(ch) {
  if (ch === '–') return 0x96
  return ch.charCodeAt(0)
}

// Word chops one visual line into fragments; join fragments on one baseline into
// runs, splitting only where the gap is wide (COLUMN_GAP). Then a page with many rows
// of two wide runs is two columns. A "Company | Jan 2024 – Present" split line does
// not trip this: the date run is ~12% of the page width.
function countColumnRows(page, pageW) {
  const st = JSON.parse(page.toStructuredText('preserve-spans').asJSON())
  const frags = st.blocks.filter(b => b.type === 'text').flatMap(b => b.lines)
    .filter(f => !BULLET_ONLY.test(f.text))
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
  const rows = []
  for (const f of frags) {
    const row = rows.find(r => Math.abs(r.y - f.bbox.y) < f.bbox.h * 0.34)
    if (!row) { rows.push({ y: f.bbox.y, runs: [{ x0: f.bbox.x, x1: f.bbox.x + f.bbox.w }] }); continue }
    const last = row.runs[row.runs.length - 1]
    if (f.bbox.x - last.x1 > COLUMN_GAP) row.runs.push({ x0: f.bbox.x, x1: f.bbox.x + f.bbox.w })
    else last.x1 = Math.max(last.x1, f.bbox.x + f.bbox.w)
  }
  let wideRows = 0
  for (const r of rows) {
    const wide = r.runs.filter(run => run.x1 - run.x0 >= pageW * COLUMN_MIN_WIDTH)
    if (wide.length >= 2) wideRows++
  }
  return { rows: rows.length, wideRows, textChars: frags.reduce((n, f) => n + f.text.length, 0), fragsByFont: frags }
}

const MESSAGES = {
  scanned:   'This PDF is a scanned image, so we can\'t edit the text inside it. Your optimized resume will keep your content, but in our layout rather than your exact formatting.',
  encrypted: 'This PDF is password-protected or locked for editing, so we can\'t edit it in place. Your optimized resume will keep your content, but in our layout rather than your exact formatting.',
  font:      'This PDF uses a font we can\'t reproduce, so we can\'t edit it in place. Your optimized resume will keep your content, but in our layout rather than your exact formatting.',
  columns:   'This PDF uses a multi-column layout, which we can\'t edit in place. Your optimized resume will keep your content, but in our layout rather than your exact formatting.',
  unreadable: 'We couldn\'t read this PDF\'s structure, so we can\'t edit it in place. Your optimized resume will keep your content, but in our layout rather than your exact formatting.',
}

export function checkPdfCompat(buffer) {
  const fail = (reason, extra = {}) => ({ mode: 'html', reason, message: MESSAGES[reason] || MESSAGES.unreadable, ...extra })
  let doc
  try {
    doc = m.Document.openDocument(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), 'application/pdf')
  } catch (e) {
    return fail('unreadable', { detail: e.message })
  }

  // Gate 2 first when the file is locked outright: nothing else can be read.
  if (doc.needsPassword()) return fail('encrypted', { detail: 'needs password' })
  if (!doc.hasPermission('edit')) return fail('encrypted', { detail: 'edit permission withheld' })

  const pages = doc.countPages()
  const creator = `${doc.getMetaData('info:Creator') || ''} / ${doc.getMetaData('info:Producer') || ''}`.trim()
  const fonts = {}            // base name → facts
  const usedChars = {}        // base name → count of non-bullet chars drawn with it
  let textChars = 0
  let maxWideRows = 0
  let pageSize = null

  for (let p = 0; p < pages; p++) {
    const page = doc.loadPage(p)
    const [x0, y0, x1, y1] = page.getBounds()
    if (!pageSize) pageSize = { w: x1 - x0, h: y1 - y0 }
    Object.assign(fonts, pageFontResources(page))
    const { wideRows, textChars: n, fragsByFont } = countColumnRows(page, x1 - x0)
    textChars += n
    maxWideRows = Math.max(maxWideRows, wideRows)
    for (const f of fragsByFont) {
      const nm = f.font?.name || ''
      usedChars[nm] = (usedChars[nm] || 0) + f.text.replace(/\s/g, '').length
    }
  }

  // Gate 1
  if (textChars < MIN_TEXT_CHARS) return fail('scanned', { detail: `${textChars} text chars`, pages, creator })

  // Gate 3 — only fonts that draw real words count; a Symbol font used for bullets
  // does not need a substitute.
  const fontReport = []
  for (const [base, f] of Object.entries(fonts)) {
    const used = usedChars[base] || usedChars[f.raw] || 0
    if (used < 20) continue
    const sub = SUBSTITUTES[f.family] || null
    // DejaVu is mapped to Arial for the fallback renderer's sake (same as pdfLayout),
    // but it is not metric-compatible with Liberation Sans — say so.
    const metric = sub ? sub.metric && !/dejavu/i.test(f.raw) : null
    const covers = Array.isArray(f.missing) && f.missing.length === 0
    const writable = Boolean(sub) || covers
    fontReport.push({
      base, family: f.family, bold: f.bold, italic: f.italic, subtype: f.subtype, encoding: f.encoding,
      embedded: f.embedded, usedChars: used,
      missing: Array.isArray(f.missing) ? f.missing.join('') : f.missing,
      substitute: sub ? sub.file : null, metric,
      // how this font's rewritten lines will be written (decision B)
      write: covers ? 'original' : sub ? 'substitute' : 'none',
      writable,
    })
  }
  const unwritable = fontReport.filter(f => !f.writable)
  if (unwritable.length) return fail('font', { detail: unwritable.map(f => f.base).join(', '), pages, creator, fonts: fontReport, textChars })

  // Gate 4
  if (maxWideRows >= COLUMN_MIN_ROWS) return fail('columns', { detail: `${maxWideRows} wide side-by-side rows`, pages, creator, fonts: fontReport, textChars })

  return { mode: 'surgical', reason: null, message: null, pages, pageSize, creator, fonts: fontReport, textChars, columns: false }
}

// ── CLI
if (process.argv[1] && /pdfCompat\.mjs$/.test(process.argv[1])) {
  const file = process.argv[2]
  if (!file) { console.error('usage: node pdfCompat.mjs resume.pdf'); process.exit(1) }
  const c = checkPdfCompat(fs.readFileSync(file))
  console.log(`${file}\n  mode: ${c.mode}${c.reason ? '  reason: ' + c.reason + ' (' + c.detail + ')' : ''}`)
  if (c.message) console.log('  message: ' + c.message)
  if (c.pages) console.log(`  pages: ${c.pages}  textChars: ${c.textChars}  creator: ${c.creator}`)
  for (const f of c.fonts || []) {
    console.log(`  font ${f.base}  →  ${f.family}${f.bold ? ' bold' : ''}${f.italic ? ' italic' : ''}  [${f.subtype}/${f.encoding}${f.embedded ? ', embedded' : ', not embedded'}] used ${f.usedChars} chars`)
    console.log(`       missing: ${f.missing === '' ? '(none)' : f.missing}   write: ${f.write}${f.substitute ? ' (' + f.substitute + (f.metric ? ', metric match' : ', look-alike') + ')' : ''}`)
  }
}
