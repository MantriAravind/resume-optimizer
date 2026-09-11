// pdfBlocks.mjs — A7-S3. Reads a resume PDF into BLOCKS: the units the optimizer
// rewrites and the surgical writer replaces. Stored at upload beside the file.
//
//   import { extractBlocks } from './pdfBlocks.mjs'
//   const { pages, blocks } = extractBlocks(buffer)
//
//   node pdfBlocks.mjs resume.pdf            // prints every block, one line each
//   node pdfBlocks.mjs resume.pdf --json     // full JSON
//
// A block is one bullet with its wrapped tail, one heading, one contact line, one
// skill line ("Label: values"), one paragraph. Per block: id, page, type, text,
// box, lines[] (each with baseline, box, runs[] carrying font/size/bold/italic/
// colour/link), font of the body run, maxLines (= lines.length: the fit rule must
// never exceed it), availWidth (block left edge → page right text margin: a one-line
// bullet that used 300pt of a 530pt line may grow to the margin, not to its own
// width), editable (bullet / paragraph / skill values — never name, contact,
// heading, title|date splits).
//
// Text comes from the glyphs on the page (walker), not from asJSON/asText: the
// walker gives the exact size (7.56, not 7.6), the colour per glyph (blue links),
// and lets us see the soft hyphen Word puts at a wrap — mupdf drops U+00AD from its
// text output (asJSON/asText) but the walker delivers it as "-", so a line ending in
// a hyphen gets `hyphen: true` and is joined to the next without a space ("Row-Level",
// not "Row- Level" or "RowLevel").
//
// Pure read. No model call. Synchronous.

import * as m from 'mupdf'
import fs from 'node:fs'

const BULLET_GLYPH = /^[\s•\-–—·▪●o\u2022\u25AA\u25CF\u2023\u2043\uF0B7\uF0A7]+$/
const RUN_GAP = 18            // pt: a gap wider than this inside one baseline = separate segment (title | date)
const SPLIT_RIGHT = 0.55      // a second segment starting past this fraction of page width = split line
const X_TOL = 3               // pt: continuation lines start within this of the block's text edge
const BASELINE_TOL = 0.34     // × size: glyphs whose baselines differ by less share a visual line

