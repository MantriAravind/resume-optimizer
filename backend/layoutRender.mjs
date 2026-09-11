// layoutRender.mjs — A7-4. Renders optimized resume text in the student's OWN layout.
//
// Input: the optimized text and the `layout` read from their PDF at upload
// (pdfLayout.mjs). Output: the same data-l markup the default renderer emits, so the
// editable sheet, the PDF and (later) Word all draw from it.
//
// How: the layout is turned into a STYLE PROFILE — how this resume styles each kind
// of line: the name, the header lines under it, section headers, company lines
// (left part / right part), bullets (glyph, indent, hanging indent), skill lines
// (label / value), plain paragraphs. Lines the rewrite kept are matched to their
// original by text so split lines re-split exactly; lines it changed take the style
// of their kind. Nothing here is our taste: every number comes from their file.

const SECTION_RE = /^(professional\s+|executive\s+|career\s+)?(summary|profile|objective|experience|work\s+experience|professional\s+experience|employment(\s+history)?|education|(technical\s+|core\s+|key\s+)?skills|projects?(\s+experience)?|certifications?|awards?|publications?|languages?|interests|volunteer(ing)?|achievements?|honou?rs|activities|coursework|leadership|research|additional\s+information)\s*:?$/i
const BULLET_RE = /^([•\-–—·▪●o\u2022\u25AA\u2013])\s+/
const DATE_RE = /\b(19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i

const FONT_CSS = {
  'Times New Roman': `"Times New Roman", Times, "Liberation Serif", serif`,
  'Arial': `Arial, "Liberation Sans", Helvetica, sans-serif`,
  'Helvetica': `Helvetica, Arial, "Liberation Sans", sans-serif`,
  'Calibri': `Calibri, Carlito, "Segoe UI", Arial, sans-serif`,
  'Cambria': `Cambria, Caladea, Georgia, serif`,
  'Georgia': `Georgia, "DejaVu Serif", serif`,
  'Garamond': `Garamond, "EB Garamond", Georgia, serif`,
  'Verdana': `Verdana, "DejaVu Sans", sans-serif`,
  'Segoe UI': `"Segoe UI", Arial, sans-serif`,
  'Courier New': `"Courier New", "Liberation Mono", monospace`,
}
const KNOWN_FONTS = new Set(Object.keys(FONT_CSS))

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function sim(a, b) {
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '))
  if (!A.size || !B.size) return 0
  let hit = 0; for (const w of A) if (B.has(w)) hit++
  return hit / Math.max(A.size, B.size)
}

// ── 1. logical lines: merge wrapped continuations back into their line ────────
function logicalLines(layout) {
  const out = []
  const src = (layout.lines || []).filter(l => !l.furniture && l.text)
  for (const l of src) {
    const prev = out[out.length - 1]
    const startsBullet = BULLET_RE.test(l.text)
    const isSplit = l.align === 'split'
    const sameFace = prev && Math.abs((prev.size || 0) - (l.size || 0)) <= 0.6 && !l.bold === !prev.bold
    const deeper = prev && (l.indent || 0) >= (prev.indent || 0) + 2
    const contOfBullet = prev && prev.kindHint === 'bullet' && !startsBullet && !isSplit && deeper && sameFace
    const contOfSkill = prev && prev.kindHint === 'skill' && !isSplit && !startsBullet && (l.indent || 0) >= (prev.valueIndent || 60) - 6
    const contOfPara = prev && prev.kindHint === 'para' && !startsBullet && !isSplit && sameFace && !l.bold && Math.abs((l.indent || 0) - (prev.indent || 0)) <= 2 && l.align === 'left' && prev.align === 'left'
    if (prev && (contOfBullet || contOfSkill || contOfPara)) {
      prev.text += ' ' + l.text
      prev.phys = (prev.phys || 1) + 1
      if (contOfBullet && prev.hang == null) prev.hang = l.indent
      continue
    }
    const L = { ...l }
    if (startsBullet) L.kindHint = 'bullet'
    else if (isSplit && /:\s*$/.test(l.segments[0].text)) { L.kindHint = 'skill'; L.valueIndent = l.segments[1] ? l.segments[1].indent : 100 }
    else if (isSplit) L.kindHint = 'company'   // any left/right line: company+dates, title+location
    else if (l.bold && SECTION_RE.test(l.text.trim())) L.kindHint = 'section'
    else L.kindHint = 'para'
    out.push(L)
  }
  return out
}

// ── 2. style profile ──────────────────────────────────────────────────────────
function pick(l) { return { font: l.font, size: l.size, bold: !!l.bold, italic: !!l.italic, align: l.align === 'split' ? 'left' : l.align, indent: l.indent || 0 } }
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

export function buildProfile(layout) {
  const lines = logicalLines(layout)
  const firstSection = lines.findIndex(l => l.kindHint === 'section')
  const header = lines.slice(0, firstSection === -1 ? 1 : firstSection)
  const body = lines.slice(header.length)
  const bodySizes = body.filter(l => l.kindHint === 'para' || l.kindHint === 'bullet').map(l => l.size)
  const bodySize = median(bodySizes) || 10

  const kinds = {}
  for (const k of ['section', 'company', 'bullet', 'skill', 'para']) {
    const l = body.find(x => x.kindHint === k)
    if (l) kinds[k] = pick(l)
  }
  const bul = body.find(x => x.kindHint === 'bullet')
  if (bul) { kinds.bullet.glyph = (bul.text.match(BULLET_RE) || [, '•'])[1]; kinds.bullet.hang = bul.hang ?? (bul.indent + Math.round(bodySize * 1.2)) }
  const sk = body.find(x => x.kindHint === 'skill')
  if (sk) { kinds.skill.valueIndent = sk.valueIndent; kinds.skill.labelBold = !!sk.segments?.[0]?.bold; kinds.skill.valueBold = !!sk.segments?.[1]?.bold }
  const co = body.find(x => x.kindHint === 'company')
  if (co) { kinds.company.left = pick({ ...co.segments[0], align: 'left' }); kinds.company.right = pick({ ...co.segments[co.segments.length - 1], align: 'right' }) }
  // a bold or italic non-split line right under a section (project title, degree line)
  const title = body.find(x => x.kindHint === 'para' && (x.bold || x.italic))
  kinds.title = title ? pick(title) : (kinds.para ? { ...kinds.para, bold: true } : null)

  // vertical rhythm from y deltas (pt): gap between consecutive logical lines of a kind
  const gaps = { section: [], company: [], bullet: [], para: [], skill: [] }
  for (let i = 1; i < body.length; i++) {
    const a = body[i - 1], b = body[i]
    if (a.page !== b.page) continue
    // a.y is the FIRST physical line of a; subtract every wrapped line it spans.
    const g = a.y - b.y - (a.phys || 1) * (a.size || bodySize) * 1.2
    if (gaps[b.kindHint]) gaps[b.kindHint].push(Math.max(0, Math.round(g)))
  }
  const rhythm = Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, median(v)]))

  const family = Object.entries(layout.fonts || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Times New Roman'
  return {
    family, fontKnown: KNOWN_FONTS.has(family),
    page: layout.page || { width: 612, height: 792, left: 54, right: 54, top: 54 },
    bodySize,
    header: header.map(pick),
    kinds, rhythm,
    originals: lines,   // for text matching at render time
  }
}

