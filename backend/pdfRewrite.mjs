// pdfRewrite.mjs — A7-S4, second half. Takes the optimizer's whole-resume output
// (which the /optimize code gate has already forced to be structurally parallel to
// the original: same bullets in the same order, no merges, no losses, date and
// heading lines verbatim) and maps it back onto the stored blocks; then enforces the
// fit rule per block, sending only the misfits back for shortening.
//
//   import { mapOptimizedToBlocks, fitAndShorten } from './pdfRewrite.mjs'
//   const mapped = mapOptimizedToBlocks(blocksDoc, optimizedResume)
//   const result = await fitAndShorten(ctx, blocksDoc, mapped, shortenFn)
//   // result.blocks: [{ id, text, changed, fits, reverted, tries }]
//   // shortenFn(items) → Promise<{ [id]: shorterText }>; items = [{ id, text, budget, availLines }]
//
//   node pdfRewrite.mjs resume.pdf     // self-test with a synthetic optimized text
//                                      // and a word-boundary mock shortener
//
// Mapping rule: the optimized text is split into lines; bullet lines (leading •/-/*)
// are collected in order and paired 1:1 with the editable bullet blocks in reading
// order. Skill lines are paired by their bold label ("Cloud & Data Platforms:").
// Paragraph blocks pair with the non-bullet, non-heading lines between the same
// headings. Anything unpaired keeps its original text — the surgical writer never
// touches a block it isn't sure about.

const BULLET_LINE = /^\s*[•\-–—·▪●o\u2022\u25AA\u25CF\u2023\u2043]\s+/
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const sim = (a, b) => {
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '))
  if (!A.size || !B.size) return 0
  let hit = 0; for (const w of A) if (B.has(w)) hit++
  return hit / Math.max(A.size, B.size)
}
const HEADINGISH = /^[A-Z\s&/]{3,}$/

// Continuation-line join (2026-09-16). The optimizer sometimes returns bullets
// hard-wrapped across two lines, mirroring the original PDF's visual breaks.
// The 1:1 pairing below then takes only the marker-carrying first lines as
// "the bullets" (counts still match — one marker per bullet), every changed
// block maps to a first-line fragment, fitCheck passes (fragments are short),
// the writer redacts both original lines and writes the fragment, and QA
// validates output against the fragments — a silently truncated resume that
// passed every check. Defense: a line is glued onto the preceding bullet when
// it is not itself a bullet, a "Label: value" line, or an ALL-CAPS heading,
// AND it reads as a continuation (starts lowercase, or the bullet above ends
// mid-sentence). Title/company lines start uppercase after a bullet that ends
// with a period, so they never glue.
function joinWrappedBullets(lines) {
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    const isCont = prev !== undefined && BULLET_LINE.test(prev.raw) && !BULLET_LINE.test(l)
      && !/^([A-Za-z][A-Za-z &/]+):\s+.+$/.test(l) && !/^[A-Z][A-Z\s&/]{2,}$/.test(l.trim())
      && !/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/.test(l)
      && (/^[a-z]/.test(l.trim()) || !/[.:;]\s*$/.test(prev.raw))
    if (isCont) prev.raw += ' ' + l.trim()
    else out.push({ raw: l })
  }
  return out.map(o => o.raw)
}

