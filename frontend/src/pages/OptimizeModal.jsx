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

function ScoreBar({ before, after, animate }) {
  const [shown, setShown] = useState(before)
  useEffect(() => {
    if (!animate) { setShown(after); return }
    setShown(before)
    let v = before
    const t = setInterval(() => {
      v += 1
      if (v >= after) { v = after; clearInterval(t) }
      setShown(v)
    }, 26)
    // The backdrop does not close this modal — the X is the only way out, on every screen.
  //
  // It used to close on any outside click, which threw away a rewrite that took 30-60
  // seconds and a paid API call. Making it phase-dependent was worse: a click outside
  // closed the modal on one screen and did nothing on the next, so there was no way to
  // predict which you would get. One rule is easier to trust than a clever one.
  //
  // Nothing here is free to redo either — the skills screen is backed by its own paid
  // analyse call.
  return () => clearInterval(t)
  }, [before, after, animate])
  const color = shown >= 80 ? '#059669' : shown >= 60 ? '#D97706' : '#DC2626'
  // Coverage, not match. This number is keyword overlap and it rises with every box the
  // student ticks, so calling it a "match" tells them they are a strong candidate on the
  // strength of their own checkboxes. Same wording as the result screen.
  const verdict = shown >= 80 ? 'Strong coverage.' : shown >= 60 ? 'Partial coverage.' : 'Low coverage.'
  const vColor = shown >= 80 ? '#047857' : shown >= 60 ? '#92400E' : '#991B1B'
  return (
    <div className="om-score">
      <span className="om-score-n" style={{ color }}>{shown}</span>
      <div className="om-score-r">
        <div className="om-score-top">
          <span className="om-score-v" style={{ color: vColor }}>{verdict}</span>
          {shown > before && <span className="om-score-dl"><ArrowUp size={10} />{shown - before}</span>}
        </div>
        <div className="om-score-track"><div className="om-score-fill" style={{ width: `${shown}%`, background: color }} /></div>
      </div>
    </div>
  )
}

// Render the optimized resume with everything the AI introduced made visible,
// in every section, so the student can review before downloading:
//   GREEN  = a skill they explicitly confirmed, every occurrence, whole words
//            only ("RDS" no longer lights up inside "standards").
//   AMBER  = any other word that appears NOWHERE in their original resume —
//            a term the AI introduced. Check it before sending.
// Rewording that reuses the student's own vocabulary is deliberately unmarked:
// nearly every line is reworded by design, and marking all of it would turn
// the whole page green and hide the signal in the noise.
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

