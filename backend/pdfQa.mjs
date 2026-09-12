// pdfQa.mjs — A7-S6. QA gate on the surgical output before it is served. Pure read,
// no model call. Any failure → serve the HTML fallback for this run and log why.
//
//   import { qaSurgicalOutput } from './pdfQa.mjs'
//   const qa = qaSurgicalOutput(originalBuffer, outputBuffer, blocksDoc, texts)
//   // { pass, checks: { pageCount, margins, overlap, links, textSwap }, failures[] }
//
//   node pdfQa.mjs original.pdf out.pdf     // demo: extracts blocks, reruns the demo
//                                           // texts, prints each check
//
// Checks:
//  1. pageCount   — unchanged
//  2. margins     — no text glyph outside the original page's text extent (+2pt)
//  3. overlap     — no two text lines on a page overlap vertically AND horizontally
//                   (catches double-painted or mis-positioned writes)
//  4. links       — every URI of the original is present in the output
//  5. textSwap    — for every replaced block: its NEW text appears exactly once in
//                   the extracted text and its OLD text zero times (the check that
//                   would have caught the white-box cover-up shipping ATS-visible
//                   ghost text, found 2026-09-12)
import * as m from 'mupdf'
import fs from 'node:fs'

const norm = s => s.toLowerCase().replace(/[\s\u00ad]+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()

function readPages(buf) {
  const doc = m.Document.openDocument(buf instanceof Uint8Array ? buf : new Uint8Array(buf), 'application/pdf')
  const pages = []
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p)
    const st = JSON.parse(page.toStructuredText().asJSON())
    const lines = st.blocks.filter(b => b.type === 'text').flatMap(b => b.lines)
      .map(l => ({ text: l.text, x0: l.bbox.x, y0: l.bbox.y, x1: l.bbox.x + l.bbox.w, y1: l.bbox.y + l.bbox.h }))
      .filter(l => l.text.trim())
    pages.push({ lines, links: page.getLinks().map(k => k.getURI()), bounds: page.getBounds() })
  }
  return pages
}

export function qaSurgicalOutput(originalBuffer, outputBuffer, blocksDoc, texts) {
  const failures = []
  const orig = readPages(originalBuffer)
  const out = readPages(outputBuffer)
  const checks = {}

  // 1 page count
  checks.pageCount = orig.length === out.length
  if (!checks.pageCount) failures.push(`pageCount: ${orig.length} → ${out.length}`)

  // 2 margins: output text stays inside the original text extent per page (+2pt)
  checks.margins = true
  out.forEach((pg, p) => {
    const o = orig[p]
    if (!o) return
    const ox0 = Math.min(...o.lines.map(l => l.x0)) - 2, ox1 = Math.max(...o.lines.map(l => l.x1)) + 2
    const oy0 = Math.min(...o.lines.map(l => l.y0)) - 2, oy1 = Math.max(...o.lines.map(l => l.y1)) + 2
    for (const l of pg.lines) {
      if (l.x0 < ox0 || l.x1 > ox1 || l.y0 < oy0 || l.y1 > oy1) {
        checks.margins = false
        failures.push(`margins p${p + 1}: "${l.text.slice(0, 40)}" at ${Math.round(l.x0)},${Math.round(l.y0)}–${Math.round(l.x1)},${Math.round(l.y1)}`)
      }
    }
  })

  // 3 overlap: two lines sharing >30% vertical extent and horizontally intersecting
  checks.overlap = true
  out.forEach((pg, p) => {
    const ls = [...pg.lines].sort((a, b) => a.y0 - b.y0)
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j]
      if (b.y0 > a.y1) break
      const vOver = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
      const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0)
      if (vOver > 0.3 * minH && a.x0 < b.x1 && b.x0 < a.x1) {
        checks.overlap = false
        failures.push(`overlap p${p + 1}: "${a.text.slice(0, 30)}" ∩ "${b.text.slice(0, 30)}"`)
      }
    }
  })

  // 4 links preserved
  const origLinks = new Set(orig.flatMap(pg => pg.links))
  const outLinks = new Set(out.flatMap(pg => pg.links))
  checks.links = [...origLinks].every(u => outLinks.has(u))
  if (!checks.links) failures.push('links missing: ' + [...origLinks].filter(u => !outLinks.has(u)).join(', '))

  // 5 text swap: new exactly once, old zero times (only for blocks actually replaced
  // with different text)
  checks.textSwap = true
  const allText = norm(out.flatMap(pg => pg.lines.map(l => l.text)).join(' '))
  const count = (h, n) => { let c = 0, i = 0; while ((i = h.indexOf(n, i)) !== -1) { c++; i += n.length } return c }
  for (const b of blocksDoc.blocks) {
    const t = texts[b.id]
    if (t === undefined || norm(t) === norm(b.text)) continue
    const nNew = count(allText, norm(t))
    // count OLD in the text with NEW struck out — a rewrite that contains the old
    // wording as a substring ("Delivered " + old) is not a leak
    const struck = allText.split(norm(t)).join(' ')
    const nOld = norm(b.text).length > 15 ? count(struck, norm(b.text)) : 0
    if (nNew !== 1 || nOld !== 0) {
      checks.textSwap = false
      failures.push(`textSwap ${b.id}: new×${nNew} old×${nOld}`)
    }
  }

  return { pass: failures.length === 0, checks, failures }
}

if (process.argv[1] && /pdfQa\.mjs$/.test(process.argv[1])) {
  const { checkPdfCompat } = await import('./pdfCompat.mjs')
  const { extractBlocks } = await import('./pdfBlocks.mjs')
  const [orig, outf] = [process.argv[2], process.argv[3]]
  if (!outf) { console.error('usage: node pdfQa.mjs original.pdf out.pdf'); process.exit(1) }
  const buf = fs.readFileSync(orig)
  const bd = extractBlocks(buf)
  const texts = {}
  for (const b of bd.blocks) if (b.editable && b.type === 'bullet') texts[b.id] = 'Delivered ' + b.text.charAt(0).toLowerCase() + b.text.slice(1)
  for (const b of bd.blocks) if (b.type === 'skill') texts[b.id] = b.text.split(', ').reverse().join(', ')
  const qa = qaSurgicalOutput(buf, fs.readFileSync(outf), bd, texts)
  for (const [k, v] of Object.entries(qa.checks)) console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`)
  for (const f of qa.failures) console.log('  ·', f)
  console.log(qa.pass ? 'QA PASS' : 'QA FAIL')
}
