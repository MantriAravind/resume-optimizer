// pdfSurgical.mjs — A7-S5. Writes fitted block texts into a COPY of the original
// PDF. Recipe proven in the S5 experiment (2026-09-12):
//   - full-height white redaction box per original line (the S1 inset left the old
//     text's ascenders/descenders peeking out at 7.56pt leading)
//   - new text via a shipped substitute font registered with addSimpleFont('Latin'),
//     written at the ORIGINAL baselines with the original size
//   - every coordinate mapped device→user through the inverse page transform IN JS
//     (a `cm` wrapper double-transforms — that was the first experiment's bug)
//   - appended as a new stream in the page's Contents array, q…Q wrapped
//
//   import { writeSurgical } from './pdfSurgical.mjs'
//   const { pdf, skipped } = writeSurgical(pdfBuffer, compat, blocksDoc, texts)
//   // texts: { blockId: fittedText } — ONLY texts that already passed fitCheck;
//   // anything that wraps past maxLines here is skipped, never squeezed.
//
//   node pdfSurgical.mjs resume.pdf   // demo rewrite, renders out_p*.png
import * as m from 'mupdf'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { buildFitContext, wrapText } from './pdfFit.mjs'

const FONTS_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'fonts')
const FILES = {
  'Arial': b => `LiberationSans-${b?'Bold':'Regular'}.ttf`, 'Helvetica': b => `LiberationSans-${b?'Bold':'Regular'}.ttf`,
  'Times New Roman': b => `LiberationSerif-${b?'Bold':'Regular'}.ttf`, 'Courier New': b => `LiberationMono-${b?'Bold':'Regular'}.ttf`,
  'Calibri': b => `Carlito-${b?'Bold':'Regular'}.ttf`, 'Cambria': b => `Caladea-${b?'Bold':'Regular'}.ttf`,
  'Georgia': b => `Gelasio-${b?'Bold':'Regular'}.ttf`, 'Century Gothic': b => `TeXGyreAdventor-${b?'Bold':'Regular'}.otf`,
  'Garamond': b => `EBGaramond-${b?'Bold':'Regular'}.ttf`, 'Verdana': b => `DejaVuSans-${b?'Bold':'Regular'}.ttf`,
}
const esc = s => s.replace(/([()\\])/g, '\\$1')
const winAnsi = s => s.replace(/–/g, '\x96').replace(/[^\x00-\xff]/g, '?')
const pt = (mx, x, y) => [Math.round((mx[0]*x + mx[2]*y + mx[4])*100)/100, Math.round((mx[1]*x + mx[3]*y + mx[5])*100)/100]

