// pdfHighlight.mjs — preview-only highlights (final design, 2026-09-13).
// Draws translucent green/amber boxes over block lines on a COPY of the surgical
// PDF and renders page PNGs from it. The copy is discarded — the downloadable PDF
// never carries highlights. Technique: ExtGState alpha (ca/CA 0.32) + fill rects,
// proven to render with text readable underneath.
//
//   renderHighlightedPages(pdfBuffer, blocksDoc, colourById, scale?) → [pngBase64]
//   colourById: { blockId: 'green' | 'amber' }
import * as m from 'mupdf'

// hues and strengths mirror the editor's marks (rgba(140,230,140,.5) /
// rgba(255,217,102,.55)) — the preview read paler at the first 0.32 alpha
const RGB = { green: '0.55 0.9 0.55', amber: '1 0.851 0.4' }
const ALPHA = { green: 0.5, amber: 0.55 }

// wordRects: [{ page, x0, x1, top, bottom, colour }] — precise word-level marks
// (green skill words); colourById still paints whole blocks (amber rewording).
export function renderHighlightedPages(pdfBuffer, blocksDoc, colourById, scale = 2, wordRects = []) {
  const doc = m.PDFDocument.openDocument(pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer), 'application/pdf')
  for (let p = 0; p < doc.countPages(); p++) {
    const marked = (blocksDoc?.blocks || []).filter(b => b.page === p && RGB[colourById?.[b.id]])
    const words = (wordRects || []).filter(w => w.page === p && RGB[w.colour])
    if (!marked.length && !words.length) continue
    const page = doc.loadPage(p)
    const inv = m.Matrix.invert(page.getTransform())
    const pt = (x, y) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]
    let res = page.getObject().get('Resources'); if (res.isIndirect()) res = res.resolve()
    let gs = res.get('ExtGState')
    if (!gs || gs.isNull()) { gs = doc.newDictionary(); res.put('ExtGState', gs) } else if (gs.isIndirect()) gs = gs.resolve()
    for (const [name, a] of [['OptHLg', ALPHA.green], ['OptHLa', ALPHA.amber]]) {
      if (!gs.get(name) || gs.get(name).isNull()) {
        const g = doc.newDictionary(); g.put('ca', a); g.put('CA', a)
        gs.put(name, doc.addObject(g))
      }
    }
    let ops = ''
    for (const b of marked) {
      const colour = RGB[colourById[b.id]]
      // full available width, not the original line's extent: replaced text wraps
      // differently, and tracing old extents leaves unhighlighted tails mid-word
      const right = (b.lines[0]?.x0 ?? 0) + (b.availWidth || 0)
      for (const ln of b.lines) {
        const [x0, y0] = pt(ln.x0 - 1, ln.bottom + 1)
        const [x1, y1] = pt(Math.max(ln.x1, right) + 1, ln.top - 1)
        ops += `q /${colourById[b.id] === 'green' ? 'OptHLg' : 'OptHLa'} gs ${colour} rg ${x0} ${y0} ${x1 - x0} ${y1 - y0} re f Q\n`
      }
    }
    for (const w of words) {
      const [x0, y0] = pt(w.x0 - 1, w.bottom + 1)
      const [x1, y1] = pt(w.x1 + 1, w.top - 1)
      ops += `q /${w.colour === 'green' ? 'OptHLg' : 'OptHLa'} gs ${RGB[w.colour]} rg ${x0} ${y0} ${x1 - x0} ${y1 - y0} re f Q\n`
    }
    const st = doc.addStream(ops, {})
    const pobj = page.getObject()
    const contents = pobj.get('Contents')
    const arr = doc.newArray()
    if (contents.isArray()) { for (let i = 0; i < contents.length; i++) arr.push(contents.get(i)) } else arr.push(contents)
    arr.push(st)
    pobj.put('Contents', arr)
  }
  const out = doc.saveToBuffer('').asUint8Array()
  const d2 = m.Document.openDocument(out, 'application/pdf')
  const pages = []
  for (let p = 0; p < d2.countPages(); p++)
    pages.push(Buffer.from(d2.loadPage(p).toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false).asPNG()).toString('base64'))
  // the highlighted PDF itself: shown in the preview pane as a vector (crisp at any
  // width — rasters go soft in a ~640px pane); display-only, never the download
  return { pages, previewPdf: Buffer.from(out).toString('base64') }
}
