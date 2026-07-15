import { useState, useRef } from 'react'
import SidebarLayout from '../components/SidebarLayout'

const BACKEND = 'https://resume-optimizer-cuii.onrender.com'

const TEMPLATES = [
  { id: 'google',   label: 'Search Giant',     inspired: 'Google',   accent: '#4285F4' },
  { id: 'amazon',   label: 'Everything Store',  inspired: 'Amazon',   accent: '#FF9900' },
  { id: 'apple',    label: 'Cupertino',         inspired: 'Apple',    accent: '#1d1d1f' },
  { id: 'mckinsey', label: 'The Firm',          inspired: 'McKinsey', accent: '#003A70' },
  { id: 'netflix',  label: 'Streaming Co',      inspired: 'Netflix',  accent: '#E50914' },
]

function ScoreRing({ score }) {
  const r = 52, circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = score >= 75 ? '#059669' : score >= 50 ? '#D97706' : '#DC2626'
  return (
    <div className="ed-ring">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="#EFEFEF" strokeWidth="9" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 66 66)"
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
      </svg>
      <div className="ed-ring-center">
        <span className="ed-ring-num">{score}</span>
        <span className="ed-ring-denom">/100</span>
      </div>
    </div>
  )
}

function Thumb({ tpl, selected, onClick }) {
  return (
    <button onClick={onClick} style={{ flexShrink: 0, width: 110, cursor: 'pointer', border: 'none', background: 'none', padding: 0, textAlign: 'center' }}>
      <div style={{
        width: 110, height: 142, borderRadius: 10, background: '#fff', overflow: 'hidden',
        border: selected ? `2.5px solid ${tpl.accent}` : '1.5px solid #E5E5EA',
        boxShadow: selected ? `0 4px 16px ${tpl.accent}33` : '0 1px 4px rgba(0,0,0,0.06)',
        transition: 'all 0.18s', position: 'relative', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ height: 28, background: selected ? tpl.accent : '#F5F5F7', flexShrink: 0 }} />
        <div style={{ padding: '8px 10px', flex: 1 }}>
          <div style={{ height: 5, borderRadius: 3, background: selected ? tpl.accent : '#E5E5EA', marginBottom: 5, width: '70%' }} />
          <div style={{ height: 3, borderRadius: 2, background: '#F0F0F2', marginBottom: 3 }} />
          <div style={{ height: 3, borderRadius: 2, background: '#F0F0F2', marginBottom: 3, width: '85%' }} />
          <div style={{ height: 3, borderRadius: 2, background: '#F0F0F2', marginBottom: 7 }} />
          <div style={{ height: 4, borderRadius: 2, background: selected ? `${tpl.accent}66` : '#E5E5EA', marginBottom: 4, width: '50%' }} />
          <div style={{ height: 2.5, borderRadius: 2, background: '#F5F5F7', marginBottom: 2.5 }} />
          <div style={{ height: 2.5, borderRadius: 2, background: '#F5F5F7', marginBottom: 2.5, width: '90%' }} />
          <div style={{ height: 2.5, borderRadius: 2, background: '#F5F5F7' }} />
        </div>
        {selected && (
          <div style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: tpl.accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>✓</div>
        )}
      </div>
      <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 700, color: selected ? '#111' : '#555' }}>{tpl.label}</div>
      <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>by {tpl.inspired}</div>
    </button>
  )
}

