// pdfHighlight.mjs — preview-only highlights (final design, 2026-09-13).
// Draws translucent green/amber boxes over block lines on a COPY of the surgical
// PDF and renders page PNGs from it. The copy is discarded — the downloadable PDF
// never carries highlights. Technique: ExtGState alpha (ca/CA 0.32) + fill rects,
// proven to render with text readable underneath.
//
//   renderHighlightedPages(pdfBuffer, blocksDoc, colourById, scale?) → [pngBase64]
//   colourById: { blockId: 'green' | 'amber' }
import * as m from 'mupdf'

const RGB = { green: '0.55 0.9 0.55', amber: '1 0.85 0.4' }

export function renderHighlightedPages(pdfBuffer, blocksDoc, colourById, scale = 2) {
  const doc = m.PDFDocument.openDocument(pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer), 'application/pdf')
  for (let p = 0; p < doc.countPages(); p++) {
    const marked = (blocksDoc?.blocks || []).filter(b => b.page === p && RGB[colourById?.[b.id]])
    if (!marked.length) continue
    const page = doc.loadPage(p)
    const inv = m.Matrix.invert(page.getTransform())
    const pt = (x, y) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]
    let res = page.getObject().get('Resources'); if (res.isIndirect()) res = res.resolve()
    let gs = res.get('ExtGState')
    if (!gs || gs.isNull()) { gs = doc.newDictionary(); res.put('ExtGState', gs) } else if (gs.isIndirect()) gs = gs.resolve()
    if (!gs.get('OptHL') || gs.get('OptHL').isNull()) {
      const g = doc.newDictionary(); g.put('ca', 0.32); g.put('CA', 0.32)
      gs.put('OptHL', doc.addObject(g))
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
        ops += `q /OptHL gs ${colour} rg ${x0} ${y0} ${x1 - x0} ${y1 - y0} re f Q\n`
      }
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
  return pages
}
