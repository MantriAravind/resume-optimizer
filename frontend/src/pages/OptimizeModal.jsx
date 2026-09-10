import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  X, Check, CheckCheck, ArrowRight, ArrowLeft, ArrowUp, Download, FileText,
  ExternalLink, Sparkles, BookOpen, AlertCircle, Ban, Undo2, Copy, PenLine,
} from 'lucide-react'

// Read from the environment so the backend can move without editing four files.
// The fallback is the current production URL, so a missing variable degrades to
// today's behaviour instead of silently pointing the app at nothing.
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'

// Web-safe only. Trendy fonts silently fall back inside PDFShift, so we don't offer them.
// One font. The picker offered four, which made a downloaded resume look different
// from the one on screen and asked a student to make a decision they have no basis
// for. Times New Roman is the safest choice for an ATS and for a human reader, and
// the preview now renders in it, so what you see is what downloads.
const DOC_FONT = 'Times New Roman'
const DOC_FONT_CSS = "'Times New Roman', Times, serif"

const STOP = new Set(('a an and are as at be by for from has have in into is it of on or that the their this to was were '
  + 'will with within who whose you your our we they i').split(' '))
const wordsOf = t => String(t || '').toLowerCase().match(/[a-z0-9][a-z0-9./#+-]*/g) || []

// ✕ on a placement card. The server verified `fragment` is literally in the text and
// sits on a bullet line, so removing it is a string operation, not a model call. The
// punctuation it leaves behind (", ." / "and .") is tidied, and the skill is kept in
// the skills section so the tap is still honoured: the student said they have it,
// they just did not use it there.
function stripFragment(text, fragment) {
  if (!fragment || !text.includes(fragment)) return text
  return text.replace(fragment, '')
    .replace(/,\s*(and|with|using|via|in|on)?\s*([.,;:])/g, '$2')
    .replace(/\s+(and|with|using|via|in|on)?\s*([.,;:])/g, '$2')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
}
function ensureInSkills(text, skill) {
  const re = new RegExp('\\b' + skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
  if (re.test(text)) return text
  const lines = text.split('\n')
  const h = lines.findIndex(l => /^\s*(TECHNICAL |CORE |KEY )?(SKILLS|PROFICIENC(Y|IES)|COMPETENCIES)\s*:?\s*$/i.test(l))
  if (h === -1) return text
  for (let i = h + 1; i < lines.length; i++) {
    if (/^[A-Z][A-Z &/]{3,}:?$/.test(lines[i].trim())) break
    if (/^[A-Za-z][A-Za-z /&+-]{1,48}:\s+\S/.test(lines[i].trim())) { lines[i] = lines[i].replace(/\s*$/, '') + ', ' + skill; return lines.join('\n') }
  }
  return text
}

function ResumeView({ text, skills, originalText }) {
  const skillList = Array.isArray(skills) ? skills.filter(Boolean) : []
  const origVocab = new Set(wordsOf(originalText))
  const haveOrig = origVocab.size > 0

  // Split by confirmed skills first (longest first, whole words only) — green.
  let segments = [{ t: text, mark: null }]
  if (skillList.length) {
    const escaped = [...skillList].sort((a, b) => b.length - a.length)
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
    const next = []
    for (const seg of segments) {
      let last = 0, m
      re.lastIndex = 0
      while ((m = re.exec(seg.t)) !== null) {
        if (m.index > last) next.push({ t: seg.t.slice(last, m.index), mark: null })
        next.push({ t: m[0], mark: 'skill' })
        last = m.index + m[0].length
      }
      if (last < seg.t.length) next.push({ t: seg.t.slice(last), mark: null })
    }
    segments = next
  }

  // Inside unmarked text, amber any word the original resume never used.
  const nodes = []
  let key = 0
  for (const seg of segments) {
    if (seg.mark === 'skill') {
      nodes.push(<mark key={key++} className="om-mark">{seg.t}</mark>)
      continue
    }
    if (!haveOrig) { nodes.push(seg.t); continue }
    const parts = seg.t.split(/([a-zA-Z0-9][a-zA-Z0-9./#+-]*)/)
    for (const p of parts) {
      const w = p.toLowerCase()
      const isWord = /^[a-z0-9]/.test(w)
      if (isWord && w.length > 2 && !STOP.has(w) && !origVocab.has(w)) {
        nodes.push(<mark key={key++} className="om-mark-new" title="Changed or added by the optimizer. Review before sending.">{p}</mark>)
      } else {
        nodes.push(p)
      }
    }
  }
  return <pre className="om-resume">{nodes}</pre>
}

export default function OptimizeModal({ job, onClose, onApplied }) {
  const { getToken } = useAuth()

  const [phase, setPhase]   = useState('loading') // loading | pick | rewriting | result | error
  const [error, setError]   = useState('')

  const [resumeText, setResumeText] = useState('')
  const [jobText, setJobText]       = useState('')

  const [matched, setMatched]   = useState([])
  const [missing, setMissing]   = useState([])
  const [scoreBefore, setScoreBefore] = useState(0)
  const [rubric, setRubric]     = useState(null)   // rows from /analyze, one law for both screens
  const [maxScore, setMaxScore] = useState(null)   // what every honest tap reaches; can be < 100
  const [dropped, setDropped]   = useState([])     // job-ad phrases never offered as checkboxes
  const [kinds, setKinds]       = useState({})     // keyword -> tool | practice, for grouping
  const [postingWork, setPostingWork] = useState('')
  const [resumeWork, setResumeWork]   = useState('')

  const [checked, setChecked]   = useState({})

  const [optimized, setOptimized]   = useState('')
  const [added, setAdded]           = useState([])
  const [scoreAfter, setScoreAfter] = useState(0)
  const [feedback, setFeedback]     = useState('')
  const [placements, setPlacements] = useState([])   // one card per tapped skill, server-verified
  const [html, setHtml]             = useState('')   // the sheet, rendered by the same code as the PDF
  const [changes, setChanges]       = useState([])   // "What changed" list from the rewrite
  const [sheetMode, setSheetMode]   = useState('formatted')  // formatted | edit
  const [promised, setPromised]     = useState(null) // the score step 2 showed when rewrite was clicked
  const [removed, setRemoved]       = useState({})   // skill -> document text before ✕, for ↩
  const [docVersion, setDocVersion] = useState(0)    // remount the editable sheet when ✕/↩ change its text
  const [tab, setTab]               = useState('resume')   // resume | letter
  const [letter, setLetter]         = useState('')
  const [letterState, setLetterState] = useState('idle')  // idle | loading | ready | error
  const [copied, setCopied]         = useState(false)
  const letterRef = useRef(null)

  // The editable document is UNCONTROLLED — React never re-renders it, because a
  // re-render on every keystroke would wipe the caret. Its text is read from the ref
  // at download time instead.
  const docRef = useRef(null)
  const [dlLoading, setDlLoading] = useState('')

  // The modal element itself, so focus can be moved into it on open and kept there.
  // Without this the search input BEHIND the modal keeps focus, every keystroke goes
  // to the page underneath, and Ctrl+Z deletes the user's search text instead of
  // undoing their resume edit.
  const modalRef = useRef(null)
  const restoreFocusRef = useRef(null)

  // Undo history for the resume, scoped to this component.
  //
  // The document is contentEditable and uncontrolled, so undo would otherwise be the
  // browser's native stack. That stack is shared with the rest of the page: once the
  // resume's own history runs out, the browser applies Ctrl+Z to the next editable
  // thing it knows about — the job search box — and focus follows it out of the modal.
  // Keeping our own stack means undo can be stopped at the bottom instead of escaping.
  const undoStack = useRef([])
  const redoStack = useRef([])
  const lastSnap  = useRef('')

  // ── focus containment
  //
  // On open, remember what had focus and move focus into the modal. On close, put it
  // back where it was. While open, Tab cycles inside the modal instead of walking out
  // into the page behind it.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement
    // Blur whatever is behind us first — a focused input back there receives keystrokes
    // even when the modal is visually on top.
    if (restoreFocusRef.current?.blur) restoreFocusRef.current.blur()
    const t = setTimeout(() => modalRef.current?.focus(), 0)

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab') return
      const root = modalRef.current
      if (!root) return
      const items = [...root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
      )].filter(el => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      const back = restoreFocusRef.current
      if (back && document.body.contains(back)) back.focus()
    }
  }, [onClose])

  // ── undo/redo scoped to the resume
  useEffect(() => {
    const el = docRef.current
    if (!el) return
    lastSnap.current = el.innerHTML
    undoStack.current = []
    redoStack.current = []

    // Snapshot on a pause rather than per keystroke, so one undo reverses a word or a
    // phrase instead of a single character.
    let timer = null
    const snapshot = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const now = el.innerHTML
        if (now === lastSnap.current) return
        undoStack.current.push(lastSnap.current)
        if (undoStack.current.length > 100) undoStack.current.shift()
        redoStack.current = []
        lastSnap.current = now
      }, 400)
    }

    const apply = html => {
      el.innerHTML = html
      lastSnap.current = html
      // Caret to the end of the restored content; without this it lands at the start.
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    const onKey = e => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      const isUndo = k === 'z' && !e.shiftKey
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y'
      if (!isUndo && !isRedo) return

      // preventDefault runs even when our stack is empty. That is the whole point: an
      // exhausted stack is exactly when the browser would otherwise hand the keystroke
      // to the search box behind the modal.
      e.preventDefault()
      e.stopPropagation()
      clearTimeout(timer)

      const current = el.innerHTML
      if (current !== lastSnap.current) {
        undoStack.current.push(lastSnap.current)
        lastSnap.current = current
      }
      if (isUndo) {
        const prev = undoStack.current.pop()
        if (prev === undefined) return          // nothing left — stop here, do not escape
        redoStack.current.push(el.innerHTML)
        apply(prev)
      } else {
        const next = redoStack.current.pop()
        if (next === undefined) return
        undoStack.current.push(el.innerHTML)
        apply(next)
      }
    }

    el.addEventListener('input', snapshot)
    el.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('input', snapshot)
      el.removeEventListener('keydown', onKey)
    }
  }, [phase, optimized, added, sheetMode])

  // ── step 1: load resume + full job description, then analyze
  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const token = await getToken()

        // resume from profile + full job description in parallel
        const [meRes, jobRes] = await Promise.all([
          fetch(`${BACKEND}/me/resume`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${BACKEND}/jobs/${job.id}`),
        ])

        const me = meRes.ok ? await meRes.json() : {}
        const full = jobRes.ok ? await jobRes.json() : {}

        if (cancelled) return

        // The posting is gone at the source. There is no job description to optimize
        // against, so say that plainly instead of failing with a generic error.
        if (full.closed) {
          setError('job-closed')
          setPhase('error')
          return
        }

        if (!me.resumeText) {
          setError('no-resume')
          setPhase('error')
          return
        }

        const resume = me.resumeText
        const jd = full.description || job.description || ''
        setResumeText(resume)
        setJobText(jd)

        const aRes = await fetch(`${BACKEND}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // jobTitle feeds the core-role row and the cache key; yearsMin is the
          // pipeline's read of the posting and wins over the model's when present.
          body: JSON.stringify({ resumeText: resume, jobText: jd, jobTitle: job.title || '', yearsMin: job.yearsMin ?? null }),
        })
        if (!aRes.ok) throw new Error('analyze failed')
        const a = await aRes.json()
        if (cancelled) return

        setMatched(a.matchedKeywords || [])
        setMissing(a.missingKeywords || [])
        setRubric(a.rubric || null)
        setMaxScore(typeof a.maxScore === 'number' ? a.maxScore : null)
        setDropped(Array.isArray(a.droppedPhrases) ? a.droppedPhrases : [])
        setKinds(a.keywordKinds || {})
        setPostingWork(a.postingWork || '')
        setResumeWork(a.resumeWork || '')
        // Rubric total when the server sends one; the old keyword-only number otherwise.
        setScoreBefore(a.rubric?.total ?? a.scoreBefore ?? 0)
        setPhase('stand')
      } catch {
        if (!cancelled) { setError('generic'); setPhase('error') }
      }
    }
    run()
    return () => { cancelled = true }
  }, [job, getToken])

  const confirmedList = missing.filter(k => checked[k])
  const total = matched.length + missing.length
  const kwHave = matched.length + confirmedList.length
  // Same formula as scoreRubric() on the server: only the keyword row moves with taps.
  const liveScore = rubric
    ? rubric.total - (rubric.rows?.keywords?.pts || 0) + (total ? Math.round(40 * kwHave / total) : 0)
    : (total ? Math.round((kwHave / total) * 100) : 0)
  const stillGap = missing.filter(k => !checked[k])
  const allTapped = missing.length > 0 && confirmedList.length === missing.length

  function toggle(skill) {
    setChecked(c => ({ ...c, [skill]: !c[skill] }))
  }
  function addAll() {
    setChecked(Object.fromEntries(missing.map(k => [k, true])))
  }

  // Back to the checkboxes. Nothing needs refetching: matched, missing, checked,
  // resumeText and jobText all live here and are never cleared, and the loader effect is
  // keyed on [job, getToken], so returning costs no API call. Re-optimizing does.
  //
  // Edits made in the document are only in the DOM. Re-optimizing overwrites them, so ask
  // first rather than throwing away work silently.
  function backToSkills() {
    const edited = docRef.current && docRef.current.innerText.trim() !== optimized.trim()
    if (edited && !window.confirm('Your edits to this resume will be lost when you optimize again. Go back anyway?')) return
    setPhase('pick')
  }

  // ── step 2: rewrite
  async function rewrite() {
    setPromised(liveScore)
    setPhase('rewriting')
    try {
      const res = await fetch(`${BACKEND}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText,
          jobText,
          confirmedSkills: confirmedList,
          matchedKeywords: matched,   // pass lists so /optimize doesn't re-extract (kills drift)
          missingKeywords: missing,
          jobTitle: job.title || '',  // same key as /analyze, so the rubric inputs are a cache hit
          yearsMin: job.yearsMin ?? null,
        }),
      })
      if (!res.ok) throw new Error('optimize failed')
      const d = await res.json()
      setOptimized(d.optimizedResume || '')
      setAdded(d.addedKeywords || [])
      setScoreAfter(d.rubricAfter?.total ?? d.scoreAfter ?? liveScore)
      setFeedback(d.feedback || '')
      setPlacements(Array.isArray(d.placements) ? d.placements : [])
      setHtml(d.optimizedHtml || '')
      setChanges(Array.isArray(d.changes) ? d.changes : [])
      setSheetMode('formatted')
      setRemoved({})
      setDocVersion(v => v + 1)
      setTab('resume')
      setLetter('')
      setLetterState('idle')
      setPhase('result')

      // If this job is ALREADY in the tracker — they applied straight from the board
      // first — save the rewrite against that row now, rather than losing it when the
      // modal closes. attachOnly means the server keeps it flagged as not-sent, because
      // the employer received the earlier version.
      //
      // Never awaited and never surfaced: this is a background nicety, and a failure
      // here should not intrude on someone reading their new resume.
      try {
        const token = await getToken()
        fetch(`${BACKEND}/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            jobId: job.id, attachOnly: true,
            resumeText: d.optimizedResume || '',
            scoreBefore, scoreAfter: d.scoreAfter ?? liveScore,
            confirmedSkills: confirmedList,
          }),
        }).catch(() => {})
      } catch {}
    } catch {
      setError('generic')
      setPhase('error')
    }
  }

  // ── placement cards: ✕ pulls a skill out of the bullet it was woven into
  function removePlacement(p) {
    const current = docRef.current?.innerText || optimized
    let next = ensureInSkills(stripFragment(current, p.fragment), p.skill)
    // Two skills can share one fragment ("used by internal Looker and Superset
    // dashboards"). Removing it takes both out of the bullet, so every card whose
    // fragment is no longer in the document flips with this one and shares its Undo.
    const alsoGone = placements.filter(q => q.removable && q.skill !== p.skill && removed[q.skill] === undefined && q.fragment && !next.includes(q.fragment))
    for (const q of alsoGone) next = ensureInSkills(next, q.skill)
    setRemoved(r => { const c = { ...r, [p.skill]: current }; for (const q of alsoGone) c[q.skill] = current; return c })
    setOptimized(next)
    setDocVersion(v => v + 1)
    rerender(next)
  }
  // The formatted sheet is server-rendered from text, so any text change re-renders it.
  async function rerender(text) {
    try {
      const res = await fetch(`${BACKEND}/render-resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeText: text, font: DOC_FONT }) })
      if (res.ok) { const d = await res.json(); setHtml(d.html || '') }
    } catch {}
  }
  // Formatted ↔ edit. Leaving edit mode commits the edited text and re-renders.
  function toggleSheet() {
    if (sheetMode === 'edit') {
      const text = docRef.current?.innerText || optimized
      setOptimized(text)
      setDocVersion(v => v + 1)
      rerender(text)
      setSheetMode('formatted')
    } else {
      setSheetMode('edit')
    }
  }
  function undoPlacement(p) {
    const snap = removed[p.skill]
    if (snap === undefined) return
    // Cards that were flipped by the same ✕ hold the same snapshot; restoring it
    // brings them all back, so they are cleared together.
    setRemoved(r => { const c = { ...r }; for (const k of Object.keys(c)) if (c[k] === snap) delete c[k]; return c })
    setOptimized(snap)
    setDocVersion(v => v + 1)
    rerender(snap)
  }

  // ── cover letter tab: generated on first click only, from the resume on screen
  async function openLetter() {
    setTab('letter')
    if (letterState === 'ready' || letterState === 'loading') return
    setLetterState('loading')
    try {
      const res = await fetch(`${BACKEND}/cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText, jobText,
          jobTitle: job.title || '', company: job.company || '',
          confirmedSkills: confirmedList, missingKeywords: missing,
          optimizedResume: docRef.current?.innerText || optimized,
        }),
      })
      if (!res.ok) throw new Error('cover letter failed')
      const d = await res.json()
      setLetter(d.coverLetter || '')
      setLetterState('ready')
    } catch {
      setLetterState('error')
    }
  }
  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letterRef.current?.innerText || letter)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  // ── step 3: download (same endpoints + payload as the Resume Tool)
  // Fires as the student clicks through to the employer's site. Deliberately does not
  // block or await anything the user can see: the link opens either way, and a tracker
  // write failing must never stand between someone and a job application.
  //
  // The resume is read from docRef, not from `optimized`, so what gets stored is what
  // they actually looked at — edits included.
  async function trackApplication() {
    try {
      const token = await getToken()
      await fetch(`${BACKEND}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jobId:    job.id,
          title:    job.title,
          company:  job.company,
          location: job.location || '',
          applyUrl: job.applyUrl,
          resumeText: docRef.current?.innerText || optimized,
          scoreBefore,
          scoreAfter,
          confirmedSkills: confirmedList,
        }),
      })
      // Arms the board's "did you apply?" question. Passed the company so the prompt
      // can name it rather than asking about "this job".
      onApplied?.(job.id, job.company)
    } catch (err) {
      // Silent on purpose. They are already on the employer's page by now, and an
      // error toast about a tracker row would be noise at the worst moment.
      console.warn('Could not record this application:', err)
    }
  }

  async function handleDownload(type) {
    if (!optimized) return
    // The tab decides the document. On the letter tab the same buttons download the
    // letter as a file, because application forms have upload fields, not paste boxes.
    const isLetter = tab === 'letter'
    if (isLetter && letterState !== 'ready') return
    setDlLoading(type)
    try {
      const res = await fetch(`${BACKEND}/download-${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Whatever is on screen is what downloads, edits included.
        body: JSON.stringify({
          resumeText: docRef.current?.innerText || optimized,
          font: DOC_FONT,
          length: 'standard',
          ...(isLetter ? { kind: 'letter', letterText: letterRef.current?.innerText || letter, company: job.company || '' } : {}),
        }),
      })
      if (!res.ok) { alert('Download failed. Please try again.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const base = isLetter ? 'cover-letter' : 'optimized-resume'
      a.download = type === 'pdf' ? `${base}.pdf` : `${base}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed. Please try again.')
    } finally {
      setDlLoading('')
    }
  }

  // ── derived, for the screens
  const stepIndex = phase === 'stand' ? 1 : phase === 'pick' ? 2 : (phase === 'rewriting' || phase === 'result') ? 3 : 0
  const rows = rubric?.rows || null
  const ringColor = v => v >= 80 ? '#047857' : v >= 60 ? '#B45309' : '#DC2626'
  const tools = missing.filter(k => kinds[k] !== 'practice')
  const practices = missing.filter(k => kinds[k] === 'practice')
  const perTap = total ? Math.round(40 / total) : 0
  const verdict = (() => {
    if (!rows) return { t: 'Analyzed.', s: '' }
    if (rows.role.match === false) return { t: 'Different core role.', s: `The posting is for "${job.title}"; your latest title reads "${rows.role.resumeTitle || 'unknown'}". Keywords can't close that gap, and the score says so.` }
    if (rows.years.pts === 0) return { t: 'Years short — everything else fits.', s: `${rows.years.required}+ asked, ${rows.years.have} on your resume. That row stays at zero no matter what you tap.` }
    if (missing.length) return { t: 'Partial match — and most of the gap is tappable.', s: `Same core role, years covered. What's missing is ${missing.length} ${missing.length === 1 ? 'skill' : 'skills'} the posting names and your resume doesn't.` }
    return { t: 'Strong match already.', s: 'Every skill the posting names is on your resume. The rewrite will speak this job\'s language without adding anything.' }
  })()
  const promiseKept = promised === null || scoreAfter === promised

  return (
    <div className="om-overlay" onClick={onClose}>
      <style>{CSS}</style>
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`om-modal om-${phase}`}
        style={{ outline: 'none' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── top: title + steps ── */}
        <div className="om-top">
          <div className="om-top-row">
            <div>
              <div className="om-kicker">Optimize for</div>
              <div className="om-title">{job.title}</div>
              <div className="om-sub">{job.company}{job.location ? ` · ${job.location}` : ''}</div>
            </div>
            <button className="om-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
          {stepIndex > 0 && (
            <div className="om-steps">
              {[['Where you stand', 1], ['Tell the truth', 2], ['Your resume', 3]].map(([label, n]) => (
                <button
                  key={n}
                  className={`om-step ${stepIndex === n ? 'on' : stepIndex > n ? 'done' : ''}`}
                  disabled={n >= stepIndex || phase === 'rewriting'}
                  onClick={() => { if (n === 1) setPhase('stand'); else if (n === 2) backToSkills() }}
                >
                  <span className="om-step-n">{stepIndex > n ? <Check size={11} /> : n}</span>{label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── body ── */}
        <div className="om-body">

          {phase === 'loading' && (
            <div className="om-load">
              <div className="om-spin" />
              <div className="om-load-t">Reading the posting and your resume…</div>
              <div className="om-load-s">Skills from the posting only. Whether you have one is checked against your resume's text, not guessed.</div>
            </div>
          )}

          {phase === 'error' && (
            <div className="om-load">
              {error === 'job-closed' ? <Ban size={26} color="#8E8E93" /> : <AlertCircle size={26} color="#DC2626" />}
              {error === 'job-closed' ? (
                <>
                  <div className="om-load-t" style={{ marginTop: 10 }}>This job is no longer open</div>
                  <div className="om-load-s">{job.company} closed this posting, so there is nothing to optimize against. Nothing you did caused this. It drops off the board at the next refresh.</div>
                  <button className="om-closed-btn" onClick={onClose}>Back to jobs</button>
                </>
              ) : error === 'no-resume' ? (
                <>
                  <div className="om-load-t" style={{ marginTop: 10 }}>No resume on file</div>
                  <div className="om-load-s">Upload your resume on the Profile page first, then come back to this job.</div>
                  <button className="om-closed-btn" onClick={onClose}>Close</button>
                </>
              ) : (
                <>
                  <div className="om-load-t" style={{ marginTop: 10 }}>Couldn't analyze this job</div>
                  <div className="om-load-s">Something went wrong on our side. Close this and try again in a moment.</div>
                  <button className="om-closed-btn" onClick={onClose}>Close</button>
                </>
              )}
            </div>
          )}

          {/* ══ STEP 1 · where you stand ══ */}
          {phase === 'stand' && rows && (
            <div className="om-s1">
              <div className="om-card">
                <div className="om-scorecard">
                  <div className="om-ring" style={{ background: `conic-gradient(${ringColor(scoreBefore)} 0 ${scoreBefore}%, #EEEBE6 ${scoreBefore}% 100%)` }}>
                    <b>{scoreBefore}</b><small>of 100</small>
                  </div>
                  <div>
                    <div className="om-verdict">{verdict.t}</div>
                    <div className="om-verdict-s">{verdict.s}</div>
                  </div>
                </div>
                <div className="om-card-h om-card-h-line">How this score is built</div>
                <div className="om-rows">
                  <Row name="Core role match" pts={rows.role.pts} max={20}
                    detail={rows.role.match === null ? (rows.role.note || 'not compared') : `"${job.title}" ↔ "${rows.role.resumeTitle || 'your latest title'}" · seniority ignored → ${rows.role.match ? 'same core role' : 'different role'}`} />
                  <Row name="Years of experience" pts={rows.years.pts} max={10}
                    detail={rows.years.required === null ? 'posting states no minimum' : rows.years.have === null ? `${rows.years.required}+ required · could not read your dates` : `${rows.years.required}+ required · ${rows.years.have} on your resume`} />
                  <Row name="Bullet relevance" pts={rows.bullets.pts} max={30}
                    detail={rows.bullets.grade === null ? 'not graded' : `how closely your work stories mirror this job's work · ${rows.bullets.grade} / 5`} />
                  <Row name="Keywords" pts={rows.keywords.pts} max={40}
                    detail={`${matched.length} of ${total} the posting names are on your resume${missing.length ? ' · the rest are yours to confirm in step 2' : ''}`} />
                </div>
              </div>
              <div className="om-card">
                <div className="om-card-h">The posting vs. you</div>
                <div className="om-cmp">
                  <div className="h" /><div className="h">Posting asks</div><div className="h">Your resume says</div>
                  <div className="k">Title</div><div className="v">{job.title}</div><div className="v me">{rows.role.resumeTitle || '—'}</div>
                  <div className="k">Years</div><div className="v">{rows.years.required === null ? 'not stated' : `${rows.years.required}+`}</div><div className="v me">{rows.years.have === null ? '—' : rows.years.have}</div>
                  {(postingWork || resumeWork) && (<><div className="k">The work</div><div className="v">{postingWork || '—'}</div><div className="v me">{resumeWork || '—'}</div></>)}
                  <div className="k">Skills</div>
                  <div className="v">
                    {matched.map(k => <span key={k} className="om-chip have">{k}</span>)}
                    {missing.map(k => <span key={k} className="om-chip miss">{k}</span>)}
                  </div>
                  <div className="v me">{matched.length} of {total} present</div>
                </div>
                <div className="om-why"><b>What this number is not:</b> a promise. It's the score this resume gets today. Step 2 asks you what's true; step 3 rewrites only from that.</div>
              </div>
            </div>
          )}

          {/* ══ STEP 2 · tell the truth ══ */}
          {phase === 'pick' && (
            <div className="om-s2">
              <div className="om-card">
                {matched.length > 0 && (
                  <>
                    <div className="om-card-h">Already on your resume</div>
                    <div className="om-haverow">{matched.map(k => <span key={k} className="om-chip have">✓ {k}</span>)}</div>
                  </>
                )}
                {missing.length > 0 ? (
                  <>
                    <div className="om-card-h om-card-h-line">Not on your resume — have you used these?</div>
                    <div className="om-group">
                      {tools.length > 0 && (
                        <>
                          <div className="om-group-h">Tools <span>· named products</span></div>
                          <div className="om-tap">{tools.map(k => <Tap key={k} k={k} on={!!checked[k]} onClick={() => toggle(k)} />)}</div>
                        </>
                      )}
                      {practices.length > 0 && (
                        <>
                          <div className="om-group-h">Practices <span>· things you've done, not products</span></div>
                          <div className="om-tap">{practices.map(k => <Tap key={k} k={k} on={!!checked[k]} onClick={() => toggle(k)} />)}</div>
                        </>
                      )}
                      <div className="om-tap-actions">
                        <button className="om-link" onClick={addAll}><CheckCheck size={12} />I've used all of these</button>
                        {confirmedList.length > 0 && <button className="om-link" onClick={() => setChecked({})}>Clear</button>}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="om-card-h om-card-h-line" style={{ paddingBottom: 18 }}>Every skill the posting names is already on your resume. Nothing to confirm — the rewrite only reframes.</div>
                )}
                {dropped.length > 0 && (
                  <div className="om-junk"><s>{dropped.join(', ')}</s> — job-ad phrases, not skills. Never offered as checkboxes.</div>
                )}
              </div>
              <div className="om-card om-proj">
                <div className="om-kicker">Projected score</div>
                <div className="om-big">
                  <span>{liveScore}</span><em>/ 100</em>
                  {confirmedList.length > 0 && <span className="om-delta">↑ {liveScore - scoreBefore}</span>}
                </div>
                <div className="om-bar">
                  <i style={{ width: `${liveScore}%` }} />
                  {maxScore !== null && <u style={{ left: `${maxScore}%` }} title={`Your honest ceiling: ${maxScore}`} />}
                </div>
                <div className="om-bar-l"><span>today {scoreBefore}</span>{maxScore !== null && <span>honest max {maxScore}</span>}</div>
                <div className={`om-max ${allTapped ? 'on' : ''}`}>
                  {allTapped
                    ? <><b>✓ {liveScore} — your best honest score for this job.</b> Every keyword is covered{liveScore < 100 ? '; the rest of the gap is the rows above, not something to fix on a resume' : ''}.</>
                    : confirmedList.length > 0
                      ? <>Projected <b>{liveScore}</b>. {stillGap.length} untapped {stillGap.length === 1 ? 'skill' : 'skills'} left — tap only what's true.</>
                      : <>Tap only what's true. Each skill you confirm is worth about {perTap} points; nothing else on this screen can move the number.</>}
                </div>
                {rows && (
                  <div className="om-mini">
                    <Row name="Core role" pts={rows.role.pts} max={20} />
                    <Row name="Years" pts={rows.years.pts} max={10} />
                    <Row name="Bullet relevance" pts={rows.bullets.pts} max={30} />
                    <Row name="Keywords" pts={total ? Math.round(40 * kwHave / total) : 0} max={40} />
                  </div>
                )}
                <div className="om-promise">The number you see here is the number step 3 delivers. Every tapped skill is guaranteed to land on the resume — in a bullet where your own work supports it, otherwise in your Skills section, and the card will say which.</div>
              </div>
            </div>
          )}

          {phase === 'rewriting' && (
            <div className="om-load">
              <div className="om-spin" />
              <div className="om-load-t">Rewriting from your facts…</div>
              <div className="om-load-s">{confirmedList.length ? `${confirmedList.length} confirmed ${confirmedList.length === 1 ? 'skill' : 'skills'} will land on the resume; the card will say where.` : 'Reframing toward this job. Nothing added.'} Usually 15–30 seconds.</div>
            </div>
          )}

          {/* ══ STEP 3 · your resume ══ */}
          {phase === 'result' && (
            <div className="om-s3">
              <div className="om-s3-main">
                <div className="om-tabs">
                  <button className={`om-tab ${tab === 'resume' ? 'on' : ''}`} onClick={() => setTab('resume')}><FileText size={12} />Optimized resume</button>
                  <button className={`om-tab ${tab === 'letter' ? 'on' : ''}`} onClick={openLetter}><PenLine size={12} />Cover letter</button>
                  {tab === 'resume' && html && (
                    <button className="om-tab om-tab-r" onClick={toggleSheet}>{sheetMode === 'edit' ? <><Check size={12} />Done editing</> : <><PenLine size={12} />Edit text</>}</button>
                  )}
                </div>
                {tab === 'resume' ? (
                  sheetMode === 'formatted' && html ? (
                    <div className="om-sheet" dangerouslySetInnerHTML={{ __html: html }} />
                  ) : (
                    <div className="om-paper">
                      <div className="om-paper-h"><span>Click anywhere to edit · {DOC_FONT}</span><span>Done editing re-renders the sheet</span></div>
                      <pre key={docVersion} ref={docRef} className="om-resume" contentEditable suppressContentEditableWarning spellCheck={false}>
                        <ResumeView text={optimized} skills={added} originalText={resumeText} />
                      </pre>
                    </div>
                  )
                ) : (
                  <div className="om-paper om-paper-letter">
                    <div className="om-paper-h"><span>{letterState === 'ready' ? 'Click anywhere to edit' : 'Cover letter'}</span><span>Built only from your resume's facts</span></div>
                    {letterState === 'loading' && (
                      <div className="om-load" style={{ padding: '36px 0' }}><div className="om-spin" /><div className="om-load-t">Writing your cover letter…</div><div className="om-load-s">From your resume's facts and the skills you tapped. Nothing else.</div></div>
                    )}
                    {letterState === 'error' && (
                      <div className="om-load" style={{ padding: '36px 0' }}><AlertCircle size={22} color="#DC2626" /><div className="om-load-t" style={{ marginTop: 8 }}>Couldn't write the letter</div><button className="om-closed-btn" onClick={() => { setLetterState('idle'); openLetter() }}>Try again</button></div>
                    )}
                    {letterState === 'ready' && (
                      <pre ref={letterRef} className="om-resume om-letter" contentEditable suppressContentEditableWarning spellCheck={false}>{letter}</pre>
                    )}
                  </div>
                )}
              </div>
              <div className="om-s3-rail">
                <div className="om-score-top">
                  <div className="om-ring2" style={{ background: `conic-gradient(${ringColor(scoreAfter)} 0 ${scoreAfter}%, #E5E7EB ${scoreAfter}% 100%)` }}><b>{scoreAfter}</b></div>
                  <div>
                    <div className="om-t1">Delivered: {scoreAfter}</div>
                    <div className={`om-t2 ${promiseKept ? '' : 'warn'}`}>{promiseKept ? `exactly what step 2 promised · ↑ ${scoreAfter - scoreBefore} from ${scoreBefore}` : `promised ${promised}, delivered ${scoreAfter}`}</div>
                  </div>
                </div>
                <div className="om-dl-row">
                  <button className="om-dl" onClick={() => handleDownload('word')} disabled={!!dlLoading || (tab === 'letter' && letterState !== 'ready')}><FileText size={13} />{dlLoading === 'word' ? '…' : 'Word'}</button>
                  <button className="om-dl" onClick={() => handleDownload('pdf')} disabled={!!dlLoading || (tab === 'letter' && letterState !== 'ready')}><Download size={13} />{dlLoading === 'pdf' ? '…' : 'PDF'}</button>
                  {tab === 'letter' && letterState === 'ready' && <button className="om-dl" onClick={copyLetter}><Copy size={13} />{copied ? 'Copied' : 'Copy'}</button>}
                </div>
                {tab === 'letter' ? (
                  <>
                    <div className="om-rail-h">Cover letter</div>
                    <div className="om-rail-s"><b>✍ Built only from your resume's facts</b> and the skills you tapped. No invented projects, no fake passion for the company. Edit before you paste or download it.</div>
                  </>
                ) : (
                  <>
                    {placements.length > 0 && (
                      <>
                        <div className="om-rail-h">{placements.length} {placements.length === 1 ? 'skill' : 'skills'} woven in</div>
                        <div className="om-rail-s">Each card says exactly <b>where</b> a skill went. Wrong place? <b>✕</b> pulls it back to your Skills section.</div>
                        {placements.map(p => {
                          const isRemoved = removed[p.skill] !== undefined
                          const skillsOnly = !p.removable || isRemoved
                          return (
                            <div key={p.skill} className={`om-wov ${skillsOnly ? 'skillonly' : ''}`}>
                              <div className="om-wov-r1">
                                <span className="om-chip have">{p.skill}</span>
                                {p.removable && (isRemoved
                                  ? <button className="om-wov-x undo" title="Put it back" onClick={() => undoPlacement(p)}><Undo2 size={11} />Undo</button>
                                  : <button className="om-wov-x" title="I didn't use this there — remove" onClick={() => removePlacement(p)}><X size={11} /></button>)}
                              </div>
                              <div className="om-wov-w">
                                {skillsOnly
                                  ? (isRemoved ? <>→ Skills section only — removed from {p.employer || 'that bullet'}</> : <>→ Skills section only · be ready to say where you used it</>)
                                  : <>→ Skills section <b>+ your {p.employer || 'experience'} bullet</b></>}
                              </div>
                              {!skillsOnly && p.fragment && <div className="om-wov-f">"{p.fragment}"</div>}
                            </div>
                          )
                        })}
                      </>
                    )}
                    {(changes.length > 0 || feedback) && (
                      <div className="om-changed">
                        <div className="om-rail-h">What changed</div>
                        {changes.length > 0
                          ? <ul>{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                          : <div className="om-rail-s">{feedback}</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── foot ── */}
        <div className="om-foot">
          <div className="om-hint">
            {phase === 'stand' && 'Nothing is written to your resume until step 3, and only from what you confirm.'}
            {phase === 'pick' && "Tap only what's true. Untapped skills stay off your resume — and off the score."}
            {phase === 'result' && 'Downloads are the document on screen, edits included. Apply opens the posting in a new tab.'}
            {phase === 'rewriting' && 'Rewriting…'}
          </div>
          <div className="om-foot-btns">
            {phase === 'stand' && <button className="om-btn p" onClick={() => setPhase('pick')}>{missing.length ? "See what's missing" : 'Continue'}<ArrowRight size={14} /></button>}
            {phase === 'pick' && (
              <>
                <button className="om-btn g" onClick={() => setPhase('stand')}><ArrowLeft size={14} />Back</button>
                <button className="om-btn p" onClick={rewrite}>{confirmedList.length ? `Add ${confirmedList.length} ${confirmedList.length === 1 ? 'skill' : 'skills'} and rewrite` : 'Rewrite without adding skills'}<ArrowRight size={14} /></button>
              </>
            )}
            {phase === 'result' && (
              <>
                <button className="om-btn g" onClick={backToSkills}><ArrowLeft size={14} />Edit skills</button>
                <a className="om-btn p" href={job.applyUrl} target="_blank" rel="noreferrer" onClick={trackApplication}><ExternalLink size={14} />Apply to this job</a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── small presentational pieces ──
function Row({ name, detail, pts, max }) {
  const cls = pts === max ? 'ok' : pts === 0 ? 'no' : 'mid'
  return (
    <div className="om-row">
      <div><div className="om-row-n">{name}</div>{detail && <div className="om-row-d">{detail}</div>}</div>
      <span className={`om-pill ${cls}`}>{pts} / {max}</span>
    </div>
  )
}
function Tap({ k, on, onClick }) {
  return (
    <button type="button" className={`om-t ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="om-bx">{on && <Check size={10} />}</span>{k}
    </button>
  )
}

const CSS = `
/* ── Optyply optimizer v2 · tokens live here so a restyle is a swap ── */
.om-overlay { --ink:#0A0A0B; --ink2:#374151; --mute:#6B7280; --mute2:#9CA3AF; --line:#F1EDE7; --line2:#E5E7EB; --bg:#F7F5F1;
  --blue:#2563EB; --blue2:#EFF6FF; --blue3:#DBEAFE; --green:#047857; --green2:#ECFDF5; --green3:#A7F3D0;
  --amber:#92400E; --amber2:#FFFBEB; --amber3:#FDE68A; --red:#991B1B; --red2:#FEF2F2; --red3:#FECACA; --r:14px;
  position: fixed; inset: 0; background: rgba(10,10,11,.55); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 18px;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; color: var(--ink); }
.om-overlay * { box-sizing: border-box; }
.om-modal { width: min(1240px, 100%); height: min(94vh, 900px); background: #fff; border-radius: 24px; box-shadow: 0 30px 80px rgba(0,0,0,.3);
  display: flex; flex-direction: column; overflow: hidden; }
.om-modal.om-loading, .om-modal.om-error { width: min(560px, 100%); height: auto; }

.om-top { padding: 18px 26px 0; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.om-top-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 14px; }
.om-kicker { font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--mute); }
.om-title { font-size: 19px; font-weight: 800; margin-top: 3px; letter-spacing: -.01em; }
.om-sub { font-size: 12.5px; color: var(--mute); margin-top: 2px; }
.om-x { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line2); background: #fff; display: grid; place-items: center; cursor: pointer; color: var(--mute); }
.om-x:hover { color: var(--ink); border-color: #CBD5E1; }
.om-steps { display: flex; }
.om-step { display: inline-flex; align-items: center; gap: 9px; padding: 0 0 12px; margin-right: 34px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--mute2);
  background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
.om-step:disabled { cursor: default; }
.om-step-n { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--line2); display: grid; place-items: center; font-size: 11px; font-weight: 800; }
.om-step.on { color: var(--ink); border-bottom-color: var(--blue); }
.om-step.on .om-step-n { background: var(--blue); border-color: var(--blue); color: #fff; }
.om-step.done { color: var(--green); }
.om-step.done .om-step-n { background: var(--green2); border-color: var(--green3); color: var(--green); }

.om-body { flex: 1; min-height: 0; overflow: auto; background: var(--bg); }
.om-modal.om-loading .om-body, .om-modal.om-error .om-body { background: #fff; }
.om-foot { padding: 14px 26px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; background: #fff; }
.om-modal.om-loading .om-foot, .om-modal.om-error .om-foot { display: none; }
.om-hint { font-size: 12px; color: var(--mute); }
.om-foot-btns { display: flex; gap: 10px; }
.om-btn { border: 0; border-radius: 12px; padding: 12px 20px; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
.om-btn.p { background: var(--blue); color: #fff; box-shadow: 0 8px 20px rgba(37,99,235,.28); }
.om-btn.p:hover { background: #1D4ED8; }
.om-btn.g { background: #fff; color: var(--ink2); border: 1px solid var(--line2); }
.om-btn.g:hover { border-color: #CBD5E1; }

/* loading / error */
.om-load { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 52px 28px; }
.om-spin { width: 34px; height: 34px; border: 3px solid var(--line2); border-top-color: var(--blue); border-radius: 50%; animation: om-spin .8s linear infinite; }
@keyframes om-spin { to { transform: rotate(360deg); } }
.om-load-t { font-size: 15px; font-weight: 800; margin-top: 16px; }
.om-load-s { font-size: 12.5px; color: var(--mute); line-height: 1.55; max-width: 40ch; margin-top: 6px; }
.om-closed-btn { margin-top: 16px; background: #fff; border: 1.5px solid #DCDCE0; border-radius: 10px; padding: 9px 16px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }

/* shared pieces */
.om-card { background: #fff; border: 1px solid var(--line); border-radius: var(--r); }
.om-card-h { padding: 14px 18px 10px; font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--mute); }
.om-card-h-line { border-top: 1px solid var(--line); }
.om-rows { border-top: 1px solid var(--line); }
.om-row { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 12px 18px; border-bottom: 1px solid #F5F3EF; align-items: start; }
.om-row:last-child { border-bottom: 0; }
.om-row-n { font-size: 13px; font-weight: 700; }
.om-row-d { font-size: 11.5px; color: var(--mute); line-height: 1.5; margin-top: 2px; }
.om-pill { font-size: 11.5px; font-weight: 800; padding: 3px 9px; border-radius: 100px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.om-pill.ok { color: var(--green); background: var(--green2); border: 1px solid var(--green3); }
.om-pill.mid { color: var(--amber); background: var(--amber2); border: 1px solid var(--amber3); }
.om-pill.no { color: var(--red); background: var(--red2); border: 1px solid var(--red3); }
.om-chip { display: inline-block; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 100px; margin: 2px 3px 2px 0; }
.om-chip.have { color: var(--green); background: var(--green2); border: 1px solid var(--green3); }
.om-chip.miss { color: var(--ink2); background: #fff; border: 1px solid var(--line2); }

/* step 1 */
.om-s1 { padding: 26px 30px; display: grid; grid-template-columns: 1.1fr .9fr; gap: 22px; }
.om-scorecard { padding: 22px 24px; display: flex; align-items: center; gap: 22px; }
.om-ring { width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; position: relative; flex-shrink: 0; }
.om-ring::before { content: ''; position: absolute; inset: 9px; background: #fff; border-radius: 50%; }
.om-ring b { position: relative; font-size: 34px; font-weight: 800; letter-spacing: -.02em; }
.om-ring small { position: relative; display: block; font-size: 10px; color: var(--mute); font-weight: 700; text-align: center; margin-top: -2px; }
.om-verdict { font-size: 17px; font-weight: 800; }
.om-verdict-s { font-size: 13px; color: var(--mute); line-height: 1.5; margin-top: 5px; max-width: 44ch; }
.om-cmp { display: grid; grid-template-columns: 110px 1fr 1fr; font-size: 12.5px; border-top: 1px solid var(--line); }
.om-cmp > div { padding: 11px 18px; border-bottom: 1px solid #F5F3EF; min-width: 0; }
.om-cmp .h { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); background: #FBFAF8; }
.om-cmp .k { font-weight: 700; color: var(--ink2); }
.om-cmp .v { color: var(--ink); line-height: 1.5; }
.om-cmp .v.me { color: var(--blue); font-weight: 600; }
.om-why { padding: 14px 18px; font-size: 12.5px; color: var(--ink2); line-height: 1.55; border-top: 1px solid var(--line); background: #FBFAF8; border-radius: 0 0 var(--r) var(--r); }
.om-why b { color: var(--ink); }

/* step 2 */
.om-s2 { padding: 26px 30px; display: grid; grid-template-columns: 1fr 340px; gap: 22px; align-items: start; }
.om-haverow { padding: 0 18px 14px; }
.om-group { padding: 4px 18px 14px; }
.om-group-h { font-size: 12px; font-weight: 800; margin: 12px 0 8px; display: flex; align-items: center; gap: 8px; }
.om-group-h span { font-size: 11px; color: var(--mute); font-weight: 600; }
.om-tap { display: flex; flex-wrap: wrap; gap: 8px; }
.om-t { border: 1.5px solid var(--line2); background: #fff; border-radius: 10px; padding: 9px 13px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 9px; transition: .12s; color: var(--ink); }
.om-t:hover { border-color: #93C5FD; }
.om-bx { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid #CBD5E1; display: grid; place-items: center; color: #fff; }
.om-t.on { background: var(--green2); border-color: var(--green3); color: var(--green); }
.om-t.on .om-bx { background: var(--green); border-color: var(--green); }
.om-tap-actions { display: flex; gap: 14px; margin-top: 14px; }
.om-link { background: none; border: 0; font: inherit; font-size: 12px; font-weight: 700; color: var(--blue); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 0; }
.om-junk { margin: 6px 18px 16px; padding: 10px 12px; font-size: 11.5px; color: var(--mute); line-height: 1.5; background: #FBFAF8; border: 1px dashed var(--line2); border-radius: 10px; }
.om-junk s { color: var(--mute2); }
.om-proj { padding: 18px 20px; position: sticky; top: 0; }
.om-big { font-size: 44px; font-weight: 800; letter-spacing: -.03em; line-height: 1; display: flex; align-items: baseline; gap: 10px; margin-top: 6px; }
.om-big em { font-style: normal; font-size: 13px; color: var(--mute); font-weight: 700; }
.om-delta { font-size: 12px; font-weight: 800; color: var(--green); background: var(--green2); border: 1px solid var(--green3); border-radius: 100px; padding: 2px 8px; }
.om-bar { height: 8px; background: #EEEBE6; border-radius: 100px; margin: 14px 0 6px; overflow: visible; position: relative; }
.om-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--blue); border-radius: 100px; transition: width .35s; }
.om-bar u { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--ink); }
.om-bar-l { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--mute); font-weight: 700; }
.om-max { margin-top: 14px; padding: 11px 13px; border-radius: 10px; font-size: 12px; line-height: 1.55; color: var(--ink2); background: #FBFAF8; border: 1px solid var(--line); }
.om-max b { color: var(--ink); }
.om-max.on { background: var(--green2); border-color: var(--green3); color: #065F46; }
.om-max.on b { color: var(--green); }
.om-mini { margin-top: 12px; }
.om-mini .om-row { padding: 9px 0; }
.om-mini .om-row-n { font-size: 12px; }
.om-promise { margin-top: 12px; font-size: 11.5px; color: var(--mute); line-height: 1.5; }

/* step 3 */
.om-s3 { display: grid; grid-template-columns: 1fr 330px; height: 100%; }
.om-s3-main { padding: 22px 26px; overflow: auto; }
.om-tabs { display: flex; gap: 4px; margin-bottom: 14px; align-items: center; }
.om-tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 6px 12px 9px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mute); cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }
.om-tab.on { color: var(--blue); border-bottom-color: var(--blue); }
.om-tab:hover { color: var(--ink); }
.om-tab-r { margin-left: auto; font-size: 12px; color: var(--ink2); border: 1px solid var(--line2); border-radius: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line2); }
.om-tab-r:hover { border-color: #CBD5E1; }
.om-sheet { background: #fff; border: 1px solid var(--line2); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,.08); padding: 44px 52px; max-width: 820px; margin: 0 auto;
  font-family: ${DOC_FONT_CSS}; color: #222; font-size: 10.5pt; line-height: 1.4; }
.om-paper { background: #fff; border: 1px solid var(--line2); border-radius: 10px; max-width: 820px; margin: 0 auto; overflow: hidden; }
.om-paper-h { display: flex; justify-content: space-between; padding: 8px 14px; font-size: 10.5px; color: var(--mute); border-bottom: 1px solid var(--line); background: #FBFAF8; }
.om-resume { font-family: ${DOC_FONT_CSS}; font-size: 12.5px; line-height: 1.6; color: #1F2937; padding: 22px 26px; margin: 0; white-space: pre-wrap; word-wrap: break-word; outline: none; min-height: 300px; }
.om-mark { background: #D1FAE5; color: #047857; font-weight: 700; padding: 0 3px; border-radius: 3px; }
.om-mark-new { background: #FEF3C7; color: #92400E; padding: 0 2px; border-radius: 3px; }
.om-letter { min-height: 200px; }
.om-s3-rail { border-left: 1px solid var(--line); background: #fff; padding: 22px 20px; overflow: auto; }
.om-score-top { display: flex; align-items: center; gap: 14px; }
.om-ring2 { width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; position: relative; flex-shrink: 0; }
.om-ring2::before { content: ''; position: absolute; inset: 5px; background: #fff; border-radius: 50%; }
.om-ring2 b { position: relative; font-size: 15px; font-weight: 800; }
.om-t1 { font-size: 12.5px; font-weight: 800; }
.om-t2 { font-size: 11px; color: var(--green); font-weight: 700; margin-top: 2px; }
.om-t2.warn { color: var(--red); }
.om-dl-row { display: flex; gap: 8px; margin: 12px 0 16px; }
.om-dl { flex: 1; justify-content: center; display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid var(--line2); border-radius: 9px; padding: 9px 12px; font: inherit; font-size: 12px; font-weight: 700; color: var(--ink2); cursor: pointer; }
.om-dl:hover { border-color: #CBD5E1; }
.om-dl:disabled { opacity: .5; cursor: default; }
.om-rail-h { font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--mute); margin-bottom: 6px; }
.om-rail-s { font-size: 11.5px; color: var(--mute); line-height: 1.5; margin-bottom: 12px; }
.om-rail-s b { color: var(--ink); }
.om-wov { border: 1px solid var(--green3); background: #F7FEFB; border-radius: 11px; padding: 10px 11px; margin-bottom: 8px; }
.om-wov.skillonly { border-color: var(--line2); background: #FBFAF8; }
.om-wov-r1 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.om-wov .om-chip.have { margin: 0; }
.om-wov-x { width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--line2); background: #fff; color: var(--mute); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 11px; font-weight: 800; gap: 4px; }
.om-wov-x:hover { border-color: #DC2626; color: #DC2626; }
.om-wov-x.undo { width: auto; padding: 0 8px; color: var(--blue); border-color: var(--blue3); }
.om-wov-x.undo:hover { background: var(--blue2); }
.om-wov-w { font-size: 11.5px; color: var(--mute); margin-top: 7px; line-height: 1.45; }
.om-wov-w b { color: var(--green); }
.om-wov-f { font-size: 11px; color: var(--ink2); font-style: italic; margin-top: 4px; line-height: 1.4; }
.om-changed { margin-top: 18px; }
.om-changed ul { margin: 0 0 0 16px; }
.om-changed li { font-size: 12px; color: var(--ink2); line-height: 1.6; }

@media (max-width: 860px) {
  .om-modal { height: auto; max-height: 94vh; }
  .om-s1, .om-s2 { grid-template-columns: 1fr; padding: 16px; }
  .om-proj { position: static; }
  .om-s3 { grid-template-columns: 1fr; height: auto; }
  .om-s3-rail { border-left: 0; border-top: 1px solid var(--line); }
  .om-sheet { padding: 24px 20px; }
  .om-cmp { grid-template-columns: 90px 1fr 1fr; }
  .om-step { margin-right: 16px; font-size: 11.5px; }
}
`