export default function ToolPage() {
  const [resumeText, setResumeText] = useState('')
  const [jobText, setJobText]       = useState('')
  const [result, setResult]         = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [template, setTemplate]     = useState('google')
  const [length, setLength]         = useState('standard')
  const [dlLoading, setDlLoading]   = useState('')
  const resultsRef = useRef(null)

  async function handleOptimize() {
    if (!resumeText.trim() || !jobText.trim()) {
      setError('Please fill in both your resume and the job description.')
      return
    }
    setError(''); setResult(null); setLoading(true)
    try {
      const res = await fetch(`${BACKEND}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobText })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return }
      setResult(data)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch {
      setError('Could not connect to the server. Please try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload(type) {
    if (!result?.optimizedResume) return
    setDlLoading(type)
    try {
      const res = await fetch(`${BACKEND}/download-${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: result.optimizedResume, template, length })
      })
      if (!res.ok) { alert('Download failed. Please try again.'); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = type === 'pdf' ? 'optimized-resume.pdf' : 'optimized-resume.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed. Please try again.')
    } finally {
      setDlLoading('')
    }
  }

  const activeTpl = TEMPLATES.find(t => t.id === template)
  let badgeClass = 'ed-badge-red', badgeText = 'Needs improvement'
  if (result) {
    if (result.score >= 75) { badgeClass = 'ed-badge-green'; badgeText = 'Strong match' }
    else if (result.score >= 50) { badgeClass = 'ed-badge-yellow'; badgeText = 'Moderate match' }
  }

  return (
    <SidebarLayout>
    <div className="ed-page">
      <style>{CSS}</style>

      <header className="ed-hero">
        <div className="ed-hero-pill"><span className="ed-hero-pill-dot" />Powered by AI</div>
        <h1 className="ed-hero-title">Land more interviews.</h1>
        <p className="ed-hero-sub">Match your resume to any job and beat the ATS.</p>
      </header>

      <main className="ed-main">
        <div className="ed-inputs">
          <div className="ed-field">
            <label className="ed-label">Your Resume</label>
            <textarea className="ed-textarea" placeholder="Paste your resume text here. Include work experience, skills, education, and any other relevant sections." value={resumeText} onChange={e => setResumeText(e.target.value)} />
            <span className="ed-count">{resumeText.length} characters</span>
          </div>
          <div className="ed-field">
            <label className="ed-label">Job Description</label>
            <textarea className="ed-textarea" placeholder="Paste the full job description here, including responsibilities, required skills, and qualifications." value={jobText} onChange={e => setJobText(e.target.value)} />
            <span className="ed-count">{jobText.length} characters</span>
          </div>
          {error && <div className="ed-error">{error}</div>}
          <button className="ed-btn" onClick={handleOptimize} disabled={loading}>
            {loading ? <><span className="ed-spin" />Optimizing…</> : 'Optimize Resume'}
          </button>
        </div>

        {loading && (
          <div className="ed-loading" ref={resultsRef}>
            <div className="ed-loading-spin" />
            <p className="ed-loading-title">Optimizing your resume…</p>
            <p className="ed-loading-sub">Our AI is analyzing the job description and tailoring your resume. This takes about 15–20 seconds.</p>
          </div>
        )}

        {result && !loading && (
          <section className="ed-results" ref={resultsRef}>
            <div className="ed-divider"><span>Your Results</span></div>

            <div className="ed-score-card">
              <ScoreRing score={result.score} />
              <div className="ed-score-info">
                <h3 className="ed-score-h">ATS Match Score</h3>
                <p className="ed-score-feedback">{result.feedback}</p>
                <span className={`ed-badge ${badgeClass}`}>{badgeText}</span>
              </div>
            </div>

            <div className="ed-card">
              <div className="ed-card-head">
                <div>
                  <div className="ed-card-title">Choose your template</div>
                  <div className="ed-card-sub">Each is inspired by a top company's resume style.</div>
                </div>
                <span className="ed-inspired-badge">{activeTpl.label} · by {activeTpl.inspired}</span>
              </div>
              <div className="ed-thumbs">
                {TEMPLATES.map(tpl => (
                  <Thumb key={tpl.id} tpl={tpl} selected={template === tpl.id} onClick={() => setTemplate(tpl.id)} />
                ))}
              </div>
            </div>

            <div className="ed-dl-bar">
              <div className="ed-len-wrap">
                <span className="ed-len-label">Length</span>
                <div className="ed-len-toggle">
                  <button className={`ed-len-btn ${length === 'concise' ? 'ed-len-active' : ''}`} onClick={() => setLength('concise')}>
                    <span className="ed-len-main">Concise</span>
                    <span className="ed-len-sub">1 page</span>
                  </button>
                  <button className={`ed-len-btn ${length === 'standard' ? 'ed-len-active' : ''}`} onClick={() => setLength('standard')}>
                    <span className="ed-len-main">Standard</span>
                    <span className="ed-len-sub">Full detail</span>
                  </button>
                </div>
              </div>
              <div className="ed-dl-btns">
                <button className="ed-dl-word" onClick={() => handleDownload('word')} disabled={dlLoading !== ''}>
                  {dlLoading === 'word' ? <><span className="ed-spin-dark" />Generating…</> : <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Download Word
                  </>}
                </button>
                <button className="ed-dl-pdf" onClick={() => handleDownload('pdf')} disabled={dlLoading !== ''}>
                  {dlLoading === 'pdf' ? <><span className="ed-spin" />Generating…</> : <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Download PDF
                  </>}
                </button>
              </div>
            </div>

            <div className="ed-resume-card">
              <div className="ed-resume-head">
                <h3 className="ed-resume-title">Preview</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: activeTpl.accent }} />
                  <span style={{ fontSize: 12, color: '#86868B', fontWeight: 600 }}>{activeTpl.label} · {length === 'concise' ? 'Concise' : 'Standard'}</span>
                </div>
              </div>
              <pre className="ed-resume-body">{result.optimizedResume}</pre>
            </div>
          </section>
        )}
      </main>

      <footer className="ed-footer">
        Built with AI · Powered by Claude · <a href="https://github.com/MantriAravind/resume-optimizer" target="_blank" rel="noreferrer">View on GitHub</a>
      </footer>
    </div>
    </SidebarLayout>
  )
}

