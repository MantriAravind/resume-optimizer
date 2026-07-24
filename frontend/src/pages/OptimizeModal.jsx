import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  X, Check, CheckCheck, ArrowRight, ArrowUp, Download, FileText,
  ExternalLink, Sparkles, BookOpen, AlertCircle, Mail, Ban,
} from 'lucide-react'

// Read from the environment so the backend can move without editing four files.
// The fallback is the current production URL, so a missing variable degrades to
// today's behaviour instead of silently pointing the app at nothing.
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'

// Web-safe only. Trendy fonts silently fall back inside PDFShift, so we don't offer them.
const FONTS = [
  { id: 'Calibri',         label: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', sans-serif", note: 'Default' },
  { id: 'Arial',           label: 'Arial',   css: 'Arial, Helvetica, sans-serif' },
  { id: 'Georgia',         label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { id: 'Times New Roman', label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
]

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
    return () => clearInterval(t)
  }, [before, after, animate])
  const color = shown >= 80 ? '#059669' : shown >= 60 ? '#D97706' : '#DC2626'
  const verdict = shown >= 80 ? 'Strong match.' : shown >= 60 ? 'Decent match.' : 'Weak match.'
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

// render resume text with the added skills highlighted once each
function ResumeView({ text, skills }) {
  if (!skills?.length) return <pre className="om-resume">{text}</pre>
  const ordered = [...skills].sort((a, b) => b.length - a.length)
  const seen = new Set()
  // build a regex that matches any skill, longest first
  const escaped = ordered.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const nodes = []
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    const matched = m[0]
    const key = matched.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(<mark key={m.index} className="om-mark">{matched}</mark>)
    last = m.index + matched.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <pre className="om-resume">{nodes}</pre>
}

export default function OptimizeModal({ job, onClose }) {
  const { getToken } = useAuth()

  const [phase, setPhase]   = useState('loading') // loading | pick | rewriting | result | error
  const [error, setError]   = useState('')

  const [resumeText, setResumeText] = useState('')
  const [jobText, setJobText]       = useState('')

  const [matched, setMatched]   = useState([])
  const [missing, setMissing]   = useState([])
  const [scoreBefore, setScoreBefore] = useState(0)

  const [checked, setChecked]   = useState({})

  const [optimized, setOptimized]   = useState('')
  const [added, setAdded]           = useState([])
  const [scoreAfter, setScoreAfter] = useState(0)
  const [feedback, setFeedback]     = useState('')

  const [font, setFont]     = useState('Calibri')
  const [length, setLength] = useState('standard')
  const [tab, setTab]       = useState('resume')
  const [dlLoading, setDlLoading] = useState('')

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
          body: JSON.stringify({ resumeText: resume, jobText: jd }),
        })
        if (!aRes.ok) throw new Error('analyze failed')
        const a = await aRes.json()
        if (cancelled) return

        setMatched(a.matchedKeywords || [])
        setMissing(a.missingKeywords || [])
        setScoreBefore(a.scoreBefore || 0)
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
  const liveScore = total ? Math.round(((matched.length + confirmedList.length) / total) * 100) : 0
  const stillGap = missing.filter(k => !checked[k])

  function toggle(skill) {
    setChecked(c => ({ ...c, [skill]: !c[skill] }))
  }
  function addAll() {
    setChecked(Object.fromEntries(missing.map(k => [k, true])))
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
        }),
      })
      if (!res.ok) throw new Error('optimize failed')
      const d = await res.json()
      setOptimized(d.optimizedResume || '')
      setAdded(d.addedKeywords || [])
      setScoreAfter(d.scoreAfter ?? liveScore)
      setFeedback(d.feedback || '')
      setPhase('result')
    } catch {
      setError('generic')
      setPhase('error')
    }
  }

  // ── step 3: download (same endpoints + payload as the Resume Tool)
  async function handleDownload(type) {
    if (!optimized) return
    setDlLoading(type)
    try {
      const res = await fetch(`${BACKEND}/download-${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: optimized, font, length }),
      })
      if (!res.ok) { alert('Download failed. Please try again.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = type === 'pdf' ? 'optimized-resume.pdf' : 'optimized-resume.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed. Please try again.')
    } finally {
      setDlLoading('')
    }
  }

  return (
    <div className="om-overlay" onClick={onClose}>
      <style>{CSS}</style>
      <div className="om-modal" style={{ '--om-w': phase === 'result' ? '860px' : '520px' }} onClick={e => e.stopPropagation()}>
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
                    <button className="om-addall" onClick={addAll} disabled={confirmedList.length === missing.length}>
                      <CheckCheck size={11} />Add all
                    </button>
                  </div>
                  {missing.map(skill => (
                    <div key={skill} className={`om-gap ${checked[skill] ? 'on' : ''}`} onClick={() => toggle(skill)}>
                      <span className="om-gap-bx">{checked[skill] && <Check size={9} />}</span>
                      <span className="om-gap-nm">{skill}</span>
                      <span className="om-gap-as">{checked[skill] ? "I've used this" : 'Tap if you have'}</span>
                    </div>
                  ))}

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
            <div className="om-tabbar">
              <button className={`om-tab ${tab === 'resume' ? 'on' : ''}`} onClick={() => setTab('resume')}>
                <FileText size={13} />Resume
              </button>
              <button className="om-tab om-tab-soon" disabled title="Cover letters are coming soon">
                <Mail size={13} />Cover letter<span className="om-soon">Soon</span>
              </button>
            </div>

            <div className="om-split">
              <div className="om-pane">
                <div className="om-paper" style={{ fontFamily: FONTS.find(f => f.id === font)?.css }}>
                  <ResumeView text={optimized} skills={added} />
                </div>
              </div>

              <div className="om-rail">
                <div className="om-ringrow">
                  <div className="om-ring" style={{ background: `conic-gradient(#2563EB ${scoreAfter}%, #EEF0F2 0)` }}>
                    <div>{scoreAfter}</div>
                  </div>
                  <div>
                    <div className="om-ring-l">ATS coverage</div>
                    {scoreAfter > scoreBefore && (
                      <div className="om-ring-d">+{scoreAfter - scoreBefore} from {scoreBefore}</div>
                    )}
                  </div>
                </div>

                {added.length > 0 && (
                  <div className="om-added-line">
                    {added.length} skill{added.length === 1 ? '' : 's'} woven into your real experience: <b>{added.join(', ')}</b>
                  </div>
                )}

                {feedback && <div className="om-feedback">{feedback}</div>}

                <div className="om-sep" />

                <div className="om-rail-lbl">Font</div>
                <div className="om-fonts">
                  {FONTS.map(f => (
                    <button
                      key={f.id}
                      className={`om-font ${font === f.id ? 'on' : ''}`}
                      onClick={() => setFont(f.id)}
                    >
                      <span className="om-font-nm" style={{ fontFamily: f.css }}>{f.label}</span>
                      {font === f.id && <Check size={14} color="#2563EB" />}
                    </button>
                  ))}
                </div>

                <div className="om-rail-lbl" style={{ marginTop: 16 }}>Length</div>
                <div className="om-seg">
                  <button className={length === 'concise' ? 'on' : ''} onClick={() => setLength('concise')}>Concise</button>
                  <button className={length === 'standard' ? 'on' : ''} onClick={() => setLength('standard')}>Standard</button>
                </div>

                <div className="om-acts">
                  <a className="om-apply" href={job.applyUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} />Apply
                  </a>
                  <div className="om-dl-row">
                    <button className="om-dl" onClick={() => handleDownload('word')} disabled={!!dlLoading}>
                      <FileText size={13} />{dlLoading === 'word' ? '…' : 'Word'}
                    </button>
                    <button className="om-dl" onClick={() => handleDownload('pdf')} disabled={!!dlLoading}>
                      <Download size={13} />{dlLoading === 'pdf' ? '…' : 'PDF'}
                    </button>
                  </div>
                </div>
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
.om-modal { background: #fff; border-radius: 22px; width: 100%; max-width: var(--om-w, 520px);
  max-height: 90vh; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 68px rgba(0,0,0,.28); }

.om-head { padding: 18px 22px; display: flex; align-items: flex-start;
  justify-content: space-between; gap: 12px; border-bottom: 1px solid #F3F4F6; flex-shrink: 0; }
.om-eyebrow { font-size: 10px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 3px; }
.om-job { font-size: 15px; font-weight: 700; letter-spacing: -.015em; color: #0A0A0B; line-height: 1.2; }
.om-co { font-size: 12px; color: #6B7280; margin-top: 2px; }
.om-x { width: 28px; height: 28px; border-radius: 50%; border: 1px solid #E5E7EB;
  background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #6B7280; flex-shrink: 0; }
.om-x:hover { background: #F9FAFB; }

.om-body { padding: 20px 22px; overflow-y: auto; }
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

.om-feedback { font-size: 12px; color: #6B7280; line-height: 1.55; margin-top: 12px;
  padding: 11px 13px; background: #F9FAFB; border-radius: 8px; border: 1px solid #F3F4F6; }

/* ── result screen: tabs + split (preview left, controls right) ── */
.om-closed-btn { margin-top: 16px; background: #fff; border: 1.5px solid #DCDCE0; border-radius: 10px;
  padding: 9px 20px; font-size: 13px; font-weight: 600; color: #0A0A0B; cursor: pointer; font-family: inherit; }
.om-closed-btn:hover { background: #F7F7F8; }

.om-tabbar { display: flex; gap: 3px; padding: 12px 20px; border-bottom: 1px solid #F1EDE7; background: #fff; flex-shrink: 0; }
.om-tab { display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent; cursor: pointer;
  padding: 8px 15px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #6B7280; font-family: inherit; }
.om-tab.on { background: #F2EEE8; color: #0A0A0B; }
.om-tab-soon { cursor: not-allowed; opacity: .55; }
.om-soon { font-size: 8.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  background: #E5E7EB; color: #6B7280; padding: 2px 6px; border-radius: 20px; margin-left: 3px; }

.om-split { display: flex; min-height: 0; flex: 1; }
.om-pane { flex: 1; min-width: 0; background: #FAF8F5; padding: 18px; overflow-y: auto; }
.om-paper { background: #fff; border: 1px solid #ECE8E2; border-radius: 11px; padding: 22px 24px;
  box-shadow: 0 6px 22px rgba(15,23,42,.06); }
.om-paper .om-resume { font-family: inherit; font-size: 11.5px; line-height: 1.62; color: #3A3A3C;
  background: none; border: none; padding: 0; white-space: pre-wrap; word-break: break-word; }

.om-rail { width: 252px; flex-shrink: 0; padding: 20px; border-left: 1px solid #F1EDE7; overflow-y: auto; }
.om-ringrow { display: flex; align-items: center; gap: 13px; }
.om-ring { width: 68px; height: 68px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.om-ring > div { width: 52px; height: 52px; border-radius: 50%; background: #fff; display: flex; align-items: center;
  justify-content: center; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
.om-ring-l { font-size: 12px; font-weight: 700; color: #0A0A0B; }
.om-ring-d { font-size: 11.5px; color: #059669; font-weight: 700; margin-top: 1px; }
.om-added-line { font-size: 11.5px; color: #6B7280; line-height: 1.5; margin-top: 11px; }
.om-added-line b { color: #047857; font-weight: 700; }
.om-sep { height: 1px; background: #F1EDE7; margin: 16px 0; }
.om-rail-lbl { font-size: 10px; font-weight: 800; color: #A1A1A6; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }

.om-fonts { display: flex; flex-direction: column; gap: 6px; }
.om-font { display: flex; align-items: center; justify-content: space-between; cursor: pointer; background: #fff;
  border: 1.5px solid #ECE8E2; border-radius: 10px; padding: 9px 12px; font-family: inherit; transition: border-color .12s; }
.om-font:hover { border-color: #D9D3C9; }
.om-font.on { border-color: #2563EB; background: #FBF6EF; }
.om-font-nm { font-size: 13px; color: #0A0A0B; }

.om-seg { display: flex; background: #F2EEE8; border-radius: 10px; padding: 4px; gap: 3px; }
.om-seg button { flex: 1; border: none; background: transparent; cursor: pointer; padding: 7px 4px; border-radius: 7px;
  font-size: 11.5px; color: #3A3A3C; font-family: inherit; transition: all .14s; }
.om-seg button.on { background: #fff; color: #0A0A0B; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,.08); }

.om-acts { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }
.om-dl-row { display: flex; gap: 8px; }
.om-dl-row .om-dl { flex: 1; justify-content: center; }

@media (max-width: 720px) {
  .om-split { flex-direction: column; }
  .om-rail { width: 100%; border-left: none; border-top: 1px solid #F1EDE7; }
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