// ── 3. render ─────────────────────────────────────────────────────────────────
function css(st, extra = '') {
  if (!st) return extra
  const parts = [`font-size:${st.size}pt`]
  if (st.bold) parts.push('font-weight:700')
  if (st.italic) parts.push('font-style:italic')
  if (st.align === 'center') parts.push('text-align:center')
  if (st.align === 'right') parts.push('text-align:right')
  return parts.join(';') + (extra ? ';' + extra : '')
}
function fontStack(family) { return FONT_CSS[family] || `${JSON.stringify(family)}, Arial, sans-serif` }

export function renderWithLayout(optimizedText, layout) {
  const P = buildProfile(layout)
  const text = String(optimizedText || '').replace(/\r\n/g, '\n')
  const rawLines = text.split('\n')
  const K = P.kinds
  const lh = 1.18
  const pad = (n) => n ? `padding-left:${n}pt` : ''
  const gapTop = (k) => P.rhythm[k] ? `margin-top:${P.rhythm[k]}pt` : ''
  let out = ''
  let section = ''
  let headerDone = false
  let headerIdx = 0
  let prevKind = ''

  const findOriginal = (line, kind) => {
    let best = null, bs = 0
    for (const o of P.originals) {
      if (kind && o.kindHint !== kind) continue
      const s = sim(o.text, line)
      if (s > bs) { bs = s; best = o }
    }
    return bs >= 0.55 ? best : null
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) { out += `<div data-l="blank" style="height:${Math.round(P.bodySize * 0.6)}pt"></div>`; continue }

    // header block: everything before the first section header, styled by position
    const isSection = SECTION_RE.test(line.replace(/[:：]\s*$/, ''))
    if (!headerDone && !isSection) {
      const st = P.header[Math.min(headerIdx, P.header.length - 1)] || { size: P.bodySize, align: 'left' }
      const kind = headerIdx === 0 ? 'name' : 'line'
      out += `<div data-l="${kind}" style="${css(st)};line-height:${lh};color:#111">${esc(line)}</div>`
      headerIdx++
      continue
    }
    headerDone = true

    if (isSection) {
      section = line.replace(/[:：]\s*$/, '').toUpperCase()
      const st = K.section || { size: P.bodySize + 1, bold: true, align: 'left', indent: 0 }
      out += `<div data-l="section" style="${css(st, pad(st.indent))};${gapTop('section')};margin-bottom:${Math.round(P.bodySize * 0.35)}pt;line-height:${lh};color:#111">${esc(line)}</div>`
      prevKind = 'section'; continue
    }

    const bm = line.match(BULLET_RE) || (line.startsWith('- ') ? ['- ', '-'] : null)
    if (bm) {
      const st = K.bullet || { size: P.bodySize, indent: 0, glyph: '•', hang: 12 }
      const body = line.replace(BULLET_RE, '').replace(/^-\s+/, '')
      const hang = Math.max(6, (st.hang ?? st.indent + 12) - st.indent)
      out += `<div data-l="bullet" style="${css(st)};line-height:${lh};color:#222;display:flex;gap:0;padding-left:${st.indent}pt;margin-top:${prevKind === 'bullet' ? Math.round(P.rhythm.bullet || 1) : Math.round(P.rhythm.bullet || 2)}pt"><span contenteditable="false" style="flex:0 0 ${hang}pt">${esc(st.glyph || '•')}</span><span style="flex:1">${esc(body)}</span></div>`
      prevKind = 'bullet'; continue
    }

    // skill line "Label: values" inside a skills-ish section, or anywhere the profile has skill lines
    const skm = line.match(/^([A-Za-z][A-Za-z0-9 &/+\-().]{1,48}):\s+(\S.*)$/)
    if (skm && (/(SKILL|COMPETENC|PROFICIENC|TECHNOLOG)/.test(section) || K.skill)) {
      const st = K.skill || { size: P.bodySize, indent: 0, valueIndent: 100, labelBold: true }
      const vi = st.valueIndent || 100
      out += `<div data-l="line" style="${css({ ...st, bold: false })};line-height:${lh};color:#222;display:flex;margin-top:${Math.round(P.rhythm.skill || 1)}pt;padding-left:${st.indent}pt"><span style="flex:0 0 ${vi - st.indent}pt;${st.labelBold ? 'font-weight:700' : ''};color:#111">${esc(skm[1])}:</span><span style="flex:1;${st.valueBold ? 'font-weight:700' : ''}">${esc(skm[2])}</span></div>`
      prevKind = 'skill'; continue
    }

    // company / role line: match the original split line and re-split on its right part
    const orig = findOriginal(line, 'company')
    if (orig) {
      const right = orig.segments[orig.segments.length - 1].text
      let left = line, r = ''
      const ri = line.lastIndexOf(right)
      if (ri > 0) { left = line.slice(0, ri).trim(); r = right }
      else if (DATE_RE.test(line)) { const m = line.match(/^(.*?)(\s{2,}|\s\|\s)(.*(?:19|20)\d{2}.*)$/); if (m) { left = m[1].trim(); r = m[3].trim() } }
      // each split line keeps ITS OWN segment styles (company bold, title italic…)
      const ls = pick({ ...orig.segments[0], align: 'left' }), rs = pick({ ...orig.segments[orig.segments.length - 1], align: 'right' })
      out += `<div data-l="line" style="line-height:${lh};display:flex;justify-content:space-between;gap:12pt;${gapTop('company')};padding-left:${ls.indent}pt"><span style="${css({ ...ls, align: 'left' })};color:#111">${esc(left)}</span>${r ? `<span style="${css({ ...rs, align: 'right' })};color:#222;white-space:nowrap">${esc(r)}</span>` : ''}</div>`
      prevKind = 'company'; continue
    }

    // a titled line (project name, degree) or a plain paragraph: match original for its style
    const o2 = findOriginal(line, null)
    const st = o2 ? pick(o2) : ((/PROJECT|EDUCATION/.test(section) && prevKind !== 'para' && K.title) ? K.title : (K.para || { size: P.bodySize, indent: 0, align: 'left' }))
    if (o2 && o2.kindHint === 'company' && K.company) {
      // (handled above when matched as company) — fallthrough for odd cases
    }
    const kindLabel = 'line'
    out += `<div data-l="${kindLabel}" style="${css(st, pad(st.indent))};line-height:${lh};color:#222;margin-top:${prevKind === 'section' ? 0 : Math.round(P.rhythm.para || 1)}pt">${esc(line)}</div>`
    prevKind = 'para'
  }
  return { body: out, profile: P }
}

// Full page for the PDF renderer: the student's margins and page size, their font.
export function buildLayoutPage(optimizedText, layout) {
  const { body, profile: P } = renderWithLayout(optimizedText, layout)
  const pg = P.page
  const isLetter = Math.abs(pg.width - 612) < 6
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: ${isLetter ? 'letter' : 'A4'}; margin: ${pg.top}pt ${pg.right}pt ${Math.max(36, pg.top)}pt ${pg.left}pt; }
  body { font-family: ${fontStack(P.family)}; color: #222; background: #fff; }
  a { color: inherit; text-decoration: none; }
</style></head><body>${body}</body></html>`
}

export function layoutSheetCss(layout) {
  const P = buildProfile(layout)
  return { fontFamily: fontStack(P.family), family: P.family, fontKnown: P.fontKnown, page: P.page }
}