// Score rows. Same law as the server (keywords 40 · bullets 30 · role 20 · years 10);
// only the keyword row is recomputed here as the student taps, and with the same
// formula, so the number on this screen is the number the result screen delivers.
function RubricRows({ rubric, kwHave, kwTotal }) {
  if (!rubric?.rows) return null
  const r = rubric.rows
  const kwPts = kwTotal ? Math.round(40 * kwHave / kwTotal) : 0
  const roleDetail = r.role.match === null
    ? (r.role.note || 'not compared')
    : `"${r.role.jobTitle || 'this job'}" ↔ "${r.role.resumeTitle || 'your latest title'}" · seniority ignored → ${r.role.match ? 'same core role' : 'different role'}`
  const yearsDetail = r.years.required === null
    ? 'posting states no minimum'
    : r.years.have === null ? `${r.years.required}+ required · could not read your dates`
    : `${r.years.required}+ required · ${r.years.have} on your resume`
  const bulletDetail = r.bullets.grade === null ? 'not graded' : `how closely your work stories mirror this job's work · ${r.bullets.grade} / 5`
  const Row = ({ name, detail, pts, max }) => (
    <div className="om-rub-row">
      <div className="om-rub-l"><div className="om-rub-n">{name}</div><div className="om-rub-d">{detail}</div></div>
      <div className={`om-rub-p ${pts === max ? 'full' : pts === 0 ? 'zero' : ''}`}>{pts} / {max}</div>
    </div>
  )
  return (
    <div className="om-rub">
      <div className="om-lbl">How this score is built</div>
      <Row name="Core role match" detail={roleDetail} pts={r.role.pts} max={20} />
      <Row name="Years of experience" detail={yearsDetail} pts={r.years.pts} max={10} />
      <Row name="Bullet relevance" detail={bulletDetail} pts={r.bullets.pts} max={30} />
      <Row name="Keywords" detail={`${kwHave} / ${kwTotal} · tap below — every true tap counts`} pts={kwPts} max={40} />
    </div>
  )
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

  const [checked, setChecked]   = useState({})

  const [optimized, setOptimized]   = useState('')
  const [added, setAdded]           = useState([])
  const [scoreAfter, setScoreAfter] = useState(0)
  const [feedback, setFeedback]     = useState('')
  const [placements, setPlacements] = useState([])   // one card per tapped skill, server-verified
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
  }, [phase, optimized, added])

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
        // Rubric total when the server sends one; the old keyword-only number otherwise.
        setScoreBefore(a.rubric?.total ?? a.scoreBefore ?? 0)
        setPhase('pick')
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
  }
  function undoPlacement(p) {
    const snap = removed[p.skill]
    if (snap === undefined) return
    // Cards that were flipped by the same ✕ hold the same snapshot; restoring it
    // brings them all back, so they are cleared together.
    setRemoved(r => { const c = { ...r }; for (const k of Object.keys(c)) if (c[k] === snap) delete c[k]; return c })
    setOptimized(snap)
    setDocVersion(v => v + 1)
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

  return (
    <div className="om-overlay">
      <style>{CSS}</style>
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`om-modal ${phase === 'result' ? 'om-modal-result' : ''}`}
        style={{ '--om-w': phase === 'result' ? 'min(1180px, 96vw)' : 'min(760px, 94vw)', outline: 'none' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="om-head">
          <div>
            <div className="om-eyebrow">Optimize for</div>
            <div className="om-job">{job.title}</div>
            <div className="om-co">{job.company}{job.location ? ` · ${job.location}` : ''}</div>
          </div>
          <button className="om-x" onClick={onClose}><X size={15} /></button>
        </div>

        {phase === 'loading' && (
          <div className="om-load">
            <div className="om-spin" />
            <div className="om-load-t">Reading the job description…</div>
            <div className="om-load-s">Comparing it against your saved resume.</div>
          </div>
        )}

        {phase === 'error' && (
          <div className="om-load">
            {/* A closed posting is not a malfunction, so it gets a neutral icon
                rather than the red alert used for real errors. */}
            {error === 'job-closed'
              ? <Ban size={26} color="#8E8E93" />
              : <AlertCircle size={26} color="#DC2626" />}
            {error === 'job-closed' ? (
              <>
                <div className="om-load-t" style={{ marginTop: 10 }}>This job is no longer open</div>
                <div className="om-load-s">
                  {job.company} closed this posting, so there is nothing to optimize against.
                  Nothing you did caused this. It drops off the board at the next refresh.
                </div>
                <button className="om-closed-btn" onClick={onClose}>Back to jobs</button>
              </>
            ) : error === 'no-resume' ? (
              <>
                <div className="om-load-t" style={{ marginTop: 10 }}>No resume on file yet</div>
                <div className="om-load-s">Add your resume in Profile first, then optimize takes seconds.</div>
              </>
            ) : (
              <>
                <div className="om-load-t" style={{ marginTop: 10 }}>Something went wrong</div>
                <div className="om-load-s">Please close this and try again.</div>
              </>
            )}
          </div>
        )}

        {phase === 'pick' && (
          <>
            <div className="om-body">
              <ScoreBar before={scoreBefore} after={liveScore} animate={false} />
              <RubricRows rubric={rubric} kwHave={kwHave} kwTotal={total} />
              {rubric && confirmedList.length > 0 && (
                <div className={`om-proj ${allTapped ? 'max' : ''}`}>
                  {allTapped
                    ? <><b>✓ {liveScore} — your best honest score for this job.</b> Every keyword is covered{maxScore !== null && liveScore < 100 ? '; the rest of the gap is the role and years rows above, not something to fix on a resume' : ''}.</>
                    : <>Projected optimized score: <b>{liveScore}</b>. Untapped skills below are worth more points — tap only what's true.</>}
                </div>
              )}

              {matched.length > 0 && (
                <>
                  <div className="om-lbl">Already on your resume</div>
                  <div className="om-chips">
                    {matched.map(k => <span key={k} className="om-chip om-chip-has"><Check size={9} />{k}</span>)}
                  </div>
                </>
              )}

              {missing.length > 0 && (
                <>
                  <div className="om-lbl-row">
                    <span className="om-lbl" style={{ margin: 0 }}>Not on your resume — have you used these?</span>
                    {/* Toggles. "Add all" with no way back left a student who had
                        clicked it stuck unticking five boxes one at a time. */}
                    <button
                      className="om-addall"
                      onClick={confirmedList.length ? () => setChecked({}) : addAll}
                    >
                      <CheckCheck size={11} />{confirmedList.length ? 'Clear all' : 'Add all'}
                    </button>
                  </div>
                  {missing.map(skill => (
                    <div key={skill} className={`om-gap ${checked[skill] ? 'on' : ''}`} onClick={() => toggle(skill)}>
                      <span className="om-gap-bx">{checked[skill] && <Check size={9} />}</span>
                      <span className="om-gap-nm">{skill}</span>
                      <span className="om-gap-as">{checked[skill] ? "I've used this" : 'Tap if you have'}</span>
                    </div>
                  ))}

                  {dropped.length > 0 && (
                    <div className="om-junk">
                      <span className="om-junk-t">{dropped.join(', ')}</span> — job-ad phrases, not skills. Never offered.
                    </div>
                  )}

                  {stillGap.length > 0 && (
                    <div className="om-prep">
                      <div className="om-prep-h"><BookOpen size={12} />Skills to learn before this one</div>
                      <div className="om-prep-p">
                        <b>{stillGap.join(', ')}</b> {stillGap.length === 1 ? 'is' : 'are'} in this posting but not your resume. Leave them unticked if you haven't used them — we won't claim skills you don't have.
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="om-foot">
              <button className="om-cta" onClick={rewrite}>
                {confirmedList.length
                  ? <>Add {confirmedList.length} skill{confirmedList.length === 1 ? '' : 's'} and rewrite<ArrowRight size={14} /></>
                  : <>Optimize my resume<ArrowRight size={14} /></>}
              </button>
            </div>
          </>
        )}

        {phase === 'rewriting' && (
          <div className="om-load">
            <div className="om-spin" />
            <div className="om-load-t">Rewriting your resume…</div>
            <div className="om-load-s">Working {confirmedList.length || 'the'} skill{confirmedList.length === 1 ? '' : 's'} into your experience.</div>
          </div>
        )}

        {phase === 'result' && (
          <>
            {/* Score and every action in one row. These used to sit at the bottom of
                a scrolling rail, so the buttons that finish the job were invisible
                until you scrolled — on the screen whose whole purpose is finishing. */}
            <div className="om-actionbar">
              {/* The only way back to the checkboxes. Without it, a student who ticked a
                  skill they cannot defend had to close the modal and start over, or hand-
                  delete the word while the rail still claimed it was added. */}
              <button className="om-dl" onClick={backToSkills}>
                <ArrowLeft size={13} />Edit skills
              </button>
              <div className="om-ringrow">
                <div className="om-ring" style={{ background: `conic-gradient(#059669 ${scoreAfter}%, #E5E7EB 0)` }}>
                  <div>{scoreAfter}</div>
                </div>
                <div>
                  <div className="om-ring-l">ATS coverage</div>
                  {scoreAfter > scoreBefore && (
                    <div className="om-ring-d">+{scoreAfter - scoreBefore} from {scoreBefore}</div>
                  )}
                </div>
              </div>
              <div className="om-actionbar-sp" />
              {/* Word / PDF download whichever tab is showing: the resume, or the cover
                  letter as a proper letter document. */}
              <button className="om-dl" onClick={() => handleDownload('word')} disabled={!!dlLoading || (tab === 'letter' && letterState !== 'ready')}>
                <FileText size={13} />{dlLoading === 'word' ? '…' : 'Word'}
              </button>
              <button className="om-dl" onClick={() => handleDownload('pdf')} disabled={!!dlLoading || (tab === 'letter' && letterState !== 'ready')}>
                <Download size={13} />{dlLoading === 'pdf' ? '…' : 'PDF'}
              </button>
              <a
                className="om-apply"
                href={job.applyUrl}
                target="_blank"
                rel="noreferrer"
                onClick={trackApplication}
              >
                <ExternalLink size={13} />Apply to this job
              </a>
            </div>

            <div className="om-tabs">
              <button className={`om-tab ${tab === 'resume' ? 'on' : ''}`} onClick={() => setTab('resume')}><FileText size={12} />Optimized resume</button>
              <button className={`om-tab ${tab === 'letter' ? 'on' : ''}`} onClick={openLetter}><PenLine size={12} />Cover letter</button>
            </div>

            <div className="om-split">
              <div className="om-pane">
                {tab === 'resume' ? (
                  <div className="om-paper">
                    <div className="om-paper-h">
                      <span>Click anywhere to edit</span>
                      <span>{DOC_FONT}</span>
                    </div>
                    {/* contentEditable and NOT bound to state: binding it would re-render
                        on every keystroke and throw the caret to the start. Keyed on
                        docVersion so a ✕ or ↩ remounts the sheet instead of reconciling
                        React children into DOM the student may have edited. */}
                    <pre
                      key={docVersion}
                      ref={docRef}
                      className="om-resume"
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                    >
                      <ResumeView text={optimized} skills={added} originalText={resumeText} />
                    </pre>
                  </div>
                ) : (
                  <div className="om-paper">
                    <div className="om-paper-h">
                      <span>{letterState === 'ready' ? 'Click anywhere to edit' : 'Cover letter'}</span>
                      <span>{DOC_FONT}</span>
                    </div>
                    {letterState === 'loading' && (
                      <div className="om-load" style={{ padding: '36px 0' }}>
                        <div className="om-spin" />
                        <div className="om-load-t">Writing your cover letter…</div>
                        <div className="om-load-s">From your resume's facts and the skills you tapped. Nothing else.</div>
                      </div>
                    )}
                    {letterState === 'error' && (
                      <div className="om-load" style={{ padding: '36px 0' }}>
                        <AlertCircle size={22} color="#DC2626" />
                        <div className="om-load-t" style={{ marginTop: 8 }}>Couldn't write the letter</div>
                        <button className="om-closed-btn" onClick={() => { setLetterState('idle'); openLetter() }}>Try again</button>
                      </div>
                    )}
                    {letterState === 'ready' && (
                      <pre
                        ref={letterRef}
                        className="om-resume om-letter"
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                      >{letter}</pre>
                    )}
                  </div>
                )}
              </div>

              <div className="om-rail">
                {tab === 'letter' ? (
                  <>
                    <div className="om-rail-lbl">Cover letter</div>
                    <div className="om-feedback">
                      <b>✍ Built only from your resume's facts</b> and the skills you tapped. No invented projects, no fake passion for the company. Click anywhere to edit before you paste it.
                    </div>
                    {letterState === 'ready' && (
                      <button className="om-dl" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={copyLetter}>
                        <Copy size={13} />{copied ? 'Copied' : 'Copy letter'}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {placements.length > 0 ? (
                      <>
                        <div className="om-rail-lbl">{placements.length} skill{placements.length === 1 ? '' : 's'} woven in</div>
                        <div className="om-rail-hint">Each card says exactly <b>where</b> a skill went. Wrong place? <b>✕</b> pulls it back to your Skills section.</div>
                        {placements.map(p => {
                          const isRemoved = removed[p.skill] !== undefined
                          const skillsOnly = !p.removable || isRemoved
                          return (
                            <div key={p.skill} className={`om-wov ${skillsOnly ? 'skillonly' : ''}`}>
                              <div className="om-wov-r1">
                                <span className="om-added-pill">{p.skill}</span>
                                {p.removable && (isRemoved
                                  ? <button className="om-wov-x undo" title="Put it back" onClick={() => undoPlacement(p)}><Undo2 size={11} />Undo</button>
                                  : <button className="om-wov-x" title="I didn't use this there — remove" onClick={() => removePlacement(p)}><X size={11} /></button>)}
                              </div>
                              <div className="om-wov-w">
                                {skillsOnly
                                  ? (isRemoved ? <>→ Skills section only — removed from {p.employer || 'that bullet'}</> : <>→ Skills section only</>)
                                  : <>→ Skills section <b>+ your {p.employer || 'experience'} bullet</b></>}
                              </div>
                              {!skillsOnly && p.fragment && <div className="om-wov-f">"{p.fragment}"</div>}
                            </div>
                          )
                        })}
                      </>
                    ) : added.length > 0 && (
                      <>
                        <div className="om-rail-lbl">{added.length} skill{added.length === 1 ? '' : 's'} woven in</div>
                        <div className="om-added-pills">
                          {added.map(sk => <span key={sk} className="om-added-pill">{sk}</span>)}
                        </div>
                      </>
                    )}
                    {feedback && (
                      <>
                        <div className="om-rail-lbl" style={{ marginTop: 16 }}>Where they went</div>
                        <div className="om-feedback">{feedback}</div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const CSS = `
.om-overlay { position: fixed; inset: 0; background: rgba(10,10,11,.5); z-index: 1000;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  font-family: 'Space Grotesk', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased; }
.om-overlay * { box-sizing: border-box; }
.om-modal { background: #fff; border-radius: 22px; width: 100%; max-width: var(--om-w, 760px);
  max-height: 92vh; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 68px rgba(0,0,0,.28); }
/* The result screen is a document viewer, not a form: it takes the screen. Fixed
   height so the paper gets the whole column instead of stopping at its content. */
.om-modal-result { height: 94vh; max-height: 94vh; }
.om-modal-result .om-rail { width: 300px; }
.om-modal-result .om-pane { padding: 24px 28px; }
.om-modal-result .om-resume { font-size: 12.5px; line-height: 1.6; }

.om-head { padding: 18px 22px; display: flex; align-items: flex-start;
  justify-content: space-between; gap: 12px; border-bottom: 1px solid #F3F4F6; flex-shrink: 0; }
.om-eyebrow { font-size: 10px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; }
.om-job { font-size: 15px; font-weight: 700; letter-spacing: -.015em; color: #0A0A0B; line-height: 1.2; }
.om-co { font-size: 12px; color: #6B7280; margin-top: 2px; }
.om-x { width: 28px; height: 28px; border-radius: 50%; border: 1px solid #E5E7EB;
  background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #6B7280; flex-shrink: 0; }
.om-x:hover { background: #F9FAFB; }

.om-body { padding: 20px 28px; overflow-y: auto; }
.om-foot { padding: 15px 22px; border-top: 1px solid #F3F4F6; flex-shrink: 0; }
.om-foot-result { display: flex; gap: 8px; align-items: center; }

.om-load { padding: 48px 22px; text-align: center; display: flex; flex-direction: column; align-items: center; }
.om-spin { width: 30px; height: 30px; border: 3px solid #E5E7EB; border-top-color: #2563EB;
  border-radius: 50%; animation: om-spin .7s linear infinite; margin-bottom: 14px; }
@keyframes om-spin { to { transform: rotate(360deg); } }
.om-load-t { font-size: 14px; font-weight: 700; color: #0A0A0B; margin-bottom: 4px; }
.om-load-s { font-size: 12.5px; color: #6B7280; line-height: 1.5; max-width: 32ch; }

.om-score { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.om-score-n { font-size: 46px; font-weight: 800; letter-spacing: -.045em; line-height: .85; font-variant-numeric: tabular-nums; }
.om-score-r { flex: 1; }
.om-score-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.om-score-v { font-size: 13.5px; font-weight: 700; }
.om-score-dl { font-size: 11px; font-weight: 800; color: #059669; background: #ECFDF5;
  border: 1px solid #A7F3D0; padding: 2px 8px; border-radius: 100px; display: inline-flex; align-items: center; gap: 2px; }
.om-score-track { height: 6px; background: #EEF2F6; border-radius: 100px; overflow: hidden; }
.om-score-fill { height: 100%; border-radius: 100px; transition: width .3s ease; }

.om-lbl { font-size: 10px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 9px; }
.om-lbl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.om-addall { background: #EFF6FF; color: #2563EB; border: 1px solid #DBEAFE; padding: 4px 10px;
  border-radius: 100px; font-size: 10.5px; font-weight: 700; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.om-addall:disabled { opacity: .4; cursor: default; }

.om-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 18px; }
.om-chip { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 100px; display: inline-flex; align-items: center; gap: 4px; }
.om-chip-has { background: #D1FAE5; color: #047857; }

.om-gap { border: 1px solid #E5E7EB; border-radius: 9px; margin-bottom: 6px; display: flex;
  align-items: center; gap: 9px; padding: 10px 12px; cursor: pointer; transition: all .15s; }
.om-gap:hover { border-color: #C7D9FB; }
.om-gap.on { border-color: #A7F3D0; background: #F7FEFB; }
.om-gap-bx { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid #CBD5E1;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; transition: all .15s; }
.om-gap.on .om-gap-bx { background: #059669; border-color: #059669; }
.om-gap-nm { font-size: 12.5px; font-weight: 600; flex: 1; color: #0A0A0B; }
.om-gap.on .om-gap-nm { color: #047857; }
.om-gap-as { font-size: 10.5px; color: #6B7280; font-weight: 500; }
.om-gap.on .om-gap-as { color: #059669; font-weight: 700; }

.om-prep { background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 9px; padding: 12px 13px; margin-top: 14px; }
.om-prep-h { font-size: 11px; font-weight: 700; color: #92400E; display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.om-prep-p { font-size: 11.5px; color: #92400E; line-height: 1.55; }
.om-prep-p b { color: #78350F; }

.om-added { display: flex; align-items: center; gap: 7px; background: #F0FDF9; border: 1px solid #A7F3D0;
  border-radius: 9px; padding: 10px 13px; font-size: 12px; color: #065F46; }
.om-added b { color: #064E3B; font-weight: 700; }

.om-resume-wrap { border: 1px solid #E5E7EB; border-radius: 10px; background: #F8FAFC; max-height: 260px; overflow-y: auto; }
.om-resume { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; line-height: 1.7;
  color: #374151; padding: 14px 15px; margin: 0; white-space: pre-wrap; word-wrap: break-word; }
.om-mark { background: #D1FAE5; color: #047857; font-weight: 700; padding: 0 3px; border-radius: 3px; }
/* Decision (2026-08-30): one colour. Green marks every change the optimizer made,
   whether or not the student ticked it. The two-colour version was built and rejected:
   amber fired on ordinary rewording ("throughout", "spearheaded"), which would have lit
   up half the page and trained students to ignore the colour entirely. Cost of the
   single colour: the page shows WHAT changed but not WHO vouched for it. Accepted. */
.om-mark-new { background: #D1FAE5; color: #047857; font-weight: 700; padding: 0 3px; border-radius: 3px; }

.om-feedback { font-size: 12px; color: #6B7280; line-height: 1.55; margin-top: 12px;
  padding: 11px 13px; background: #F9FAFB; border-radius: 8px; border: 1px solid #F3F4F6; }

/* ── result screen: tabs + split (preview left, controls right) ── */
.om-closed-btn { margin-top: 16px; background: #fff; border: 1.5px solid #DCDCE0; border-radius: 10px;
  padding: 9px 20px; font-size: 13px; font-weight: 600; color: #0A0A0B; cursor: pointer; font-family: inherit; }
.om-closed-btn:hover { background: #F7F7F8; }

/* Action bar: score plus every button, above the fold and never scrolled past. */

.om-actionbar-sp { flex: 1; }
/* The ring is 68px because it was designed for a vertical rail. In a horizontal bar
   that height forces the buttons onto a second line, so it is scaled down here rather
   than changed globally. No wrapping: these four items must stay on one row. */
/* One rule, no duplicate. An earlier version declared flex-wrap twice and the buttons
   still dropped to a second line, so everything lives here now.
   The ring is 68px by default because it was drawn for a vertical rail; at that height
   it forces a wrap in a horizontal bar, so it is scaled down within this bar only. */
.om-actionbar { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px;
  padding: 10px 18px; border-bottom: 1px solid #F1EDE7; background: #fff;
  flex-shrink: 0; overflow-x: auto; }
.om-actionbar .om-ringrow { margin: 0; gap: 10px; }
.om-actionbar .om-ring { width: 42px; height: 42px; }
.om-actionbar .om-ring > div { width: 32px; height: 32px; font-size: 13px; }
.om-actionbar .om-ring-l { font-size: 11.5px; }
.om-actionbar .om-ring-d { font-size: 11px; }
.om-actionbar .om-dl, .om-actionbar .om-apply { flex: none; white-space: nowrap; }

/* The document sits on a white sheet over grey — it is a page you are about to send,
   not a text box in an app. */
.om-paper-h { display: flex; justify-content: space-between; gap: 8px; padding: 8px 24px;
  margin: -22px -24px 16px; border-bottom: 1px solid #F1EDE7; font-size: 10px;
  color: #A1A1A6; font-family: 'Space Grotesk', sans-serif; }
.om-added-pills { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
.om-added-pill { font-size: 11px; background: #D1FAE5; color: #065F46; padding: 4px 9px;
  border-radius: 6px; font-weight: 650; }

.om-split { display: flex; min-height: 0; flex: 1; }
.om-pane { flex: 1; min-width: 0; background: #F1F3F7; padding: 20px; overflow-y: auto; }
.om-paper { background: #fff; border: 0; border-radius: 8px; padding: 22px 24px;
  box-shadow: 0 4px 20px rgba(15,23,42,.13);
  box-shadow: 0 6px 22px rgba(15,23,42,.06); }
.om-paper .om-resume { font-family: 'Times New Roman', Times, serif; font-size: 12.5px;
  line-height: 1.55; color: #111; outline: 0; caret-color: #2563EB;
  background: none; border: none; padding: 0; white-space: pre-wrap; word-break: break-word; }

.om-rail { width: 252px; flex-shrink: 0; padding: 20px; border-left: 1px solid #F1EDE7; overflow-y: auto; }
.om-ringrow { display: flex; align-items: center; gap: 13px; }
.om-ring { width: 68px; height: 68px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.om-ring > div { width: 52px; height: 52px; border-radius: 50%; background: #fff; display: flex; align-items: center;
  justify-content: center; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
.om-ring-l { font-size: 12px; font-weight: 700; color: #0A0A0B; }
.om-ring-d { font-size: 11.5px; color: #059669; font-weight: 700; margin-top: 1px; }
.om-rail-lbl { font-size: 10px; font-weight: 800; color: #A1A1A6; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }

/* ── A5: rubric rows, projection note, junk line, placement cards, tabs, letter ── */
.om-rub { margin: -6px 0 18px; border: 1px solid #F1EDE7; border-radius: 10px; padding: 12px 13px 4px; }
.om-rub .om-lbl { margin-bottom: 6px; }
.om-rub-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  padding: 7px 0; border-top: 1px solid #F3F4F6; }
.om-rub-row:first-of-type { border-top: 0; }
.om-rub-n { font-size: 12px; font-weight: 700; color: #0A0A0B; }
.om-rub-d { font-size: 10.5px; color: #6B7280; line-height: 1.45; margin-top: 1px; }
.om-rub-p { font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap;
  color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; padding: 2px 8px; border-radius: 100px; }
.om-rub-p.full { color: #047857; background: #ECFDF5; border-color: #A7F3D0; }
.om-rub-p.zero { color: #991B1B; background: #FEF2F2; border-color: #FECACA; }
.om-proj { font-size: 11.5px; color: #6B7280; line-height: 1.5; margin: -8px 0 16px; padding: 9px 12px;
  background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 8px; }
.om-proj b { color: #0A0A0B; }
.om-proj.max { background: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
.om-proj.max b { color: #047857; }
.om-junk { font-size: 11px; color: #9CA3AF; line-height: 1.5; margin: 4px 0 2px; padding: 0 2px; }
.om-junk-t { color: #6B7280; text-decoration: line-through; }
.om-tabs { display: flex; gap: 4px; padding: 8px 18px 0; border-bottom: 1px solid #F1EDE7; background: #fff; flex-shrink: 0; }
.om-tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px 9px; font-size: 12.5px; font-weight: 700;
  color: #6B7280; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; margin-bottom: -1px; }
.om-tab.on { color: #2563EB; border-bottom-color: #2563EB; }
.om-tab:hover { color: #0A0A0B; }
.om-rail-hint { font-size: 11px; color: #6B7280; line-height: 1.5; margin-bottom: 10px; }
.om-rail-hint b { color: #0A0A0B; }
.om-wov { border: 1px solid #A7F3D0; background: #F7FEFB; border-radius: 9px; padding: 9px 10px; margin-bottom: 7px; }
.om-wov.skillonly { border-color: #E5E7EB; background: #F9FAFB; }
.om-wov-r1 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.om-wov-x { border: 1px solid #E5E7EB; background: #fff; color: #6B7280; border-radius: 6px; width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-family: inherit; font-size: 10.5px; font-weight: 700; }
.om-wov-x:hover { border-color: #DC2626; color: #DC2626; }
.om-wov-x.undo { width: auto; padding: 0 8px; gap: 4px; color: #2563EB; border-color: #DBEAFE; }
.om-wov-x.undo:hover { background: #EFF6FF; }
.om-wov-w { font-size: 11px; color: #6B7280; margin-top: 6px; line-height: 1.45; }
.om-wov-w b { color: #047857; }
.om-wov-f { font-size: 10.5px; color: #374151; font-style: italic; margin-top: 4px; line-height: 1.4; }
.om-paper .om-letter { font-size: 12.5px; line-height: 1.6; }

@media (max-width: 720px) {
  .om-split { flex-direction: column; }
  .om-rail { width: 100%; border-left: none; border-top: 1px solid #F1EDE7; }
  .om-modal-result { height: auto; }
  .om-modal-result .om-rail { width: 100%; }
  .om-modal-result .om-pane { padding: 16px; }
}

.om-cta { width: 100%; background: #2563EB; color: #fff; border: none; padding: 12px; border-radius: 10px;
  font-size: 13.5px; font-weight: 700; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.om-cta:hover { background: #1D4ED8; }

.om-dl { border: 1px solid #E5E7EB; background: #fff; border-radius: 9px; padding: 10px 15px;
  font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; color: #0A0A0B;
  display: inline-flex; align-items: center; gap: 6px; }
.om-dl:hover:not(:disabled) { border-color: #2563EB; color: #2563EB; }
.om-dl:disabled { opacity: .6; cursor: default; }
.om-apply { justify-content: center; background: #2563EB; color: #fff; text-decoration: none; padding: 11px 18px;
  border-radius: 9px; font-size: 12.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.om-apply:hover { background: #1D4ED8; }
`

