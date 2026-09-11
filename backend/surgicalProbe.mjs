// surgicalProbe.mjs — A7-S1. Can we replace ONE line of text inside a resume PDF and
// leave everything else untouched?
//
//   node surgicalProbe.mjs resume.pdf "text that identifies the line" "replacement text"
//
// Steps, each printed: find the line (box, font, size) → find the page's font resource
// for that font (reuse the embedded font if the PDF has one) → redact the box (no black
// box) → write the new text at the same baseline with the same font and size → save
// → render page 1 to PNG → re-read the structured text to confirm the swap.

import * as m from 'mupdf'
import fs from 'node:fs'

const [,, file, needle, replacement] = process.argv
if (!file || !needle || !replacement) { console.error('usage: node surgicalProbe.mjs resume.pdf "needle" "replacement"'); process.exit(1) }

const doc = m.Document.openDocument(fs.readFileSync(file), 'application/pdf')
const nPages = doc.countPages()
let hit = null
for (let p = 0; p < nPages && !hit; p++) {
  const page = doc.loadPage(p)
  const st = JSON.parse(page.toStructuredText('preserve-spans').asJSON())
  // Word chops a visual line into fragments. Group every fragment that shares a
  // baseline (same y within a third of the height) into one visual line first.
  const frags = st.blocks.filter(b => b.type === 'text').flatMap(b => b.lines)
  const visual = []
  for (const f of frags.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    // A lone bullet glyph is left alone: it is not words, and it stays on the page.
    if (/^\s*[•\-–—·▪●o\u2022\u25AA]\s*$/.test(f.text)) continue
    const v = visual.find(v => Math.abs(v.bbox.y - f.bbox.y) < f.bbox.h * 0.34 && Math.abs(v.bbox.h - f.bbox.h) < 3)
    if (v) { v.text += (f.bbox.x > v.bbox.x + v.bbox.w + 1 ? ' ' : '') + f.text; v.bbox.w = Math.max(v.bbox.x + v.bbox.w, f.bbox.x + f.bbox.w) - v.bbox.x; v.parts++ }
    else visual.push({ text: f.text, font: f.font, bbox: { ...f.bbox }, parts: 1 })
  }
  const l = visual.find(v => v.text.includes(needle))
  if (l) hit = { p, page, line: l }
}
if (!hit) { console.error('needle not found'); process.exit(1) }
const { p, page, line } = hit
const bb = line.bbox   // top-left origin, y down
const pageBounds = page.getBounds()   // [x0,y0,x1,y1]
const pageH = pageBounds[3] - pageBounds[1]
console.log(`found on page ${p + 1}: box x=${bb.x.toFixed(1)} y=${bb.y.toFixed(1)} w=${bb.w.toFixed(1)} h=${bb.h.toFixed(1)} · font ${line.font.name} ${line.font.size}pt`)
console.log(`old (${line.parts} fragment${line.parts === 1 ? '' : 's'}): ${JSON.stringify(line.text)}`)

// ── font resource: reuse the page's own font object if its BaseFont matches
const pageObj = page.getObject()
let resources = pageObj.get('Resources')
if (resources.isIndirect()) resources = resources.resolve()
let fonts = resources.get('Font')
if (fonts && fonts.isIndirect()) fonts = fonts.resolve()
let fontKey = null, fontKind = ''
const want = line.font.name.replace(/^[A-Z]{6}\+/, '').toLowerCase()
if (fonts && fonts.isDictionary()) {
  fonts.forEach((val, key) => {
    const f = val.isIndirect() ? val.resolve() : val
    const base = String(f.get('BaseFont')?.asName?.() || '').replace(/^[A-Z]{6}\+/, '').toLowerCase()
    if (!fontKey && base && (base === want || base.replace(/[^a-z]/g, '') === want.replace(/[^a-z]/g, ''))) { fontKey = String(key); fontKind = f.get('FontDescriptor') ? 'embedded/descriptor' : 'base-14' }
  })
}
if (!fontKey) {
  // fall back to a built-in font with the same shape
  const std = /bold/i.test(line.font.name) ? (/serif|times/i.test(line.font.name) ? 'Times-Bold' : 'Helvetica-Bold') : (/serif|times/i.test(line.font.name) ? 'Times-Roman' : 'Helvetica')
  const fobj = doc.addSimpleFont(new m.Font(std), 'Latin')
  if (!fonts || !fonts.isDictionary()) { fonts = doc.newDictionary(); resources.put('Font', fonts) }
  fontKey = 'FOptyply'
  fonts.put(fontKey, fobj)
  fontKind = 'substituted ' + std
}
console.log(`font resource: /${fontKey} (${fontKind})`)