const CSS = `
.ed-page { font-family: 'Inter', -apple-system, system-ui, sans-serif; background: #fff; color: #111; min-height: 100vh; padding-top: 8px; }
.ed-page * { box-sizing: border-box; }
.ed-nav { display: flex; justify-content: space-between; align-items: center; padding: 22px 48px; max-width: 1100px; margin: 0 auto; }
.ed-logo-link { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.ed-logo-mark { width: 30px; height: 30px; border-radius: 8px; background: #0071E3; color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 15px; }
.ed-logo-text { font-weight: 700; font-size: 18px; letter-spacing: -0.03em; color: #111; }
.ed-nav-right { display: flex; align-items: center; gap: 16px; }
.ed-nav-tag { font-size: 13px; color: #86868B; }
.ed-hero { text-align: center; padding: 48px 24px 36px; }
.ed-hero-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px; border-radius: 100px; background: #F0F7FF; border: 1px solid #D6E9FF; margin-bottom: 18px; font-size: 12.5px; font-weight: 600; color: #0071E3; }
.ed-hero-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: #0071E3; }
.ed-hero-title { font-size: 36px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.05; margin: 0 0 12px; color: #111; }
.ed-hero-sub { font-size: 16px; color: #6E6E73; max-width: 430px; margin: 0 auto; line-height: 1.5; }
.ed-main { max-width: 800px; margin: 0 auto; padding: 0 24px 96px; }
.ed-inputs { display: grid; gap: 28px; }
.ed-field { display: flex; flex-direction: column; }
.ed-label { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 12px; }
.ed-textarea { width: 100%; min-height: 150px; border-radius: 16px; background: #F5F5F7; border: 1px solid #F5F5F7; padding: 18px; font-size: 15px; font-family: inherit; color: #111; resize: vertical; line-height: 1.5; transition: border-color 0.15s, background 0.15s; }
.ed-textarea::placeholder { color: #A1A1A6; }
.ed-textarea:focus { outline: none; background: #fff; border-color: #0071E3; }
.ed-count { font-size: 12px; color: #A1A1A6; margin-top: 8px; text-align: right; }
.ed-error { background: #FFF1F0; color: #D70015; border-radius: 12px; padding: 14px 16px; font-size: 14px; font-weight: 500; }
.ed-btn { width: 100%; padding: 16px; border-radius: 100px; border: none; background: #0071E3; color: #fff; font-weight: 600; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: background 0.15s; font-family: inherit; }
.ed-btn:hover:not(:disabled) { background: #0077ED; }
.ed-btn:disabled { background: #B0D4F5; cursor: default; }
.ed-spin { border: 2.5px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; width: 16px; height: 16px; animation: ed-spin 0.7s linear infinite; flex-shrink: 0; }
.ed-spin-dark { border: 2.5px solid rgba(0,0,0,0.15); border-top-color: #111; border-radius: 50%; width: 14px; height: 14px; animation: ed-spin 0.7s linear infinite; flex-shrink: 0; }
.ed-loading-spin { width: 36px; height: 36px; border: 3px solid #E5E5EA; border-top-color: #0071E3; border-radius: 50%; margin: 0 auto 20px; animation: ed-spin 0.7s linear infinite; }
@keyframes ed-spin { to { transform: rotate(360deg); } }
.ed-loading { text-align: center; padding: 80px 24px; }
.ed-loading-title { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
.ed-loading-sub { font-size: 15px; color: #86868B; max-width: 380px; margin: 0 auto; line-height: 1.5; }
.ed-results { animation: ed-fade 0.5s ease; }
@keyframes ed-fade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.ed-divider { display: flex; align-items: center; gap: 16px; margin: 56px 0 28px; }
.ed-divider::before, .ed-divider::after { content: ''; flex: 1; height: 1px; background: #E5E5EA; }
.ed-divider span { font-size: 13px; font-weight: 700; color: #86868B; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.ed-score-card { display: flex; align-items: center; gap: 28px; padding: 28px; background: #F5F5F7; border-radius: 20px; margin-bottom: 18px; }
.ed-ring { position: relative; width: 132px; height: 132px; flex-shrink: 0; }
.ed-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ed-ring-num { font-size: 36px; font-weight: 800; color: #111; line-height: 1; }
.ed-ring-denom { font-size: 13px; color: #86868B; margin-top: 2px; }
.ed-score-info { flex: 1; }
.ed-score-h { font-size: 19px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.02em; }
.ed-score-feedback { font-size: 14px; color: #6E6E73; line-height: 1.5; margin: 0 0 12px; }
.ed-badge { display: inline-block; padding: 5px 14px; border-radius: 100px; font-size: 13px; font-weight: 600; }
.ed-badge-green { background: #D1FAE5; color: #047857; }
.ed-badge-yellow { background: #FEF3C7; color: #B45309; }
.ed-badge-red { background: #FEE2E2; color: #B91C1C; }
.ed-card { background: #fff; border: 1px solid #E5E5EA; border-radius: 20px; padding: 22px 24px; margin-bottom: 18px; }
.ed-card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; }
.ed-card-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.ed-card-sub { font-size: 12.5px; color: #86868B; }
.ed-inspired-badge { display: inline-block; padding: 5px 12px; background: #F0F7FF; border: 1px solid #D6E9FF; font-size: 12px; font-weight: 600; color: #0071E3; white-space: nowrap; flex-shrink: 0; border-radius: 100px; }
.ed-thumbs { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 6px; }
.ed-dl-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; background: #fff; border: 1px solid #E5E5EA; border-radius: 20px; padding: 18px 24px; margin-bottom: 18px; flex-wrap: wrap; }
.ed-len-wrap { display: flex; align-items: center; gap: 14px; }
.ed-len-label { font-size: 14px; font-weight: 700; white-space: nowrap; }
.ed-len-toggle { display: flex; gap: 4px; background: #F5F5F7; border-radius: 12px; padding: 4px; }
.ed-len-btn { padding: 8px 16px; border-radius: 9px; border: none; cursor: pointer; background: transparent; transition: all 0.15s; text-align: center; font-family: inherit; }
.ed-len-active { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
.ed-len-main { display: block; font-size: 13px; font-weight: 700; color: #6E6E73; }
.ed-len-active .ed-len-main { color: #0071E3; }
.ed-len-sub { display: block; font-size: 10px; color: #A1A1A6; margin-top: 1px; }
.ed-dl-btns { display: flex; gap: 10px; }
.ed-dl-word { padding: 11px 18px; border-radius: 100px; border: 1px solid #D2D2D7; background: #fff; color: #111; font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 7px; transition: background 0.15s; }
.ed-dl-word:hover:not(:disabled) { background: #F5F5F7; }
.ed-dl-word:disabled { opacity: 0.6; cursor: default; }
.ed-dl-pdf { padding: 11px 18px; border-radius: 100px; border: none; background: #0071E3; color: #fff; font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 7px; transition: background 0.15s; }
.ed-dl-pdf:hover:not(:disabled) { background: #0077ED; }
.ed-dl-pdf:disabled { opacity: 0.6; cursor: default; }
.ed-resume-card { border: 1px solid #E5E5EA; border-radius: 20px; overflow: hidden; }
.ed-resume-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid #F0F0F2; }
.ed-resume-title { font-size: 15px; font-weight: 700; margin: 0; }
.ed-resume-body { padding: 28px; margin: 0; font-family: 'SF Mono', 'Menlo', monospace; font-size: 12.5px; line-height: 1.65; color: #1D1D1F; white-space: pre-wrap; word-wrap: break-word; max-height: 560px; overflow-y: auto; }
.ed-footer { text-align: center; padding: 40px 24px; font-size: 14px; color: #86868B; border-top: 1px solid #F0F0F2; }
.ed-footer a { color: #0071E3; text-decoration: none; }
@media (max-width: 640px) {
  .ed-nav { padding: 18px 24px; }
  .ed-nav-tag { display: none; }
  .ed-hero-title { font-size: 30px; }
  .ed-score-card { flex-direction: column; text-align: center; gap: 16px; }
  .ed-dl-bar { flex-direction: column; align-items: stretch; }
  .ed-dl-btns { flex-direction: column; }
  .ed-dl-word, .ed-dl-pdf { justify-content: center; }
  .ed-card-head { flex-direction: column; }
}
`