function fontFacts(name = '') {
  const n = name.replace(/^[A-Z]{6}\+/, '')
  const lower = n.toLowerCase()
  return {
    name: n,
    bold: /bold|black|heavy|semibold|demibold/.test(lower),
    italic: /italic|oblique/.test(lower),
  }
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const hex = c => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
const intersects = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

// ── 1. glyphs → stext lines → visual lines (baseline-merged, runs by font/colour)
function readPage(page, pageIndex) {
  const [px0, py0, px1, py1] = page.getBounds()
  const W = px1 - px0
  const st = page.toStructuredText('preserve-spans')
  const raw = []           // one entry per stext line: { bbox, chars[] }
  let cur = null
  st.walk({
    beginLine(bbox) { cur = { bbox, chars: [] } },
    onChar(c, origin, font, size, quad, color) {
      cur.chars.push({ c, x: origin[0], y: origin[1], font: font.getName(), size, color, x0: Math.min(quad[0], quad[4]), x1: Math.max(quad[2], quad[6]), top: Math.min(quad[1], quad[3]), bottom: Math.max(quad[5], quad[7]) })
    },
    endLine() { if (cur.chars.length) raw.push(cur) },
  })

  // bullet markers: lone glyph lines; kept as positions, dropped from the text.
  // Word emits "real", "-", "time" as three fragments, so a lone dash is a bullet
  // only when nothing on its baseline sits to its left.
  const markers = []
  const frags = []
  for (const r of raw) {
    const text = r.chars.map(k => k.c).join('')
    // Word emits spaces as their own fragments, often in another font (Times, Arial):
    // they are text, never bullets, and must not start a run of their own (below)
    if (!text.trim() || !BULLET_GLYPH.test(text)) { frags.push(r); continue }
    const k = r.chars[0]
    const isDash = /^[\s\-–—]+$/.test(text)
    const leftmost = !raw.some(o => o !== r && Math.abs(o.chars[0].y - k.y) < k.size * BASELINE_TOL && o.chars[0].x0 < k.x0)
    if (isDash && !leftmost) { frags.push(r); continue }
    markers.push({ y: k.y, x: k.x0, glyph: text.trim() })
  }

  // merge fragments on one baseline into visual lines; inside a line, runs change on
  // font / size / colour
  const lines = []
  for (const f of frags.sort((a, b) => a.chars[0].y - b.chars[0].y || a.chars[0].x0 - b.chars[0].x0)) {
    const y = f.chars[0].y, size = f.chars[0].size
    let line = lines.find(l => Math.abs(l.y - y) < size * BASELINE_TOL)
    if (!line) { line = { y, chars: [], stextRight: 0 }; lines.push(line) }
    line.chars.push(...f.chars)
    line.stextRight = Math.max(line.stextRight, f.bbox[2])
  }
  for (const line of lines) {
    line.chars.sort((a, b) => a.x0 - b.x0)
    line.runs = []
    const runs = line.runs
    let prev = null
    for (const k of line.chars) {
      const key = `${k.font}|${round(k.size, 2)}|${hex(k.color)}`
      const gap = prev ? k.x0 - prev.x1 : 0
      const last = runs[runs.length - 1]
      if (/^\s$/.test(k.c)) {
        // a space joins whatever run is open (whatever font Word gave the glyph)
        if (last && !/\s$/.test(last.text)) { last.text += ' '; last.x1 = Math.max(last.x1, k.x1) }
        prev = k
        continue
      }
      if (last && last.key === key && gap <= RUN_GAP) {
        if (gap > k.size * 0.15 && !/\s$/.test(last.text)) last.text += ' '   // positioned gap with no space glyph
        last.text += k.c; last.x1 = Math.max(last.x1, k.x1); last.top = Math.min(last.top, k.top); last.bottom = Math.max(last.bottom, k.bottom)
      } else {
        if (last && gap > k.size * 0.15 && gap <= RUN_GAP && !/\s$/.test(last.text)) last.text += ' '
        const ff = fontFacts(k.font)
        runs.push({ key, text: k.c, font: ff.name, size: round(k.size, 2), bold: ff.bold, italic: ff.italic, colour: hex(k.color), x0: k.x0, x1: k.x1, top: k.top, bottom: k.bottom, gapBefore: prev ? gap : 0 })
      }
      prev = k
    }
    if (!runs.length) continue                      // a baseline holding only space glyphs
    // segments: runs separated by a wide gap (title ........ date)
    const segments = [[runs[0]]]
    for (const r of runs.slice(1)) { if (r.gapBefore > RUN_GAP) segments.push([r]); else segments[segments.length - 1].push(r) }
    line.runs = runs.map(({ key, gapBefore, ...r }) => ({ ...r, x0: round(r.x0), x1: round(r.x1) }))
    line.segments = segments.map(seg => ({ x0: seg[0].x0, x1: seg[seg.length - 1].x1, text: seg.map(r => r.text).join('') }))
    line.text = line.segments.map(s => s.text).join('   ')
    line.x0 = round(runs[0].x0); line.x1 = round(runs[runs.length - 1].x1)
    line.top = round(Math.min(...runs.map(r => r.top))); line.bottom = round(Math.max(...runs.map(r => r.bottom)))
    line.size = runs[0].size
    line.y = round(line.y)
    // the walker (unlike asJSON) delivers Word's wrap hyphen as "-": join such lines
    // without a space ("Row-Level"). Whether it was a compound or a syllable break we
    // cannot tell; the visible hyphen is kept.
    line.hyphen = /[A-Za-z]-\s*$/.test(line.text)
    line.bullet = markers.find(mk => Math.abs(mk.y - line.y) < line.size * BASELINE_TOL && mk.x < line.x0) || null
    delete line.chars; delete line.stextRight
  }
  const kept = lines.filter(l => l.runs.length)
  kept.sort((a, b) => a.y - b.y)

  // links → runs they cover
  const links = page.getLinks().map(l => { const [x0, y0, x1, y1] = l.getBounds(); return { x0, y0, x1, y1, uri: l.getURI() } })
  for (const line of kept) for (const r of line.runs) {
    // a link owns a run when it covers at least half of it — a link box's edge
    // touching the neighbouring run by a fraction of a point is not a link
    const hit = links.find(L => intersects(L, { x0: r.x0, x1: r.x1, y0: r.top, y1: r.bottom })
      && (Math.min(L.x1, r.x1) - Math.max(L.x0, r.x0)) >= 0.5 * (r.x1 - r.x0))
    if (hit) r.link = hit.uri
  }

  return { page: pageIndex, W, H: py1 - py0, lines: kept, markers, links }
}

// ── 2. visual lines → blocks
function classify(line, ctx) {
  const { W, page, firstHeadingSeen, nameSeen } = ctx
  const text = line.text.trim()
  const letters = text.replace(/[^A-Za-z]/g, '')
  const allBold = line.runs.every(r => r.bold)
  const upper = letters.length >= 3 && letters === letters.toUpperCase()
  if (line.segments.length >= 2 && line.segments[1].x0 > W * SPLIT_RIGHT) return 'split'
  if (page === 0 && !nameSeen && allBold && line.size >= ctx.bodySize * 1.5) return 'name'
  if (allBold && upper && text.length <= 60 && !line.bullet) return 'heading'
  if (page === 0 && !firstHeadingSeen && /@|\(\d{3}\)|\d{3}[-. ]\d{3}[-. ]\d{4}|\|/.test(text)) return 'contact'
  if (line.bullet) return 'bullet'
  if (line.runs[0].bold && /:\s*$/.test(line.runs[0].text) && line.runs.length > 1) return 'skill'
  if (line.runs.length === 1 && line.runs[0].bold && text.split(/\s+/).length <= 8) return 'line'   // "Insurance Billing & Reporting Data Platform"
  if (text.split(/\s+/).length >= 6) return 'paragraph'
  return 'line'
}

export function extractBlocks(buffer) {
  const doc = m.Document.openDocument(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), 'application/pdf')
  const pages = []
  const blocks = []
  let id = 0
  let nameSeen = false
  for (let p = 0; p < doc.countPages(); p++) {
    const pg = readPage(doc.loadPage(p), p)
    // body size = the most common size by character count; right margin = the
    // right edge wrapped lines actually reach (max over the page)
    const sizeCount = {}
    for (const l of pg.lines) for (const r of l.runs) sizeCount[r.size] = (sizeCount[r.size] || 0) + r.text.length
    const bodySize = Number(Object.entries(sizeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 10)
    const rightMargin = round(Math.max(...pg.lines.map(l => l.x1)))
    const leftMargin = round(Math.min(...pg.lines.map(l => l.x0)))
    pages.push({ page: p, w: round(pg.W), h: round(pg.H), bodySize, leftMargin, rightMargin, links: pg.links.length })

    let firstHeadingSeen = false
    let open = null   // block being extended
    for (const line of pg.lines) {
      const type = classify(line, { W: pg.W, page: p, firstHeadingSeen, nameSeen, bodySize })
      if (type === 'name') nameSeen = true
      if (type === 'heading') firstHeadingSeen = true
      const bodyRun = line.runs.find(r => !r.bold) || line.runs[0]
      // continuation of the open block: no bullet, not a heading/split/skill start,
      // same size, starts at the block's text edge, sits one line below
      const cont = open && !line.bullet && !['heading', 'split', 'skill', 'name', 'contact'].includes(type)
        && open.editable && Math.abs(line.x0 - open.x0) <= X_TOL && line.size === open.font.size
        && (line.top - open.lines[open.lines.length - 1].bottom) < line.size * 0.9
      if (cont) {
        open.lines.push(lineOut(line))
        continue
      }
      const editable = ['bullet', 'paragraph', 'skill'].includes(type)
      open = {
        id: `b${++id}`, page: p, type, editable,
        x0: line.x0, availWidth: round(rightMargin - line.x0),
        font: { name: bodyRun.font, size: bodyRun.size, bold: bodyRun.bold, italic: bodyRun.italic, colour: bodyRun.colour },
        bullet: line.bullet ? { glyph: line.bullet.glyph, x: round(line.bullet.x) } : null,
        lines: [lineOut(line)],
      }
      blocks.push(open)
    }
  }
  // finish: text, box, maxLines, links, skill label
  for (const b of blocks) {
    b.maxLines = b.lines.length
    b.text = b.lines.map((l, i) => l.text.trimEnd() + (i < b.lines.length - 1 && !l.hyphen ? ' ' : '')).join('').replace(/\s+/g, ' ').trim()
    b.box = {
      x0: round(Math.min(...b.lines.map(l => l.x0))), x1: round(Math.max(...b.lines.map(l => l.x1))),
      y0: round(Math.min(...b.lines.map(l => l.top))), y1: round(Math.max(...b.lines.map(l => l.bottom))),
    }
    const links = [...new Set(b.lines.flatMap(l => l.runs.filter(r => r.link).map(r => r.link)))]
    b.links = links.length ? links : null
    if (b.type === 'skill') { b.label = b.lines[0].runs[0].text.trim(); b.text = b.text.slice(b.label.length).trim() }
    if (b.type === 'split') { b.left = b.lines[0].segments[0].text.trim(); b.right = b.lines[0].segments.slice(1).map(s => s.text.trim()).join(' ') }
    delete b.x0
  }
  return { pages, blocks, extractedAt: new Date().toISOString() }
}

function lineOut(line) {
  return {
    text: line.text, y: line.y, x0: line.x0, x1: line.x1, top: line.top, bottom: line.bottom,
    hyphen: line.hyphen, runs: line.runs, segments: line.segments,
  }
}

// ── CLI
if (process.argv[1] && /pdfBlocks\.mjs$/.test(process.argv[1])) {
  const file = process.argv[2]
  if (!file) { console.error('usage: node pdfBlocks.mjs resume.pdf [--json]'); process.exit(1) }
  const out = extractBlocks(fs.readFileSync(file))
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0) }
  for (const pg of out.pages) console.log(`page ${pg.page + 1}: ${pg.w}×${pg.h}  body ${pg.bodySize}pt  margins ${pg.leftMargin}–${pg.rightMargin}  links ${pg.links}`)
  const counts = {}
  for (const b of out.blocks) {
    counts[b.type] = (counts[b.type] || 0) + 1
    const f = `${b.font.name.replace(/^[A-Z]{6}\+/, '')} ${b.font.size}${b.font.bold ? ' B' : ''}${b.font.colour !== '#000000' ? ' ' + b.font.colour : ''}`
    const txt = b.type === 'skill' ? `${b.label} ‹${b.text}›` : b.type === 'split' ? `${b.left}  |  ${b.right}` : b.text
    console.log(`${b.id.padEnd(5)} p${b.page + 1} ${b.type.padEnd(9)} ${String(b.maxLines).padStart(2)}L ${b.editable ? 'E' : '-'} w${String(Math.round(b.availWidth)).padStart(3)} [${f}]${b.links ? ' 🔗' : ''} ${txt.length > 90 ? txt.slice(0, 87) + '…' : txt}`)
  }
  console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '), `· editable ${out.blocks.filter(b => b.editable).length}/${out.blocks.length}`)
}
