import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const BACKEND = 'http://localhost:3001'

// ─────────────────────────────────────────────────────────────
// Self-contained styles (matches the site: Space Grotesk, clean editorial)
// ─────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

.jb-root {
  --ink: #14141a;
  --paper: #faf9f6;
  --card: #ffffff;
  --line: #e7e4dc;
  --muted: #6b6b76;
  --accent: #1a1a2e;
  --accent-soft: #f0eee8;
  --focus: #3b5bdb;
  font-family: 'Space Grotesk', -apple-system, sans-serif;
  background: var(--paper);
  min-height: 100vh;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
.jb-root * { box-sizing: border-box; margin: 0; padding: 0; }

/* Top nav */
.jb-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 28px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: rgba(250,249,246,.9);
  backdrop-filter: blur(8px); z-index: 20;
}
.jb-logo { font-weight: 700; font-size: 20px; letter-spacing: -.02em; cursor: pointer; }
.jb-nav-links { display: flex; gap: 22px; align-items: center; }
.jb-nav-links a { color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; }
.jb-nav-links a:hover { color: var(--ink); }

/* Hero */
.jb-hero { max-width: 900px; margin: 0 auto; padding: 56px 28px 28px; text-align: center; }
.jb-hero h1 {
  font-size: clamp(30px, 5vw, 46px); font-weight: 700; letter-spacing: -.03em;
  line-height: 1.05; margin-bottom: 16px;
}
.jb-hero p { font-size: 16px; color: var(--muted); max-width: 60ch; margin: 0 auto; line-height: 1.5; }
.jb-hero .pill {
  display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em;
  color: var(--accent); background: var(--accent-soft); padding: 6px 14px;
  border-radius: 100px; margin-bottom: 20px; text-transform: uppercase;
}

/* Controls */
.jb-controls { max-width: 780px; margin: 0 auto; padding: 12px 28px 8px; }
.jb-search {
  display: flex; gap: 10px; margin-bottom: 14px;
}
.jb-search input {
  flex: 1; padding: 14px 18px; border: 1px solid var(--line); border-radius: 12px;
  font-family: inherit; font-size: 15px; background: var(--card); outline: none;
}
.jb-search input:focus { border-color: var(--focus); }
.jb-search button {
  padding: 14px 24px; border: none; border-radius: 12px; background: var(--accent);
  color: #fff; font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer;
}
.jb-search button:hover { opacity: .9; }

.jb-filters { display: flex; gap: 8px; flex-wrap: wrap; }
.jb-chip {
  padding: 8px 16px; border: 1px solid var(--line); border-radius: 100px;
  background: var(--card); font-family: inherit; font-size: 13px; font-weight: 500;
  color: var(--muted); cursor: pointer; transition: all .12s;
}
.jb-chip:hover { border-color: var(--ink); color: var(--ink); }
.jb-chip.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.jb-count { max-width: 780px; margin: 0 auto; padding: 16px 28px 4px; font-size: 13px; color: var(--muted); }

/* Job list */
.jb-list { max-width: 780px; margin: 0 auto; padding: 8px 28px 60px; display: flex; flex-direction: column; gap: 10px; }
.jb-card {
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 20px 22px; cursor: pointer; transition: all .14s;
}
.jb-card:hover { border-color: var(--ink); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,.04); }
.jb-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
.jb-card h3 { font-size: 17px; font-weight: 600; letter-spacing: -.01em; line-height: 1.3; }
.jb-card .co { font-size: 14px; color: var(--muted); margin-top: 3px; font-weight: 500; }
.jb-tag {
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px;
  background: var(--accent-soft); color: var(--accent); white-space: nowrap; letter-spacing: .02em;
}
.jb-card .loc { font-size: 13px; color: var(--muted); margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.jb-card .loc .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--muted); }

/* States */
.jb-state { max-width: 780px; margin: 0 auto; padding: 60px 28px; text-align: center; color: var(--muted); }
.jb-state h3 { font-size: 18px; color: var(--ink); margin-bottom: 8px; font-weight: 600; }
.jb-spinner {
  width: 28px; height: 28px; border: 3px solid var(--line); border-top-color: var(--accent);
  border-radius: 50%; animation: jbspin .7s linear infinite; margin: 0 auto 16px;
}
@keyframes jbspin { to { transform: rotate(360deg); } }