// ── redact just this line's box (no black box drawn)
// Inset, not padded: MuPDF erases every glyph whose box the rectangle touches, and
// neighbouring lines' ascenders/descenders overlap this line's box edges. Cutting
// the middle 60% of the line height removes this line's glyphs and no others.
const rect = [bb.x - 0.5, bb.y + bb.h * 0.2, bb.x + bb.w + 0.5, bb.y + bb.h * 0.8]
const red = page.createAnnotation('Redact')
red.setRect(rect)
red.update()
page.applyRedactions(false)
console.log('redacted box', rect.map(v => v.toFixed(1)).join(','))

// ── write the new text at the old baseline
// Structured-text boxes are in page space (top-down). Where that maps in the
// content stream depends on the page's own transform (Word sets its page box so
// content runs top-down; most others run bottom-up). Invert the page transform and
// map the baseline point through it instead of assuming either convention.
const ctm = page.getTransform()             // content space → page space
const inv = m.Matrix.invert(ctm)
const [cx, cy] = m.Matrix.transformPoint ? m.Matrix.transformPoint(inv, [bb.x, bb.y + bb.h * 0.78]) : (() => { const [a, b, c, d, e, f] = inv; const x = bb.x, y = bb.y + bb.h * 0.78; return [a * x + c * y + e, b * x + d * y + f] })()
console.log('page transform', JSON.stringify(ctm.map(v => Math.round(v * 100) / 100)), '→ content point', cx.toFixed(1), cy.toFixed(1))
const baseline = cy
const escaped = replacement.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const content = `q BT /${fontKey} ${line.font.size} Tf 1 0 0 1 ${cx.toFixed(2)} ${baseline.toFixed(2)} Tm (${escaped}) Tj ET Q\n`
// Word's export flips the coordinate system at the top of its content and never
// restores it, so anything appended inherits the flip. Wrap the original in q…Q and
// append ours after: it then runs in the page's own bottom-up space.
const stream = doc.addStream(content, null)
const qStream = doc.addStream('q\n', null), QStream = doc.addStream('\nQ\n', null)
let contents = pageObj.get('Contents')
const arr = doc.newArray()
arr.push(qStream)
if (contents.isArray()) { for (let i = 0; i < contents.length; i++) arr.push(contents.get(i)) } else arr.push(contents)
arr.push(QStream)
arr.push(stream)
pageObj.put('Contents', arr)
console.log('wrote new text at baseline y=' + baseline.toFixed(1))

// ── save + render + verify
const out = file.replace(/\.pdf$/i, '') + '.surgical.pdf'
fs.writeFileSync(out, doc.saveToBuffer('garbage,compress').asUint8Array())
const doc2 = m.Document.openDocument(fs.readFileSync(out), 'application/pdf')
const page2 = doc2.loadPage(p)
const pix = page2.toPixmap(m.Matrix.scale(2, 2), m.ColorSpace.DeviceRGB, false)
fs.writeFileSync(out.replace(/\.pdf$/, '.png'), pix.asPNG())
const st2 = JSON.parse(page2.toStructuredText('preserve-spans').asJSON())
const lines2 = st2.blocks.filter(b => b.type === 'text').flatMap(b => b.lines.map(l => l.text))
console.log('new text present in re-read:', lines2.some(t => t.includes(replacement.slice(0, 20))))
console.log('exactly one line contains the needle now:', lines2.filter(t => t.includes(needle)).length === 1)
console.log('line count before/after:', st2.blocks.filter(b => b.type === 'text').reduce((n, b) => n + b.lines.length, 0))
console.log('links on page after:', page2.getLinks().length)
console.log('saved', out, 'and', out.replace(/\.pdf$/, '.png'))