export function writeSurgical(pdfBuffer, compat, blocksDoc, texts) {
  const doc = m.PDFDocument.openDocument(pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer), 'application/pdf')
  const ctx = buildFitContext(pdfBuffer, compat, blocksDoc)
  const familyOf = {}
  for (const f of compat.fonts || []) { familyOf[f.base] = f; familyOf[f.base.replace(/^[A-Z]{6}\+/, '')] = f }
  const refs = {}   // family|bold → { obj, name, metrics }
  const skipped = []
  const redactedPages = new Set()
  const linkAdds = []   // { page, x0, y0, x1, y1, uri } in device coords

  const fontRef = (family, bold) => {
    const k = family + '|' + bold
    if (!refs[k]) {
      const file = path.join(FONTS_DIR, (FILES[family] || FILES['Arial'])(bold))
      const font = new m.Font(family, fs.readFileSync(file))
      refs[k] = { obj: doc.addSimpleFont(font, 'Latin'), name: 'OptF' + (Object.keys(refs).length + 1),
        metrics: { advance: ch => { const g = font.encodeCharacter(ch.codePointAt(0)); return g ? font.advanceGlyph(g) : 0 }, has: ch => font.encodeCharacter(ch.codePointAt(0)) !== 0 } }
    }
    return refs[k]
  }

  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p)
    const inv = m.Matrix.invert(page.getTransform())
    let ops = ''
    const usedRefs = new Set()
    for (const b of blocksDoc.blocks.filter(x => x.page === p && texts[x.id] !== undefined)) {
      const cf = familyOf[b.font.name] || { family: 'Arial' }
      const fr = fontRef(cf.family, b.font.bold)
      const size = b.font.size
      // skill blocks: the bold label stays; only the value area is redacted/rewritten
      const isSkill = b.type === 'skill'
      const labelEnd = isSkill ? b.lines[0].runs[0].x1 + fr.metrics.advance(' ') * size : null
      const firstX = isSkill ? (b.lines[0].runs[1]?.x0 ?? labelEnd) : b.lines[0].x0   // old value's real start — a computed label-end left a sliver of the old first glyph
      const lines = wrapText(fr.metrics, texts[b.id], size, b.availWidth - (isSkill ? (firstX - b.lines[0].x0) : 0))
      if (lines.length > b.maxLines) { skipped.push(b.id); continue }
      b.lines.forEach((ln, i) => {
        const x0 = i === 0 && isSkill ? firstX : ln.x0
        // a Redact annotation REMOVES the old text from the content stream when
        // applied — a painted white box only hides it, and text extraction (and
        // every ATS) still reads the old words underneath (found 2026-09-12 when
        // the covered PDF extracted both versions of every bullet)
        const a = page.createAnnotation('Redact')
        a.setRect([x0 - 0.5, ln.top - 0.4, ln.x1 + 0.5, ln.bottom + 0.4])
        redactedPages.add(p)
      })
      const colour = b.font.colour && b.font.colour !== '#000000'
        ? [1, 3, 5].map(i => (parseInt(b.font.colour.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ')
        : '0 0 0'
      lines.forEach((line, i) => {
        const ln = b.lines[i]
        if (!ln) return
        const x0 = i === 0 && isSkill ? firstX : ln.x0
        const [bx, by] = pt(inv, x0, ln.y)
        ops += `q BT /${fr.name} ${size} Tf ${colour} rg 1 0 0 1 ${bx} ${by} Tm (${esc(winAnsi(line.text))}) Tj ET Q\n`
        // linked block: remember the new text extent for a fresh annotation
        if (b.links?.length) linkAdds.push({ page: p, x0, y0: ln.top, x1: x0 + line.width, y1: ln.bottom, uri: b.links[0] })
      })
      usedRefs.add(fr)
    }
    // applyRedactions sanitizes the page: fonts registered BEFORE it are
    // unreferenced at that moment and get stripped (the replaced text then fell
    // back to a serif). Apply first, then register against the fresh Resources.
    if (redactedPages.has(p)) page.applyRedactions(false, 0, 2, 0)   // no black boxes; keep images/line art; remove text
    if (!ops) continue
    let res = page.getObject().get('Resources'); if (res.isIndirect()) res = res.resolve()
    let fonts = res.get('Font'); if (!fonts || fonts.isNull()) { fonts = doc.newDictionary(); res.put('Font', fonts) } else if (fonts.isIndirect()) fonts = fonts.resolve()
    for (const fr of usedRefs) if (!fonts.get(fr.name) || fonts.get(fr.name).isNull()) fonts.put(fr.name, fr.obj)
    const streamObj = doc.addStream(`q\n${ops}Q`, {})
    const pobj = page.getObject()
    const contents = pobj.get('Contents')
    const arr = doc.newArray()
    if (contents.isArray()) { for (let i = 0; i < contents.length; i++) arr.push(contents.get(i)) } else arr.push(contents)
    arr.push(streamObj)
    pobj.put('Contents', arr)
  }
  // re-add link annotations over replaced linked text (device rect is what createLink wants)
  for (const L of linkAdds) {
    try { doc.loadPage(L.page).createLink([L.x0, L.y0, L.x1, L.y1], L.uri) } catch (e) { console.warn('link re-add failed: ' + e.message) }
  }
  return { pdf: Buffer.from(doc.saveToBuffer('garbage').asUint8Array()), skipped }
}

if (process.argv[1] && /pdfSurgical\.mjs$/.test(process.argv[1])) {
  const { checkPdfCompat } = await import('./pdfCompat.mjs')
  const { extractBlocks } = await import('./pdfBlocks.mjs')
  const buf = fs.readFileSync(process.argv[2])
  const compat = checkPdfCompat(buf)
  if (compat.mode !== 'surgical') { console.error('not surgical: ' + compat.reason); process.exit(1) }
  const bd = extractBlocks(buf)
  const texts = {}
  for (const b of bd.blocks) if (b.editable && b.type === 'bullet') texts[b.id] = 'Delivered ' + b.text.charAt(0).toLowerCase() + b.text.slice(1)
  for (const b of bd.blocks) if (b.type === 'skill') texts[b.id] = b.text.split(', ').reverse().join(', ')
  const { pdf, skipped } = writeSurgical(buf, compat, bd, texts)
  fs.writeFileSync('out.pdf', pdf)
  const d2 = m.Document.openDocument(pdf, 'application/pdf')
  for (let p = 0; p < d2.countPages(); p++) fs.writeFileSync(`out_p${p + 1}.png`, d2.loadPage(p).toPixmap(m.Matrix.scale(2, 2), m.ColorSpace.DeviceRGB, false).asPNG())
  console.log(`out.pdf written · ${Object.keys(texts).length} blocks · skipped: ${skipped.length ? skipped.join(',') : 'none'} · links in out: p1=${d2.loadPage(0).getLinks().length}`)
}
