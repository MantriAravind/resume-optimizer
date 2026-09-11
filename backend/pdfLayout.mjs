// pdfLayout.mjs — A7-1. Reads a resume PDF and returns its layout, line by line.
//
// For every line: text, alignment (left | center | right | split), indent from the
// left margin, font family, bold, italic, size, and any link under it. A "split" line
// is the classic "Company .......... Jan 2024 - Present": two runs far apart on one
// baseline; each half keeps its own alignment. Two-column resumes are detected and
// flagged, not guessed at.
//
// Uses pdfjs-dist (already a dependency of pdf-parse v2). Pure read; no model call.
//
//   import { readPdfLayout } from './pdfLayout.mjs'
//   const layout = await readPdfLayout(buffer)   // { lines:[...], fonts:{...}, columns:false, pages:n }
//
//   node pdfLayout.mjs resume.pdf                 // prints the lines as a table

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const LINE_TOL = 2.5          // pt: items within this Δy share a baseline
const SPLIT_GAP = 36          // pt: a gap wider than this on one baseline = two segments
const CENTER_TOL = 14         // pt: |line centre − page centre| under this = centred

function fontFacts(name = '') {
  // pdf font names: "ABCDEF+TimesNewRomanPS-BoldMT", "Calibri-BoldItalic", "Arial,Bold"
  const n = name.replace(/^[A-Z]{6}\+/, '')
  const lower = n.toLowerCase()
  const bold = /bold|black|heavy|semibold|demibold/.test(lower) || /,bold/.test(lower)
  const italic = /italic|oblique/.test(lower)
  // Match on the whole name: "LiberationSerif-Bold" must not become "Liberation".
  let family = n.split(/[-,+]/)[0].replace(/(PS|MT|PSMT)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  const fam = lower.replace(/[^a-z]/g, '')
  if (/liberationserif|dejavuserif|nimbusroman|freeserif/.test(fam)) family = 'Times New Roman'
  else if (/liberationsans|dejavusans|nimbussans|freesans/.test(fam)) family = 'Arial'
  else if (/liberationmono|dejavusansmono/.test(fam)) family = 'Courier New'
  else if (/timesnewroman|times/.test(fam)) family = 'Times New Roman'
  else if (/arial/.test(fam)) family = 'Arial'
  else if (/helvetica/.test(fam)) family = 'Helvetica'
  else if (/calibri/.test(fam)) family = 'Calibri'
  else if (/cambria/.test(fam)) family = 'Cambria'
  else if (/georgia/.test(fam)) family = 'Georgia'
  else if (/garamond/.test(fam)) family = 'Garamond'
  else if (/verdana/.test(fam)) family = 'Verdana'
  else if (/segoeui|segoe/.test(fam)) family = 'Segoe UI'
  return { family, bold, italic, raw: n }
}

export async function readPdfLayout(buffer) {
  // Standard 14 fonts ship with pdfjs; pointing at them silences a warning per page.
  let standardFontDataUrl
  try { standardFontDataUrl = new URL('../../../standard_fonts/', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href } catch {}
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, standardFontDataUrl }).promise
  const lines = []
  const fontsSeen = {}
  let columnsSuspected = false
  let pageInfo = null

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const W = vp.width
    await page.getOperatorList()             // loads the fonts into commonObjs so their real names resolve
    const content = await page.getTextContent()
    const annots = await page.getAnnotations()
    const links = annots.filter(a => a.subtype === 'Link' && a.url && a.rect).map(a => ({ url: a.url, rect: a.rect }))

    // collect items with geometry
    const items = []
    for (const it of content.items) {
      if (!('str' in it)) continue
      const s = it.str
      if (!s || !s.trim()) continue
      const [a, b, c, d, x, y] = it.transform
      const size = Math.round(Math.hypot(b, d) * 10) / 10
      let fname = it.fontName
      try { const f = page.commonObjs.get(it.fontName); if (f && f.name) fname = f.name } catch {}
      items.push({ s, x, y, w: it.width, h: it.height || size, size, fontName: fname })
    }
    // group into baselines
    items.sort((i, j) => (j.y - i.y) || (i.x - j.x))
    const rows = []
    for (const it of items) {
      const row = rows.find(r => Math.abs(r.y - it.y) <= LINE_TOL)
      if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] })
    }
    rows.sort((r1, r2) => r2.y - r1.y)

    // page margins: the most common left x is the left margin
    const xs = rows.map(r => Math.min(...r.items.map(i => i.x)))
    const leftMargin = mode(xs.map(x => Math.round(x)))
    // Right edge = where lines usually end, not the single widest one (an overflowing
    // header line must not define the margin for everything else).
    const ends = rows.map(r => Math.max(...r.items.map(i => i.x + i.w))).sort((a, b) => a - b)
    const rightEdge = ends[Math.min(ends.length - 1, Math.floor(ends.length * 0.9))]
    const pageCenter = W / 2
    if (!pageInfo) pageInfo = { width: W, height: vp.height, left: leftMargin, right: Math.round(W - rightEdge), top: Math.round(vp.height - rows[0].y - (rows[0].items[0].size || 10)) }

    for (const r of rows) {
      r.items.sort((i, j) => i.x - j.x)
      // split into segments where the horizontal gap is large
      const segs = []
      for (const it of r.items) {
        const last = segs[segs.length - 1]
        if (last && it.x - (last.x1) > SPLIT_GAP) segs.push({ items: [it], x0: it.x, x1: it.x + it.w })
        else if (last) { last.items.push(it); last.x1 = Math.max(last.x1, it.x + it.w) }
        else segs.push({ items: [it], x0: it.x, x1: it.x + it.w })
      }
      // three or more segments repeatedly → probably columns
      if (segs.length >= 3) columnsSuspected = true

      const segOut = segs.map(sg => {
        // Rebuild spaces from geometry: a gap wider than a quarter of the font size
        // between two runs is a space the PDF encoded as positioning, not as a glyph.
        let text = ''
        let prev = null
        for (const it of sg.items) {
          if (prev) {
            const gap = it.x - (prev.x + prev.w)
            const needs = gap > Math.max(1.2, it.size * 0.18) && !/\s$/.test(text) && !/^\s/.test(it.s)
            if (needs) text += ' '
          }
          text += it.s
          prev = it
        }
        text = text.replace(/\s+/g, ' ').trim()
        const f = fontFacts(sg.items[0].fontName)
        fontsSeen[f.family] = (fontsSeen[f.family] || 0) + 1
        const size = sg.items[0].size
        const mid = (sg.x0 + sg.x1) / 2
        let align = 'left'
        const leftGap = sg.x0 - leftMargin, rightGap = rightEdge - sg.x1
        // Centred = balanced whitespace on both sides, not merely "straddles the middle":
        // a long bullet can straddle it too.
        const isBullet = /^[•\-–—·▪●o\u2022]\s/.test(text)
        if (!isBullet && Math.abs(mid - pageCenter) <= CENTER_TOL && leftGap >= 24 && Math.abs(leftGap - rightGap) <= 20) align = 'center'
        else if (Math.abs(rightGap) <= 12 && leftGap > 40) align = 'right'
        const link = links.find(l => sg.x0 < l.rect[2] && sg.x1 > l.rect[0] && r.y >= l.rect[1] - 2 && r.y <= l.rect[3] + 2)
        return { text, align, indent: Math.max(0, Math.round(sg.x0 - leftMargin)), font: f.family, bold: f.bold, italic: f.italic, size, link: link ? link.url : null }
      })

      // Page furniture: "1 of 2", a lone page number, a running header/footer at the
      // page edge. Kept in the layout (so nothing is silently dropped) but flagged.
      const joined = segOut.map(s => s.text).join(' ')
      const furniture = /^(page\s+)?\d+(\s+of\s+\d+)?$/i.test(joined.trim()) && (r.y < 60 || r.y > vp.height - 60)
      if (segOut.length === 1) lines.push({ page: p, y: Math.round(r.y * 10) / 10, ...segOut[0], furniture })
      else {
        // Inside a split line a segment is left or right, never centred: the middle
        // segment of a three-part line would otherwise straddle the page centre.
        for (const sg of segOut) if (sg.align === 'center') sg.align = 'left'
        lines.push({ page: p, y: Math.round(r.y * 10) / 10, align: 'split', text: joined, segments: segOut, indent: segOut[0].indent, font: segOut[0].font, bold: segOut[0].bold, italic: segOut[0].italic, size: segOut[0].size, link: null, furniture })
      }
    }
  }
  return { lines, fonts: fontsSeen, columns: columnsSuspected, pages: doc.numPages, page: pageInfo }
}

function mode(arr) {
  const c = {}; let best = arr[0], n = 0
  for (const v of arr) { c[v] = (c[v] || 0) + 1; if (c[v] > n) { n = c[v]; best = v } }
  return best
}

// ── CLI ──
if (process.argv[1] && process.argv[1].endsWith('pdfLayout.mjs') && process.argv[2]) {
  const fs = await import('node:fs')
  const buf = fs.readFileSync(process.argv[2])
  const L = await readPdfLayout(buf)
  console.log(`pages ${L.pages} · fonts ${JSON.stringify(L.fonts)} · columns suspected: ${L.columns}\n`)
  console.log('align   ind  size  B I  font              text')
  for (const l of L.lines) {
    const flag = (l.bold ? 'B' : '·') + ' ' + (l.italic ? 'I' : '·')
    const t = l.align === 'split' ? l.segments.map(s => `[${s.align}] ${s.text}`).join('  |  ') : l.text
    console.log(`${(l.furniture ? 'FURN' : l.align).padEnd(7)} ${String(l.indent).padStart(3)}  ${String(l.size).padStart(4)}  ${flag}  ${l.font.padEnd(16)}  ${t}${l.link ? '  → ' + l.link : ''}`)
  }
}
