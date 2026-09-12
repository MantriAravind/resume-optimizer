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

export function mapOptimizedToBlocks(blocksDoc, optimizedText) {
  const lines = String(optimizedText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
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

  // paragraphs (rare in resumes): only when counts match exactly, same rule as bullets
  const paraBlocks = editable.filter(b => b.type === 'paragraph')
  const paraTexts = otherTexts.filter(l => l.split(/\s+/).length >= 6 && !/^[A-Z\s&]+$/.test(l))
  if (paraBlocks.length && paraBlocks.length === paraTexts.length) {
    paraBlocks.forEach((b, i) => { mapped[b.id] = paraTexts[i] })
  }

  return { mapped, notes }
}

// The fit loop. For each editable block with a mapped rewrite: unchanged text passes
// untouched; changed text is fit-checked; misfits go to shortenFn in batches with
// their budgets, up to `maxTries` rounds; whatever still misses reverts to the
// original text with a flag. Font size is never changed — that is the whole rule.
export async function fitAndShorten(ctx, blocksDoc, mappedResult, shortenFn, { maxTries = 3 } = {}) {
  const { fitCheck, charBudget } = await import('./pdfFit.mjs')
  const { mapped } = mappedResult
  const out = []
  let pending = []           // [{ block, text, tries }]
  for (const b of blocksDoc.blocks) {
    if (!b.editable || mapped[b.id] === undefined || norm(mapped[b.id]) === norm(b.text)) {
      out.push({ id: b.id, text: b.text, changed: false, fits: true, reverted: false, tries: 0 })
      continue
    }
    const r = fitCheck(ctx, b, mapped[b.id])
    if (r.fits) out.push({ id: b.id, text: mapped[b.id], changed: true, fits: true, reverted: false, tries: 0 })
    else pending.push({ block: b, text: mapped[b.id], tries: 0, last: r })
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
      if (r.fits) out.push({ id: p.block.id, text: p.text, changed: true, fits: true, reverted: false, tries: round })
      else next.push(p)
    }
    pending = next
  }

  // never-fit blocks keep their original text — an unimproved bullet beats an
  // overflowing or glyph-dropping one
  for (const p of pending) {
    out.push({ id: p.block.id, text: p.block.text, changed: false, fits: true, reverted: true, tries: p.tries, reason: p.last.reason || `${p.last.linesNeeded}/${p.last.maxLines} lines` })
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
