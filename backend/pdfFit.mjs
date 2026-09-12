// pdfFit.mjs — A7-S4. The fit rule: does a rewritten block still fit its box in the
// original size? Measure with real glyph advances, wrap at the block's available
// width, compare against maxLines. Never change the size; shorten the text instead.
//
//   import { buildFitContext, fitCheck, charBudget } from './pdfFit.mjs'
//   const ctx = buildFitContext(pdfBuffer, compat, blocksDoc)   // once per resume
//   fitCheck(ctx, block, newText) → { fits, linesNeeded, maxLines, lines, widths, overflow }
//   charBudget(ctx, block)       → integer, safe character budget for the rewrite prompt
//
//   node pdfFit.mjs resume.pdf     // self-validation: re-wrap every editable block's
//                                  // own text and compare against the real line count
//
// Measurement source (decision B, 2026-09-11): the ORIGINAL font's Widths array from
// the PDF when the document's fonts cover the whole rewrite; otherwise the substitute
// TTF from backend/fonts/ for every rewritten line. Both give advances in em units;
// pdfCompat decided which applies (fonts[].write: 'original' | 'substitute').
// Sanity-checked: "Portfolio" at 9.96pt measures 38.9536 via the embedded Century
// Gothic Widths and 38.9536 via TeXGyreAdventor-Regular.otf.
//
// Wrapping model: resume blocks are left-aligned or justified paragraphs whose
// continuation lines start at the same x as the first line's text (verified on the
// overlay PNGs), so every line wraps at the same availWidth. Break at spaces only —
// no hyphenation: Word broke "Row-Level" at the hyphen, we won't, which only makes
// our estimate CONSERVATIVE (a whole word moves down instead of half). Justification
// stretches spaces after the break decision, so natural-width measurement reproduces
// Word's break points.

import * as m from 'mupdf'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const FONTS_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'fonts')

// family (from pdfCompat's fontFamily) + bold → file in backend/fonts/
const SUBSTITUTE_FILES = {
  'Arial':           b => `LiberationSans-${b ? 'Bold' : 'Regular'}.ttf`,
  'Helvetica':       b => `LiberationSans-${b ? 'Bold' : 'Regular'}.ttf`,
  'Times New Roman': b => `LiberationSerif-${b ? 'Bold' : 'Regular'}.ttf`,
  'Courier New':     b => `LiberationMono-${b ? 'Bold' : 'Regular'}.ttf`,
  'Calibri':         b => `Carlito-${b ? 'Bold' : 'Regular'}.ttf`,
  'Cambria':         b => `Caladea-${b ? 'Bold' : 'Regular'}.ttf`,
  'Georgia':         b => `Gelasio-${b ? 'Bold' : 'Regular'}.ttf`,
  'Century Gothic':  b => `TeXGyreAdventor-${b ? 'Bold' : 'Regular'}.otf`,
  'Garamond':        b => `EBGaramond-${b ? 'Bold' : 'Regular'}.ttf`,
  'Verdana':         b => `DejaVuSans-${b ? 'Bold' : 'Regular'}.ttf`,
}

function winAnsiCode(ch) { return ch === '–' ? 0x96 : ch.charCodeAt(0) }

// ── metrics providers: both expose advance(ch) in em units (1.0 = font size)

function widthsMetrics(fontObj) {           // from the PDF's own font dictionary
  let f = fontObj
  if (f.isIndirect()) f = f.resolve()
  const fc = f.get('FirstChar')?.asNumber?.()
  let w = f.get('Widths')
  if (w && w.isIndirect()) w = w.resolve()
  if (!Number.isFinite(fc) || !w || !w.isArray()) return null
  const table = {}
  for (let i = 0; i < w.length; i++) table[fc + i] = w.get(i).asNumber() / 1000
  if (!table[32]) table[32] = table[46] || 0.25   // some subsets zero the space width; fall back
  return { kind: 'original', advance: ch => table[winAnsiCode(ch)] ?? 0, has: ch => (table[winAnsiCode(ch)] || 0) > 0 || ch === ' ' }
}

const subCache = new Map()
function substituteMetrics(family, bold) {
  const key = family + '|' + bold
  if (subCache.has(key)) return subCache.get(key)
  const fileFn = SUBSTITUTE_FILES[family]
  if (!fileFn) return null
  const file = path.join(FONTS_DIR, fileFn(bold))
  if (!fs.existsSync(file)) { console.warn(`pdfFit: missing substitute ${file}`); return null }
  const font = new m.Font(family, fs.readFileSync(file))
  const met = { kind: 'substitute', file: path.basename(file),
    advance: ch => { const g = font.encodeCharacter(ch.codePointAt(0)); return g ? font.advanceGlyph(g) : 0 },
    has: ch => font.encodeCharacter(ch.codePointAt(0)) !== 0 }
  subCache.set(key, met)
  return met
}

// ── context: which metrics measure which font of this document

export function buildFitContext(pdfBuffer, compat, blocksDoc) {
  const doc = m.Document.openDocument(pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer), 'application/pdf')
  // collect the PDF's font objects by base name across pages
  const pdfFonts = {}
  for (let p = 0; p < doc.countPages(); p++) {
    let res = doc.loadPage(p).getObject().get('Resources'); if (res.isIndirect()) res = res.resolve()
    let fonts = res?.get('Font'); if (fonts && fonts.isIndirect()) fonts = fonts.resolve()
    if (!fonts || !fonts.isDictionary()) continue
    const keys = []; fonts.forEach((v, k) => keys.push(String(k)))
    for (const k of keys) {
      let f = fonts.get(k); if (f.isIndirect()) f = f.resolve()
      const base = String(f.get('BaseFont')?.asName?.() || k)
      if (!pdfFonts[base]) pdfFonts[base] = f
    }
  }
  // per compat font entry: the metrics that will measure rewrites in that font.
  // write:'original' → the PDF's Widths; otherwise the substitute file.
  const byBase = {}
  for (const cf of compat?.fonts || []) {
    const metrics = cf.write === 'original'
      ? widthsMetrics(pdfFonts[cf.base]) || substituteMetrics(cf.family, cf.bold)
      : substituteMetrics(cf.family, cf.bold) || widthsMetrics(pdfFonts[cf.base])
    byBase[cf.base] = { ...cf, metrics }
    byBase[cf.base.replace(/^[A-Z]{6}\+/, '')] = byBase[cf.base]
  }
  return { byBase, pages: blocksDoc?.pages || [] }
}

