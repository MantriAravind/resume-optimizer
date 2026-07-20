import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import {
  X, Check, CheckCheck, ArrowRight, ArrowUp, Download, FileText,
  ExternalLink, Sparkles, BookOpen, AlertCircle,
} from 'lucide-react'

const BACKEND = 'https://resume-optimizer-cuii.onrender.com'

const TEMPLATES = [
  { id: 'google',   label: 'Search Giant',    accent: '#4285F4' },
  { id: 'amazon',   label: 'Everything Store', accent: '#FF9900' },
  { id: 'apple',    label: 'Cupertino',        accent: '#1d1d1f' },
  { id: 'mckinsey', label: 'The Firm',         accent: '#003A70' },
  { id: 'netflix',  label: 'Streaming Co',     accent: '#E50914' },
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

  const [template, setTemplate] = useState('google')
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
        body: JSON.stringify({ resumeText: optimized, template, length: 'standard' }),
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
      <div className="om-modal" onClick={e => e.stopPropagation()}>
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
            <AlertCircle size={26} color="#DC2626" />
            {error === 'no-resume' ? (
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
            <div className="om-body">
              <ScoreBar before={scoreBefore} after={scoreAfter} animate={true} />

              {added.length > 0 && (
                <div className="om-added">
                  <Check size={12} color="#047857" />
                  <span>Added to your resume: <b>{added.join(', ')}</b></span>
                </div>
              )}

              <div className="om-lbl" style={{ marginTop: 14 }}>Your rewritten resume</div>
              <div className="om-resume-wrap">
                <ResumeView text={optimized} skills={added} />
              </div>

              {feedback && <div className="om-feedback">{feedback}</div>}

              <div className="om-lbl" style={{ marginTop: 16 }}>Choose a template</div>
              <div className="om-tpls">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    className={`om-tpl ${template === t.id ? 'on' : ''}`}
                    onClick={() => setTemplate(t.id)}
                  >
                    <div className="om-tpl-top" style={{ background: template === t.id ? t.accent : '#F1F5F9' }} />
                    <div className="om-tpl-in">
                      <div className="om-tpl-l" style={{ width: '70%' }} />
                      <div className="om-tpl-l" style={{ width: '90%' }} />
                      <div className="om-tpl-l" style={{ width: '50%' }} />
                    </div>
                    <div className="om-tpl-nm">{t.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="om-foot om-foot-result">
              <button className="om-dl" onClick={() => handleDownload('word')} disabled={!!dlLoading}>
                <FileText size={13} />{dlLoading === 'word' ? 'Preparing…' : 'Word'}
              </button>
              <button className="om-dl" onClick={() => handleDownload('pdf')} disabled={!!dlLoading}>
                <Download size={13} />{dlLoading === 'pdf' ? 'Preparing…' : 'PDF'}
              </button>
              <a className="om-apply" href={job.applyUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />Apply
              </a>
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
.om-modal { background: #fff; border-radius: 18px; width: 100%; max-width: 520px;
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

.om-tpls { display: flex; gap: 7px; }
.om-tpl { flex: 1; cursor: pointer; border: none; background: none; padding: 0; font-family: inherit; }
.om-tpl-top { height: 13px; border-radius: 6px 6px 0 0; transition: background .15s; }
.om-tpl-in { border: 1.5px solid #E5E7EB; border-top: none; border-radius: 0 0 6px 6px; padding: 5px 6px 6px; transition: border-color .15s; }
.om-tpl.on .om-tpl-in { border-color: #2563EB; }
.om-tpl.on .om-tpl-top { box-shadow: 0 0 0 1.5px #2563EB; }
.om-tpl-l { height: 2.5px; border-radius: 1px; background: #E5E7EB; margin-bottom: 2.5px; }
.om-tpl-nm { font-size: 8.5px; font-weight: 700; color: #94A3B8; margin-top: 5px; text-align: center; }
.om-tpl.on .om-tpl-nm { color: #2563EB; }

.om-cta { width: 100%; background: #2563EB; color: #fff; border: none; padding: 12px; border-radius: 10px;
  font-size: 13.5px; font-weight: 700; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.om-cta:hover { background: #1D4ED8; }

.om-dl { border: 1px solid #E5E7EB; background: #fff; border-radius: 9px; padding: 10px 15px;
  font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; color: #0A0A0B;
  display: inline-flex; align-items: center; gap: 6px; }
.om-dl:hover:not(:disabled) { border-color: #2563EB; color: #2563EB; }
.om-dl:disabled { opacity: .6; cursor: default; }
.om-apply { margin-left: auto; background: #2563EB; color: #fff; text-decoration: none; padding: 10px 18px;
  border-radius: 9px; font-size: 12.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.om-apply:hover { background: #1D4ED8; }
`