/* Pagination */
.jb-pager { max-width: 780px; margin: 0 auto; padding: 0 28px 80px; display: flex; justify-content: center; align-items: center; gap: 14px; }
.jb-pager button {
  padding: 10px 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--card);
  font-family: inherit; font-weight: 500; font-size: 14px; cursor: pointer; color: var(--ink);
}
.jb-pager button:disabled { opacity: .4; cursor: not-allowed; }
.jb-pager button:not(:disabled):hover { border-color: var(--ink); }
.jb-pager .pg { font-size: 14px; color: var(--muted); }

/* Detail drawer */
.jb-overlay {
  position: fixed; inset: 0; background: rgba(20,20,26,.4); z-index: 40;
  opacity: 0; pointer-events: none; transition: opacity .2s;
}
.jb-overlay.open { opacity: 1; pointer-events: auto; }
.jb-drawer {
  position: fixed; top: 0; right: 0; height: 100%; width: min(560px, 100%);
  background: var(--paper); z-index: 50; transform: translateX(100%);
  transition: transform .26s cubic-bezier(.4,0,.2,1); overflow-y: auto;
  box-shadow: -8px 0 40px rgba(0,0,0,.1);
}
.jb-drawer.open { transform: translateX(0); }
.jb-drawer-head {
  padding: 24px 28px; border-bottom: 1px solid var(--line); position: sticky; top: 0;
  background: rgba(250,249,246,.95); backdrop-filter: blur(8px);
}
.jb-close {
  position: absolute; top: 20px; right: 24px; width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid var(--line); background: var(--card); cursor: pointer; font-size: 18px;
  line-height: 1; color: var(--muted); display: flex; align-items: center; justify-content: center;
}
.jb-close:hover { color: var(--ink); border-color: var(--ink); }
.jb-drawer-head h2 { font-size: 22px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; margin-right: 40px; margin-bottom: 6px; }
.jb-drawer-head .co { font-size: 15px; color: var(--muted); font-weight: 500; }
.jb-drawer-head .loc { font-size: 13px; color: var(--muted); margin-top: 10px; }
.jb-drawer-actions { display: flex; gap: 10px; padding: 18px 28px; border-bottom: 1px solid var(--line); position: sticky; top: 89px; background: var(--paper); z-index: 2; }
.jb-btn-primary {
  flex: 1; padding: 13px; border: none; border-radius: 11px; background: var(--accent);
  color: #fff; font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
}
.jb-btn-primary:hover { opacity: .9; }
.jb-btn-secondary {
  flex: 1; padding: 13px; border: 1px solid var(--ink); border-radius: 11px; background: transparent;
  color: var(--ink); font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
  text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center;
}
.jb-btn-secondary:hover { background: var(--ink); color: #fff; }
.jb-desc { padding: 24px 28px 60px; font-size: 14.5px; line-height: 1.65; color: #2c2c34; white-space: pre-wrap; }
.jb-desc-loading { padding: 40px 28px; text-align: center; color: var(--muted); }

@media (max-width: 560px) {
  .jb-nav-links a:not(.jb-nav-jobs) { display: none; }
  .jb-search { flex-direction: column; }
}
`

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

// Shorten messy multi-location strings for the card
function shortLoc(loc) {
  if (!loc) return 'United States'
  const parts = loc.split(';').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 1) return loc
  return `${parts[0]} +${parts.length - 1} more`
}

export default function JobBoard() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState(false)
  const [timePosted, setTimePosted] = useState('')

  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const listTop = useRef(null)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (query.trim()) params.set('query', query.trim())
      if (remote) params.set('remote', 'true')
      if (timePosted) params.set('time_posted', timePosted)

      const res = await fetch(`${BACKEND}/jobs?${params.toString()}`)
      if (!res.ok) throw new Error('bad response')
      const data = await res.json()
      setJobs(data.jobs || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } catch {
      setError("Couldn't load jobs. The server may be waking up — try again in a few seconds.")
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [page, query, remote, timePosted])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  function runSearch() {
    setPage(1)
    setQuery(searchInput)
  }

  function toggleRemote() {
    setPage(1)
    setRemote(r => !r)
  }

  function pickTime(val) {
    setPage(1)
    setTimePosted(t => (t === val ? '' : val))
  }

  async function openJob(job) {
    setSelected(job)
    setDetailLoading(true)
    document.body.style.overflow = 'hidden'
    try {
      const res = await fetch(`${BACKEND}/jobs/${job.id}`)
      if (res.ok) {
        const full = await res.json()
        setSelected(full)
      }
    } catch {
      // keep the preview we already have
    } finally {
      setDetailLoading(false)
    }
  }

  function closeJob() {
    setSelected(null)
    document.body.style.overflow = ''
  }

  function optimizeFor(job) {
    // Pass job info to the optimizer via sessionStorage, then go to /app (login-gated)
    try {
      sessionStorage.setItem('optimize_job', JSON.stringify({
        title: job.title,
        company: job.company,
        description: job.description || '',
      }))
    } catch {}
    navigate('/app')
  }

  function changePage(next) {
    setPage(next)
    if (listTop.current) listTop.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="jb-root">
      <style>{CSS}</style>

      {/* Nav */}
      <nav className="jb-nav">
        <div className="jb-logo" onClick={() => navigate('/')}>ResumeAI</div>
        <div className="jb-nav-links">
          <a href="/how-it-works">How it works</a>
          <a href="/pricing">Pricing</a>
          <a className="jb-nav-jobs" href="/app">Optimize resume</a>
        </div>
      </nav>

      {/* Hero */}
      <header className="jb-hero">
        <span className="pill">Built for F1 students</span>
        <h1>Jobs that won't waste your time.</h1>
        <p>
          We hide roles that require US citizenship, security clearances, or that explicitly refuse
          visa sponsorship. Everything here is fair game — always confirm sponsorship with the employer.
        </p>
      </header>

      {/* Controls */}
      <div className="jb-controls" ref={listTop}>
        <div className="jb-search">
          <input
            type="text"
            placeholder="Search job title or company…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
          />
          <button onClick={runSearch}>Search</button>
        </div>
        <div className="jb-filters">
          <button className={`jb-chip ${remote ? 'active' : ''}`} onClick={toggleRemote}>Remote only</button>
          <button className={`jb-chip ${timePosted === 'today' ? 'active' : ''}`} onClick={() => pickTime('today')}>Today</button>
          <button className={`jb-chip ${timePosted === 'week' ? 'active' : ''}`} onClick={() => pickTime('week')}>Past week</button>
          <button className={`jb-chip ${timePosted === 'month' ? 'active' : ''}`} onClick={() => pickTime('month')}>Past month</button>
        </div>
      </div>

      {/* Count */}
      {!loading && !error && (
        <div className="jb-count">{total.toLocaleString()} job{total === 1 ? '' : 's'} found</div>
      )}

      {/* List / states */}
      {loading ? (
        <div className="jb-state"><div className="jb-spinner" />Loading jobs…</div>
      ) : error ? (
        <div className="jb-state">
          <h3>Something went wrong</h3>
          <p>{error}</p>
          <button className="jb-chip" style={{ marginTop: 16 }} onClick={fetchJobs}>Try again</button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="jb-state">
          <h3>No jobs match that search</h3>
          <p>Try a different keyword or clear your filters.</p>
        </div>
      ) : (
        <>
          <div className="jb-list">
            {jobs.map(job => (
              <div key={job.id} className="jb-card" onClick={() => openJob(job)}>
                <div className="jb-card-top">
                  <div>
                    <h3>{job.title}</h3>
                    <div className="co">{job.company}</div>
                  </div>
                  {job.isRemote && <span className="jb-tag">Remote</span>}
                </div>
                <div className="loc">
                  <span>{shortLoc(job.location)}</span>
                  <span className="dot" />
                  <span>{timeAgo(job.postedAt)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="jb-pager">
            <button disabled={page <= 1} onClick={() => changePage(page - 1)}>← Prev</button>
            <span className="pg">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => changePage(page + 1)}>Next →</button>
          </div>
        </>
      )}

      {/* Detail drawer */}
      <div className={`jb-overlay ${selected ? 'open' : ''}`} onClick={closeJob} />
      <aside className={`jb-drawer ${selected ? 'open' : ''}`}>
        {selected && (
          <>
            <div className="jb-drawer-head">
              <button className="jb-close" onClick={closeJob}>×</button>
              <h2>{selected.title}</h2>
              <div className="co">{selected.company}</div>
              <div className="loc">{selected.location} · {timeAgo(selected.postedAt)}</div>
            </div>
            <div className="jb-drawer-actions">
              <button className="jb-btn-primary" onClick={() => optimizeFor(selected)}>Optimize my resume ✦</button>
              <a className="jb-btn-secondary" href={selected.applyUrl} target="_blank" rel="noreferrer">Apply →</a>
            </div>
            {detailLoading ? (
              <div className="jb-desc-loading">Loading full description…</div>
            ) : (
              <div className="jb-desc">{selected.description || 'No description available.'}</div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}