export function mapOptimizedToBlocks(blocksDoc, optimizedText) {
  const lines = joinWrappedBullets(String(optimizedText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean))
  const bulletTexts = []
  const skillTexts = {}       // normalized label → value text
  const otherTexts = []
  for (const l of lines) {
    if (BULLET_LINE.test(l)) { bulletTexts.push(l.replace(BULLET_LINE, '').trim()); continue }
    const m = l.match(/^([A-Za-z][A-Za-z &/]+):\s+(.+)$/)
    if (m) { skillTexts[norm(m[1])] = m[2].trim(); continue }
    otherTexts.push(l)
  }

  const editable = blocksDoc.blocks.filter(b => b.editable)
  const bulletBlocks = editable.filter(b => b.type === 'bullet')
  const mapped = {}           // block id → new text
  const notes = { bullets: { blocks: bulletBlocks.length, lines: bulletTexts.length }, unmatchedSkillLabels: [] }

  // bullets: strict 1:1 in order — the gate guarantees the count; if it ever
  // disagrees, map nothing rather than guess an alignment
  if (bulletBlocks.length === bulletTexts.length) {
    bulletBlocks.forEach((b, i) => { mapped[b.id] = bulletTexts[i] })
  } else {
    notes.bulletCountMismatch = true
  }

  // skills: by label
  for (const b of editable.filter(x => x.type === 'skill')) {
    const t = skillTexts[norm(b.label.replace(/:\s*$/, ''))]
    if (t !== undefined) mapped[b.id] = t
    else notes.unmatchedSkillLabels.push(b.label)
  }

  // paragraphs: anchor each block to the contiguous run of other-lines whose
  // concatenation best matches the block's ORIGINAL text (2026-09-16). The old
  // count-equality rule never fired in practice — otherTexts always holds contact,
  // title/date and degree lines too, so counts never matched and a rewritten summary
  // silently stayed out of the PDF while the sheet/Word carried it (the Cleartelligence
  // divergence). Similarity to the original is order-free, absorbs model output that
  // arrives hard-wrapped across lines, and keeps the never-guess rule via a threshold.
  const paraBlocks = editable.filter(b => b.type === 'paragraph')
  const usedIdx = new Set()
  for (const b of paraBlocks) {
    let best = null
    for (let s = 0; s < otherTexts.length; s++) {
      if (usedIdx.has(s) || HEADINGISH.test(otherTexts[s].trim())) continue
      let acc = ''
      for (let e = s; e < otherTexts.length && e - s < 8; e++) {
        if (usedIdx.has(e) || HEADINGISH.test(otherTexts[e].trim())) break
        acc = acc ? acc + ' ' + otherTexts[e] : otherTexts[e]
        const score = sim(acc, b.text)
        if (!best || score > best.score) best = { s, e, score, text: acc }
      }
    }
    if (best && best.score >= 0.5) {
      mapped[b.id] = best.text
      for (let i = best.s; i <= best.e; i++) usedIdx.add(i)
    } else {
      ;(notes.unmatchedParagraphs ??= []).push(b.id)
    }
  }

  // every editable block whose intended content could not be placed must be REPORTED,
  // so the caller can reset the sheet to the PDF's truth — one source of truth even
  // when matching fails. Unreported unmapped blocks are exactly how the PDF and the
  // Word file diverged.
  const unplaced = []
  if (notes.bulletCountMismatch) unplaced.push(...bulletBlocks.map(b => b.id))
  unplaced.push(...(notes.unmatchedParagraphs || []))
  return { mapped, notes, unplaced }
}

// The fit loop. For each editable block with a mapped rewrite: unchanged text passes
// untouched; changed text is fit-checked; misfits go to shortenFn in batches with
// their budgets, up to `maxTries` rounds; whatever still misses reverts to the
// original text with a flag. Font size is never changed — that is the whole rule.
export async function fitAndShorten(ctx, blocksDoc, mappedResult, shortenFn, { maxTries = 3 } = {}) {
  const { fitCheck, charBudget } = await import('./pdfFit.mjs')
  const { mapped } = mappedResult
  const unplaced = new Set(mappedResult.unplaced || [])
  const out = []
  let pending = []           // [{ block, text, tries }]
  for (const b of blocksDoc.blocks) {
    if (!b.editable || mapped[b.id] === undefined || norm(mapped[b.id]) === norm(b.text)) {
      // a block the mapper WANTED to change but could not place keeps its original
      // text in the PDF — report it reverted so the sheet resets to match
      const wasUnplaced = b.editable && unplaced.has(b.id)
      out.push({ id: b.id, text: b.text, changed: false, fits: true, reverted: wasUnplaced, tries: 0, ...(wasUnplaced ? { reason: 'unmapped' } : {}) })
      continue
    }
    const r = fitCheck(ctx, b, mapped[b.id])
    if (r.fits) out.push({ id: b.id, text: mapped[b.id], sent: mapped[b.id], changed: true, fits: true, reverted: false, tries: 0 })
    else pending.push({ block: b, text: mapped[b.id], sent: mapped[b.id], tries: 0, last: r })
  }

  for (let round = 1; round <= maxTries && pending.length; round++) {
    const items = pending.map(p => ({
      id: p.block.id,
      text: p.text,
      budget: charBudget(ctx, p.block),
      availLines: p.block.maxLines,
      // when the failure was a glyph the font lacks, say which — the shortener must
      // replace it, not just cut length
      badChars: p.last.missing || undefined,
    }))
    let shortened
    try { shortened = await shortenFn(items, round) } catch (e) { console.warn('shorten round ' + round + ' failed: ' + e.message); break }
    const next = []
    for (const p of pending) {
      const t = shortened?.[p.block.id]
      if (typeof t === 'string' && t.trim()) p.text = t.trim()
      p.tries = round
      const r = fitCheck(ctx, p.block, p.text)
      p.last = r
      if (r.fits) out.push({ id: p.block.id, text: p.text, sent: p.sent, changed: true, fits: true, reverted: false, tries: round })
      else next.push(p)
    }
    pending = next
  }

  // never-fit blocks keep their original text — an unimproved bullet beats an
  // overflowing or glyph-dropping one
  for (const p of pending) {
    out.push({ id: p.block.id, text: p.block.text, sent: p.sent, changed: false, fits: true, reverted: true, tries: p.tries, reason: p.last.reason || `${p.last.linesNeeded}/${p.last.maxLines} lines` })
  }
  out.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  return { blocks: out, reverted: out.filter(x => x.reverted).map(x => x.id), notes: mappedResult.notes }
}

