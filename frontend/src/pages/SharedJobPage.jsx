import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { MapPin, Building2, ArrowRight, AlertCircle } from 'lucide-react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'

/**
 * The one page on the board that does NOT require an account.
 *
 * WHY THIS EXISTS
 * A shared link is the warmest traffic the site gets — someone the visitor trusts sent
 * them this specific job. Putting a signup wall in front of it wastes the best chance
 * of a signup there is, and it kills the reason to share in the first place.
 *
 * So the whole job is shown, Apply works, and the pitch sits underneath. The visitor
 * sees the product do its job before being asked for anything.
 *
 * Apply has to work. A job you can read but not act on makes the link worthless and
 * makes the friend who sent it look silly — and the apply URL is public on the
 * employer's own site anyway, so hiding it protects nothing.
 *
 * The rest of the board stays gated: this renders ONE job, fetched by id. There is no
 * list here to browse.
 */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

.sj { --blue: #2563EB; --blue-dark: #1D4ED8; --blue-soft: #EFF6FF;
  --ink: #0A0A0B; --body: #374151; --muted: #6B7280; --border: #E5E7EB;
  font-family: 'Space Grotesk', -apple-system, sans-serif;
  min-height: 100vh; background: #fff; color: var(--ink); -webkit-font-smoothing: antialiased; }
.sj * { box-sizing: border-box; margin: 0; padding: 0; }

.sj-nav { display: flex; align-items: center; justify-content: space-between;
  padding: 12px 30px; border-bottom: 1px solid #F3F4F6; }
.sj-logo { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 17px; cursor: pointer; }
.sj-mark { width: 26px; height: 26px; border-radius: 7px; background: linear-gradient(135deg,#2563EB,#7C3AED); }
.sj-nav-btns { display: flex; align-items: center; gap: 16px; }
.sj-login { font-size: 13.5px; color: var(--muted); font-weight: 500; cursor: pointer; background: none; border: none; font-family: inherit; }
.sj-signup { background: var(--blue); color: #fff; padding: 8px 17px; border-radius: 8px;
  font-size: 13.5px; font-weight: 700; border: none; cursor: pointer; font-family: inherit; }

/* Sized to fit one screen on a laptop without scrolling. The whole point of this page
   is that a visitor with no account sees the job AND the sign-up prompt together — push
   the prompt below the fold and it may as well not exist. Anything that does not fit
   comes off the description, which lives in full on the employer's site anyway. */
.sj-wrap { max-width: 660px; margin: 0 auto; padding: 16px 24px 22px; }
.sj-pill { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: var(--blue); background: var(--blue-soft);
  border: 1px solid #DBEAFE; padding: 3px 9px; border-radius: 6px; margin-bottom: 10px; }
.sj-title { font-size: 22px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; }
.sj-co { color: var(--blue); font-size: 15px; font-weight: 600; margin-top: 6px; }
.sj-meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 13px; margin-top: 8px; }
.sj-meta span { display: inline-flex; align-items: center; gap: 5px; }
.sj-meta svg { width: 14px; height: 14px; }

.sj-actions { display: flex; gap: 10px; margin: 12px 0 12px; }
.sj-apply { flex: 1; background: var(--blue); color: #fff; padding: 11px; border-radius: 10px;
  font-size: 14.5px; font-weight: 700; text-align: center; text-decoration: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.sj-apply:hover { background: var(--blue-dark); }
.sj-apply svg { width: 16px; height: 16px; }

/* A PREVIEW, not the whole posting. The full description lives on the employer's own
   site and the Apply button goes straight there, so reproducing all of it just buries
   the sign-up prompt under a page of scrolling. Fixed height with a fade makes the cut
   obviously deliberate rather than looking like the page failed to load. */
.sj-desc { font-size: 13.5px; line-height: 1.7; color: var(--body);
  position: relative; max-height: 118px; overflow: hidden; }
.sj-desc::after { content: ''; position: absolute; inset: auto 0 0 0; height: 45px;
  background: linear-gradient(transparent, #fff); pointer-events: none; }
.sj-desc h1, .sj-desc h2, .sj-desc h3 { font-size: 16px; font-weight: 700; color: var(--ink); margin: 22px 0 8px; }
.sj-desc p { margin-bottom: 13px; }
.sj-desc ul, .sj-desc ol { margin: 0 0 13px 20px; }
.sj-desc li { margin-bottom: 6px; }
.sj-desc a { color: var(--blue); }
.sj-desc strong, .sj-desc b { font-weight: 650; color: var(--ink); }

.sj-cta { margin-top: 14px; padding: 13px 16px; display: flex; align-items: center;
  gap: 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; }
.sj-cta-txt { flex: 1; min-width: 0; }
.sj-cta-txt b { display: block; font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
.sj-cta-txt span { font-size: 12px; color: var(--muted); line-height: 1.45; }
.sj-cta button { background: var(--blue); color: #fff; border: none; padding: 10px 20px;
  border-radius: 9px; font-size: 13.5px; font-weight: 700; cursor: pointer; flex: none;
  font-family: inherit; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.sj-cta button:hover { background: var(--blue-dark); }
.sj-cta button svg { width: 15px; height: 15px; }

.sj-state { max-width: 460px; margin: 90px auto; text-align: center; color: var(--muted); font-size: 14px; }
.sj-state svg { width: 22px; height: 22px; margin-bottom: 10px; color: #DC2626; }
.sj-spin { width: 30px; height: 30px; border: 3px solid var(--border); border-top-color: var(--blue);
  border-radius: 50%; margin: 0 auto 14px; animation: sj-spin .7s linear infinite; }
@keyframes sj-spin { to { transform: rotate(360deg); } }
.sj-state button { margin-top: 16px; background: var(--blue); color: #fff; border: none;
  padding: 10px 20px; border-radius: 9px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; }

@media (max-width: 640px) {
  .sj-nav { padding: 13px 18px; }
  .sj-wrap { padding: 26px 18px 56px; }
  .sj-title { font-size: 23px; }
}
`

export default function SharedJobPage({ jobId }) {
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`${BACKEND}/jobs/${jobId}`)
        if (!res.ok) throw new Error(res.status === 404 ? 'notfound' : 'failed')
        const data = await res.json()
        if (!cancelled) { setJob(data); setLoading(false) }
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [jobId])

  const nav = (
    <div className="sj-nav">
      <div className="sj-logo" onClick={() => navigate('/')}>
        <div className="sj-mark" />ResumeAI
      </div>
      <div className="sj-nav-btns">
        <button className="sj-login" onClick={() => navigate('/login')}>Log in</button>
        <button className="sj-signup" onClick={() => navigate('/signup')}>Sign up free</button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="sj"><style>{CSS}</style>{nav}
        <div className="sj-state"><div className="sj-spin" />Loading this job…</div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="sj"><style>{CSS}</style>{nav}
        <div className="sj-state">
          <AlertCircle />
          <div>{error === 'notfound'
            ? 'This job is no longer on the board — it was probably filled or closed.'
            : 'Could not load this job. Please try again.'}</div>
          <button onClick={() => navigate('/signup')}>See jobs like this</button>
        </div>
      </div>
    )
  }

  const clean = DOMPurify.sanitize(job.description || '')

  return (
    <div className="sj">
      <style>{CSS}</style>
      {nav}
      <div className="sj-wrap">
        <span className="sj-pill">Shared with you</span>
        <h1 className="sj-title">{job.title}</h1>
        <div className="sj-co">{job.company}</div>
        <div className="sj-meta">
          {job.location && <span><MapPin />{job.location}</span>}
          {job.workType && <span><Building2 />{job.workType}</span>}
        </div>

        <div className="sj-actions">
          <a className="sj-apply" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
            Apply on {job.company || 'the company site'} <ArrowRight />
          </a>
        </div>

        <div className="sj-desc" dangerouslySetInnerHTML={{ __html: clean }} />
        <p style={{ fontSize: 12, color: '#6B7280', marginTop: 8 }}>
          Full description on {job.company || 'the company site'} — the Apply button takes you there.
        </p>

        <div className="sj-cta">
          <div className="sj-cta-txt">
            <b>More jobs like this one</b>
            <span>We hide roles requiring US citizenship or a clearance, or that won't sponsor.</span>
          </div>
          <button onClick={() => navigate('/signup')}>Sign up free <ArrowRight /></button>
        </div>
      </div>
    </div>
  )
}
