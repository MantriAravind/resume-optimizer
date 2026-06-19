import { useState } from 'react'
import '../App.css'

function ScoreRing({ score }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 75 ? '#059669' : score >= 50 ? '#D97706' : '#DC2626'

  return (
    <div className="score-ring-wrapper">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="10" />
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="score-center">
        <span className="score-number">{score}</span>
        <span className="score-denom">/100</span>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#93C5FD" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <p className="empty-title">Your results will appear here</p>
      <p className="empty-subtitle">Paste your resume and a job description, then click Optimize Resume to see your ATS score and tailored resume.</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-spinner"></div>
      <p className="loading-title">Optimizing your resume…</p>
      <p className="loading-subtitle">Our AI is analyzing the job description and tailoring your resume. This takes about 15–20 seconds.</p>
    </div>
  )
}

export default function ToolPage() {
  const [resumeText, setResumeText] = useState('')
  const [jobText, setJobText] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleOptimize() {
    if (resumeText.trim() === '' || jobText.trim() === '') {
      setError('Please fill in both your resume and the job description.')
      return
    }
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const response = await fetch('https://resume-optimizer-cuii.onrender.com/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobText })
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      setResult(data)
    } catch (err) {
      setError('Could not connect to the server. Please try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (result && result.optimizedResume) {
      navigator.clipboard.writeText(result.optimizedResume)
    }
  }

  let badgeClass = 'badge-red'
  let badgeText = 'Needs improvement'
  if (result) {
    if (result.score >= 75) {
      badgeClass = 'badge-green'
      badgeText = 'Strong match'
    } else if (result.score >= 50) {
      badgeClass = 'badge-yellow'
      badgeText = 'Moderate match'
    }
  }

  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="logo">
            <span className="logo-mark">R</span>
            <span className="logo-text">ResumeAI</span>
          </div>
          <span className="navbar-tagline">ATS-optimized resumes in seconds</span>
        </div>
      </nav>

      <div className="hero">
        <h1 className="hero-title">Land more interviews.</h1>
        <p className="hero-sub">Paste your resume and a job description. Our AI rewrites your resume to match the role and pass ATS filters.</p>
      </div>

      <main className="workspace">
        <div className="input-panel">
          <div className="input-group">
            <label className="input-label">
              <span className="label-step">01</span>
              Your Current Resume
            </label>
            <textarea
              className="input-textarea"
              placeholder="Paste your resume text here. Include work experience, skills, education, and any other relevant sections."
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
            <span className="char-count">{resumeText.length} characters</span>
          </div>

          <div className="input-group">
            <label className="input-label">
              <span className="label-step">02</span>
              Job Description
            </label>
            <textarea
              className="input-textarea"
              placeholder="Paste the full job description here, including responsibilities, required skills, and qualifications."
              value={jobText}
              onChange={(e) => setJobText(e.target.value)}
            />
            <span className="char-count">{jobText.length} characters</span>
          </div>

          {error && (
            <div className="error-banner">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {error}
            </div>
          )}

          <button className="optimize-btn" onClick={handleOptimize} disabled={loading}>
            {loading ? (
              <><span className="btn-spinner"></span>Optimizing…</>
            ) : (
              <>Optimize Resume
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </>
            )}
          </button>
        </div>

        <div className="results-panel">
          {!result && !loading && <EmptyState />}
          {loading && <LoadingState />}
          {result && (
            <div className="results-content">
              <div className="score-section">
                <ScoreRing score={result.score} />
                <div className="score-details">
                  <h2 className="score-heading">ATS Match Score</h2>
                  <p className="score-feedback">{result.feedback}</p>
                  <div className={'score-badge ' + badgeClass}>
                    {badgeText}
                  </div>
                </div>
              </div>

              <div className="optimized-section">
                <div className="optimized-header">
                  <h3 className="optimized-title">Optimized Resume</h3>
                  <button className="copy-btn" onClick={handleCopy}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                    Copy
                  </button>
                </div>
                <div className="optimized-body">
                  <pre className="optimized-text">{result.optimizedResume}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="footer">
        <p>Built with AI · Powered by Claude · <a href="https://github.com/MantriAravind/resume-optimizer" target="_blank" rel="noreferrer">View on GitHub</a></p>
      </footer>
    </div>
  )
}