// ── CLI self-test: synthetic optimized text from the PDF's own blocks — every bullet
// reworded slightly, three made deliberately overlong, one skill line changed — and a
// mock shortener that trims at a word boundary to the budget.
if (process.argv[1] && /pdfRewrite\.mjs$/.test(process.argv[1])) {
  const fs = await import('node:fs')
  const file = process.argv[2]
  if (!file) { console.error('usage: node pdfRewrite.mjs resume.pdf'); process.exit(1) }
  const { checkPdfCompat } = await import('./pdfCompat.mjs')
  const { extractBlocks } = await import('./pdfBlocks.mjs')
  const { buildFitContext } = await import('./pdfFit.mjs')
  const buf = fs.readFileSync(file)
  const compat = checkPdfCompat(buf)
  const blocksDoc = extractBlocks(buf)
  const ctx = buildFitContext(buf, compat, blocksDoc)

  // synthesize "optimizer output"
  const lines = []
  let overlong = 0
  for (const b of blocksDoc.blocks) {
    if (b.type === 'heading') lines.push(b.text.toUpperCase())
    else if (b.type === 'skill') lines.push(b.label.replace(/:?\s*$/, ':') + ' ' + b.text)
    else if (b.type === 'bullet') {
      let t = 'Delivered ' + b.text.charAt(0).toLowerCase() + b.text.slice(1)
      if (b.maxLines <= 2 && overlong < 3) { t += ' while additionally coordinating cross-team alignment sessions and producing extensive supplementary documentation for every stakeholder group involved'; overlong++ }
      lines.push('• ' + t)
    } else lines.push(b.type === 'split' ? `${b.left}    ${b.right}` : b.text)
  }
  const synthetic = lines.join('\n')

  const mapped = mapOptimizedToBlocks(blocksDoc, synthetic)
  console.log('mapping:', JSON.stringify(mapped.notes))
  const mock = async (items, round) => {
    console.log(`shorten round ${round}: ${items.length} block(s) — ${items.map(i => i.id + '(' + i.text.length + '→' + i.budget + ')').join(', ')}`)
    const outMap = {}
    for (const it of items) {
      let t = it.text.slice(0, it.budget)
      t = t.slice(0, Math.max(t.lastIndexOf(' '), 20)).replace(/[,;\s]+$/, '') + '.'
      outMap[it.id] = t
    }
    return outMap
  }
  const result = await fitAndShorten(ctx, blocksDoc, mapped, mock)
  const changed = result.blocks.filter(b => b.changed).length
  const shortened = result.blocks.filter(b => b.tries > 0 && !b.reverted).length
  console.log(`result: ${result.blocks.length} blocks · ${changed} changed · ${shortened} shortened to fit · reverted: ${result.reverted.length ? result.reverted.join(',') : 'none'}`)
  const bad = result.blocks.filter(b => b.changed && !b.fits)
  console.log(bad.length ? 'FAIL: unfit changed blocks ' + bad.map(b => b.id) : 'ALL CHANGED BLOCKS FIT')
}