function metricsFor(ctx, block) {
  const name = block.font?.name || ''
  const hit = ctx.byBase[name] || Object.values(ctx.byBase).find(e => e.base.endsWith(name) || name.endsWith(e.family?.replace(/ /g, '') || '\u0000'))
  return hit?.metrics || null
}

// ── measuring and wrapping

export function measure(metrics, text, size) {
  let w = 0
  for (const ch of text) w += metrics.advance(ch)
  return w * size
}

// greedy wrap at spaces; returns the lines and each line's natural width
export function wrapText(metrics, text, size, width) {
  const words = text.split(/\s+/).filter(Boolean)
  const space = metrics.advance(' ') * size
  const lines = []
  let cur = '', curW = 0
  for (const word of words) {
    const wW = measure(metrics, word, size)
    if (!cur) { cur = word; curW = wW; continue }
    if (curW + space + wW <= width) { cur += ' ' + word; curW += space + wW }
    else { lines.push({ text: cur, width: curW }); cur = word; curW = wW }
  }
  if (cur) lines.push({ text: cur, width: curW })
  return lines
}

// ── the fit rule

export function fitCheck(ctx, block, newText) {
  const metrics = metricsFor(ctx, block)
  if (!metrics) return { fits: false, reason: 'no metrics for font ' + (block.font?.name || '?') }
  const size = block.font.size
  const text = (block.type === 'skill' ? block.label + ' ' : '') + newText
  // characters the measuring font cannot draw are a hard failure BEFORE width:
  // a missing glyph renders as nothing
  const missing = [...new Set([...text.replace(/\s/g, '')].filter(ch => !metrics.has(ch)))]
  if (missing.length) return { fits: false, reason: 'characters not in font: ' + missing.join(''), missing }
  const lines = wrapText(metrics, text, size, block.availWidth)
  const overflowPt = Math.max(0, ...lines.map(l => l.width - block.availWidth))
  return {
    fits: lines.length <= block.maxLines && overflowPt <= 0,
    linesNeeded: lines.length, maxLines: block.maxLines,
    lines: lines.map(l => l.text), widths: lines.map(l => Math.round(l.width * 100) / 100),
    availWidth: block.availWidth, metricsKind: metrics.kind,
  }
}

// character budget for the rewrite prompt: how long may the new text be?
// Derived from this block's own text density (its chars per point), scaled to the
// full box capacity, minus a safety margin for wrap slack. Skill blocks reserve the
// label, which is not rewritten.
export function charBudget(ctx, block, safety = 0.93) {
  const metrics = metricsFor(ctx, block)
  const size = block.font.size
  const own = (block.type === 'skill' ? block.label + ' ' + block.text : block.text)
  const avgAdv = own.length ? measure(metrics, own, size) / own.length : size * 0.5
  const capacity = block.maxLines * block.availWidth
  let budget = Math.floor((capacity / avgAdv) * safety) - (block.type === 'skill' ? block.label.length + 1 : 0)
  // the safety margin must never demand shortening of text that already fits:
  // if the block's own text passes the fit rule, its length is a proven-safe floor
  const ownFit = fitCheck(ctx, block, block.text)
  if (ownFit.fits) budget = Math.max(budget, block.text.length)
  return Math.max(20, budget)
}

// ── CLI self-validation: every editable block's own text must fit its own box
if (process.argv[1] && /pdfFit\.mjs$/.test(process.argv[1])) {
  const file = process.argv[2]
  if (!file) { console.error('usage: node pdfFit.mjs resume.pdf'); process.exit(1) }
  const { checkPdfCompat } = await import('./pdfCompat.mjs')
  const { extractBlocks } = await import('./pdfBlocks.mjs')
  const buf = fs.readFileSync(file)
  const compat = checkPdfCompat(buf)
  if (compat.mode !== 'surgical') { console.error('not surgical:', compat.reason); process.exit(1) }
  const blocksDoc = extractBlocks(buf)
  const ctx = buildFitContext(buf, compat, blocksDoc)
  let pass = 0, fail = 0
  for (const b of blocksDoc.blocks.filter(x => x.editable)) {
    const r = fitCheck(ctx, b, b.text)
    const ok = r.fits
    ok ? pass++ : fail++
    const flag = ok ? 'ok  ' : 'FAIL'
    if (!ok || process.argv.includes('-v'))
      console.log(`${flag} ${b.id.padEnd(4)} ${String(r.linesNeeded)}/${r.maxLines}L budget ${charBudget(ctx, b)} (own ${b.text.length + (b.type === 'skill' ? b.label.length + 1 : 0)} ch) ${r.reason || ''} ${!ok && r.widths ? 'widths ' + r.widths.join(',') + ' avail ' + r.availWidth : ''}`)
  }
  console.log(`self-validation: ${pass} fit, ${fail} failed, metrics: ${[...new Set(blocksDoc.blocks.filter(x => x.editable).map(b => metricsFor(ctx, b)?.kind))].join(',')}`)
}
