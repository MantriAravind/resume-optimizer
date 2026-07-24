import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import DOMPurify from 'dompurify'
import SidebarLayout from '../components/SidebarLayout'
import OptimizeModal from './OptimizeModal'
import {
  MapPin, Building2, TrendingUp, DollarSign, Clock,
  CheckCircle2, Search, ChevronDown, X, Sparkles, GraduationCap,
} from 'lucide-react'

// Read from the environment so the backend can move without editing four files.
// The fallback is the current production URL, so a missing variable degrades to
// today's behaviour instead of silently pointing the app at nothing.
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'

const STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming', 'District of Columbia',
]
const WORK_TYPES = ['Onsite', 'Hybrid', 'Remote US']
const EXPERIENCE_LEVELS = ['Internship', 'Entry', 'Mid', 'Senior', 'Staff', 'Director']
const TIME_OPTIONS = [
  { value: '', label: 'Time posted' },
  { value: 'today', label: 'Today' },
  { value: '3days', label: 'Past 3 days' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
]

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

.jb-root {
  --ink: #0A0A0B;
  --blue: #2563EB;
  --blue-dark: #1D4ED8;
  --blue-soft: #EFF6FF;
  --body: #1F2937;
  --muted: #6B7280;
  --border: #E5E7EB;
  --card: #ffffff;
  --green: #059669;
  font-family: 'Space Grotesk', -apple-system, sans-serif;
  background: #fff;
  min-height: 100vh;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
.jb-root * { box-sizing: border-box; margin: 0; padding: 0; }
.jb-root :focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

.jb-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 28px; border-bottom: 1px solid #F3F4F6;
  position: sticky; top: 0; background: rgba(255,255,255,.92);
  backdrop-filter: blur(8px); z-index: 20;
}
.jb-nav-logo { font-weight: 700; font-size: 19px; letter-spacing: -.02em; cursor: pointer; }
.jb-nav-links { display: flex; gap: 22px; align-items: center; }
.jb-nav-links a { color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; }
.jb-nav-links a:hover { color: var(--ink); }

.jb-hero-wrap { max-width: 900px; margin: 0 auto; padding: 24px 28px 0; }
.jb-hero {
  background: linear-gradient(135deg, #EFF6FF 0%, #F5F3FF 100%);
  border-radius: 22px; padding: 40px 36px;
}
.jb-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
.jb-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; letter-spacing: .01em;
  background: #fff; color: var(--blue); border: 1px solid #DBEAFE;
  padding: 7px 14px; border-radius: 100px; box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.jb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--blue); animation: jbPulse 1.8s ease-in-out infinite; }
@keyframes jbPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.8); } }
@media (prefers-reduced-motion: reduce) { .jb-dot { animation: none; } }
.jb-hero h1 { font-size: clamp(26px, 4.2vw, 38px); font-weight: 700; letter-spacing: -.03em; line-height: 1.1; margin-bottom: 12px; }
.jb-hero p { font-size: 14.5px; color: var(--muted); max-width: 56ch; line-height: 1.55; }

.jb-filters { max-width: 900px; margin: 20px auto 0; padding: 0 28px; }
.jb-search { display: flex; gap: 10px; margin-bottom: 12px; }
.jb-search input {
  flex: 1; padding: 13px 17px; border: 1px solid var(--border); border-radius: 11px;
  font-family: inherit; font-size: 14px; background: var(--card); outline: none;
}
.jb-search input:focus { border-color: var(--blue); }
.jb-search button {
  padding: 13px 24px; border: none; border-radius: 11px; background: var(--blue);
  color: #fff; font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
  box-shadow: 0 4px 14px rgba(37,99,235,.28);
}
.jb-search button:hover { background: var(--blue-dark); }

.jb-dropdowns { display: flex; gap: 8px; flex-wrap: wrap; }
.jb-select-wrap { position: relative; flex: 1; min-width: 140px; }
.jb-select-wrap select {
  width: 100%; appearance: none; font-family: inherit; font-size: 13px; font-weight: 500;
  color: var(--body); background: var(--card); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 32px 10px 14px; cursor: pointer;
}
.jb-select-wrap svg { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; width: 15px; height: 15px; }
.jb-clear-filters {
  border: none; background: none; color: var(--blue); font-family: inherit;
  font-size: 13px; font-weight: 600; cursor: pointer; padding: 10px 4px;
}
.jb-clear-filters:hover { text-decoration: underline; }

.jb-count { max-width: 900px; margin: 0 auto; padding: 16px 28px 6px; font-size: 13px; color: var(--muted); }

.jb-list { max-width: 900px; margin: 0 auto; padding: 6px 28px 60px; display: flex; flex-direction: column; gap: 12px; }
.jb-card--closed { background: #FBFBFC; border-color: #ECECEF; cursor: default; }
.jb-card--closed:hover { transform: none; box-shadow: none; border-color: #ECECEF; }
.jb-card--closed h3 { color: #8E8E93; }
.jb-logo--closed { background: linear-gradient(135deg, #9A9AA0, #C0C0C6) !important; opacity: .55; }
.jb-pill--closed { background: #FDF0F0; color: #B02020; font-weight: 600; }
.jb-closed-note { margin-top: 12px; font-size: 12.5px; color: #8E8E93; background: #F7F7F8;
  border-radius: 9px; padding: 10px 12px; line-height: 1.45; }
.jb-btn-dead { background: #F2F2F4; color: #B0B0B5; border: none; border-radius: 9px;
  padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: not-allowed; font-family: inherit; }

.jb-card {
  background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 22px;
  cursor: pointer; transition: box-shadow .16s, border-color .16s, transform .16s;
}
.jb-card:hover { border-color: #BFDBFE; box-shadow: 0 6px 20px rgba(37,99,235,.09); transform: translateY(-1px); }
.jb-card-top { display: flex; gap: 14px; }
.jb-logo {
  width: 46px; height: 46px; border-radius: 11px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25);
}
.jb-card-head { flex: 1; min-width: 0; display: flex; justify-content: space-between; gap: 10px; }
.jb-card h3 { font-size: 16.5px; font-weight: 700; letter-spacing: -.01em; line-height: 1.3; }
.jb-card .co { font-size: 13.5px; color: var(--muted); margin-top: 2px; font-weight: 500; }
.jb-sponsor {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700;
  background: #ECFDF5; color: var(--green); border: 1px solid #A7F3D0;
  padding: 5px 10px; border-radius: 7px; white-space: nowrap; height: fit-content;
}

.jb-pills { display: flex; gap: 7px; flex-wrap: wrap; margin: 14px 0 16px; padding-left: 60px; }
.jb-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 5px 10px; border-radius: 8px; border: 1px solid transparent; font-weight: 500; }
.jb-pill svg { width: 13px; height: 13px; }
.jb-pill--location { background: #F1F5F9; color: #475569; }
.jb-pill--location svg { color: #64748B; }
.jb-pill--worktype { background: #EFF6FF; color: #1D4ED8; }
.jb-pill--worktype svg { color: #2563EB; }
.jb-pill--experience { background: #F5F3FF; color: #7C3AED; }
.jb-pill--experience svg { color: #7C3AED; }
.jb-pill--salary { background: #FFF7ED; color: #C2410C; font-weight: 700; }
.jb-pill--salary svg { color: #C2410C; }
.jb-pill--years { background: #ECFEFF; color: #0E7490; font-weight: 700; }
.jb-pill--years svg { color: #0E7490; }

.jb-card-foot { display: flex; align-items: center; justify-content: space-between; padding-left: 60px; border-top: 1px solid #F1F5F9; margin-top: 16px; padding-top: 14px; }
.jb-posted { font-size: 12.5px; color: var(--muted); }
.jb-actions { display: flex; gap: 8px; }
.jb-btn-opt {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px;
  border: none; background: var(--blue-soft); color: var(--blue);
  font-family: inherit; font-weight: 700; font-size: 13px; cursor: pointer;
}
.jb-btn-opt:hover { background: #DBEAFE; }
.jb-btn-apply {
  padding: 8px 16px; border-radius: 10px; border: none; background: var(--blue);
  color: #fff; font-family: inherit; font-weight: 700; font-size: 13px; cursor: pointer;
  text-decoration: none; display: inline-flex; align-items: center;
}
.jb-btn-apply:hover { background: var(--blue-dark); }

.jb-state { max-width: 900px; margin: 0 auto; padding: 70px 28px; text-align: center; color: var(--muted); }
.jb-state h3 { font-size: 17px; color: var(--ink); margin-bottom: 8px; font-weight: 600; }
.jb-state p { font-size: 14px; }
.jb-spinner { width: 26px; height: 26px; border: 3px solid var(--border); border-top-color: var(--blue); border-radius: 50%; animation: jbSpin .7s linear infinite; margin: 0 auto 16px; }
@keyframes jbSpin { to { transform: rotate(360deg); } }
.jb-retry { margin-top: 14px; padding: 9px 18px; border-radius: 9px; border: 1px solid var(--border); background: #fff; font-family: inherit; font-weight: 500; font-size: 13px; cursor: pointer; color: var(--ink); }
.jb-retry:hover { border-color: var(--ink); }

.jb-pager { max-width: 900px; margin: 0 auto; padding: 0 28px 80px; display: flex; justify-content: center; align-items: center; gap: 14px; }
.jb-pager button { padding: 10px 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); font-family: inherit; font-weight: 500; font-size: 14px; cursor: pointer; color: var(--ink); }
.jb-pager button:disabled { opacity: .4; cursor: not-allowed; }
.jb-pager button:not(:disabled):hover { border-color: var(--ink); }
.jb-pager .pg { font-size: 14px; color: var(--muted); }

.jb-overlay { position: fixed; inset: 0; background: rgba(10,10,11,.35); z-index: 40; opacity: 0; pointer-events: none; transition: opacity .2s; }
.jb-overlay.open { opacity: 1; pointer-events: auto; }
.jb-drawer {
  position: fixed; top: 0; right: 0; height: 100%; width: min(560px, 100%);
  background: #fff; z-index: 50; transform: translateX(100%);
  transition: transform .28s cubic-bezier(.4,0,.2,1); overflow-y: auto;
  box-shadow: -10px 0 40px rgba(0,0,0,.12);
}
.jb-drawer.open { transform: translateX(0); }
.jb-drawer-head { padding: 24px 28px 18px; border-bottom: 1px solid #F3F4F6; position: sticky; top: 0; background: #fff; z-index: 2; }
.jb-close {
  position: absolute; top: 20px; right: 22px; width: 32px; height: 32px; border-radius: 50%;
  border: 1px solid var(--border); background: var(--card); cursor: pointer; font-size: 17px;
  color: var(--muted); display: flex; align-items: center; justify-content: center;
}
.jb-close:hover { color: var(--ink); border-color: var(--ink); }
.jb-drawer-head h2 { font-size: 20px; font-weight: 700; letter-spacing: -.02em; line-height: 1.25; margin-right: 42px; margin-bottom: 5px; }
.jb-drawer-head .co { font-size: 13.5px; color: var(--muted); }
.jb-drawer-head .loc { font-size: 12px; color: #9CA3AF; margin-top: 6px; }
.jb-drawer-actions { display: flex; gap: 10px; padding: 16px 28px; border-bottom: 1px solid #F3F4F6; position: sticky; top: 89px; background: #fff; z-index: 1; }
.jb-drawer-actions .jb-btn-opt, .jb-drawer-actions .jb-btn-apply { flex: 1; justify-content: center; padding: 12px; font-size: 13.5px; }
.jb-desc { padding: 22px 28px 60px; font-size: 13.5px; line-height: 1.7; color: var(--body); }
.jb-desc p { margin-bottom: 8px; }
.jb-desc ul { padding-left: 19px; margin-bottom: 6px; }
.jb-desc li { margin-bottom: 6px; }
.jb-desc strong { color: var(--ink); font-weight: 700; }
.jb-desc h3, .jb-desc p > strong:only-child { display: block; font-size: 12.5px; color: var(--blue); text-transform: uppercase; letter-spacing: .05em; margin: 20px 0 4px; font-weight: 700; }
.jb-desc h3:first-child, .jb-desc p:first-child > strong:only-child { margin-top: 0; }
.jb-desc-loading { padding: 40px 28px; text-align: center; color: var(--muted); }

@media (max-width: 560px) {
  .jb-nav-links a:not(.jb-nav-jobs) { display: none; }
  .jb-search { flex-direction: column; }
  .jb-pills, .jb-card-foot { padding-left: 0; }
  .jb-card-top { flex-direction: column; }
}
`

function gradientFor(name = '') {
  const palette = [
    ['#2563EB', '#7C3AED'], ['#0EA5E9', '#2563EB'], ['#6366F1', '#2563EB'],
    ['#3B82F6', '#8B5CF6'], ['#2563EB', '#06B6D4'],
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const [from, to] = palette[Math.abs(hash) % palette.length]
  return `linear-gradient(135deg, ${from}, ${to})`
}

function formatSalary(min, max) {
  if (!min || !max) return null
  const fmt = n => `$${Math.round(n / 1000)}K`
  return `${fmt(min)}–${fmt(max)}`
}

function formatYears(min, max) {
  if (min == null) return null
  return max ? `${min}–${max} yrs exp` : `${min}+ yrs exp`
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function shortLoc(loc) {
  if (!loc) return 'United States'
  const spaced = loc.replace(/,(?=\S)/g, ', ')
  const parts = spaced.split(';').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 1) return spaced
  return `${parts[0]} +${parts.length - 1} more`
}

function JobCard({ job, onOpen, onOptimize }) {
  const salary = formatSalary(job.salaryMin, job.salaryMax)
  const years = formatYears(job.yearsMin, job.yearsMax)

  function handleOptimizeClick(e) {
    e.stopPropagation()
    onOptimize(job)
  }

  function handleApplyClick(e) {
    e.stopPropagation()
  }

  // A job the backend has confirmed is gone from the source. These are normally
  // filtered out of the list, so this only shows for a board loaded before the job
  // closed. Nothing here should be clickable.
  if (job.closed) {
    return (
      <div className="jb-card jb-card--closed">
        <div className="jb-card-top">
          <div className="jb-logo jb-logo--closed">{job.company ? job.company[0] : '?'}</div>
          <div className="jb-card-head">
            <div>
              <h3>{job.title}</h3>
              <div className="co">{job.company}</div>
            </div>
          </div>
        </div>

        <div className="jb-pills">
          <span className="jb-pill jb-pill--closed">No longer open</span>
          <span className="jb-pill jb-pill--location"><MapPin />{shortLoc(job.location)}</span>
          {job.workType && <span className="jb-pill jb-pill--worktype"><Building2 />{job.workType}</span>}
        </div>

        <div className="jb-closed-note">
          This posting was closed by the employer. It drops off the board at the next refresh.
        </div>

        <div className="jb-card-foot">
          <span className="jb-posted">Posted {timeAgo(job.postedAt)}</span>
          <div className="jb-actions">
            <button className="jb-btn-dead" disabled>Optimize</button>
            <button className="jb-btn-dead" disabled>Apply</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="jb-card" onClick={() => onOpen(job)}>
      <div className="jb-card-top">
        <div className="jb-logo" style={{ background: gradientFor(job.company) }}>
          {job.company ? job.company[0] : '?'}
        </div>
        <div className="jb-card-head">
          <div>
            <h3>{job.title}</h3>
            <div className="co">{job.company}</div>
          </div>
          {job.sponsorBadge && (
            <span className="jb-sponsor"><CheckCircle2 size={13} /> Sponsors visa</span>
          )}
        </div>
      </div>

      <div className="jb-pills">
        <span className="jb-pill jb-pill--location"><MapPin />{shortLoc(job.location)}</span>
        {job.workType && <span className="jb-pill jb-pill--worktype"><Building2 />{job.workType}</span>}
        {job.experienceLevel && <span className="jb-pill jb-pill--experience"><TrendingUp />{job.experienceLevel}</span>}
        {salary && <span className="jb-pill jb-pill--salary"><DollarSign />{salary}</span>}
        {years && <span className="jb-pill jb-pill--years"><Clock />{years}</span>}
      </div>

      <div className="jb-card-foot">
        <span className="jb-posted">Posted {timeAgo(job.postedAt)}</span>
        <div className="jb-actions">
          <button className="jb-btn-opt" onClick={handleOptimizeClick}>
            <Sparkles size={13} /> Optimize
          </button>
          <a className="jb-btn-apply" href={job.applyUrl} target="_blank" rel="noreferrer" onClick={handleApplyClick}>Apply →</a>
        </div>
      </div>
    </div>
  )
}

export default function JobBoard() {
  const navigate = useNavigate()
  const { isSignedIn } = useUser()
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [workType, setWorkType] = useState('')
  const [experienceLevel, setExperienceLevel] = useState('')
  const [timePosted, setTimePosted] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [optimizeJob, setOptimizeJob] = useState(null)

  const listTop = useRef(null)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (query.trim()) params.set('query', query.trim())
      if (workType) params.set('workType', workType)
      if (experienceLevel) params.set('experienceLevel', experienceLevel)
      if (timePosted) params.set('time_posted', timePosted)
      if (stateFilter) params.set('state', stateFilter)

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
  }, [page, query, workType, experienceLevel, timePosted, stateFilter])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  function runSearch() {
    setPage(1)
    setQuery(searchInput)
  }

  function pickWorkType(e) { setPage(1); setWorkType(e.target.value) }
  function pickExperience(e) { setPage(1); setExperienceLevel(e.target.value) }
  function pickTimePosted(e) { setPage(1); setTimePosted(e.target.value) }
  function pickState(e) { setPage(1); setStateFilter(e.target.value) }

  function clearFilters() {
    setPage(1)
    setSearchInput('')
    setQuery('')
    setWorkType('')
    setExperienceLevel('')
    setTimePosted('')
    setStateFilter('')
  }

  const hasActiveFilters = query || workType || experienceLevel || timePosted || stateFilter

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
    if (!isSignedIn) {
      // remember the job so login can return here later; for now just gate
      try {
        sessionStorage.setItem('optimize_job', JSON.stringify({ id: job.id, title: job.title, company: job.company }))
      } catch {}
      navigate('/login')
      return
    }
    // open the modal in place — no navigation, no lost job
    if (selected) closeJob()
    setOptimizeJob(job)
    document.body.style.overflow = 'hidden'
  }

  function closeOptimize() {
    setOptimizeJob(null)
    document.body.style.overflow = ''
  }

  function changePage(next) {
    setPage(next)
    if (listTop.current) listTop.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const safeDescription = selected?.description
    ? DOMPurify.sanitize(selected.description)
    : ''

  const pageContent = (
    <div className="jb-root">
      <style>{CSS}</style>

      {!isSignedIn && (
        <nav className="jb-nav">
          <div className="jb-nav-logo" onClick={() => navigate('/')}>ResumeAI</div>
          <div className="jb-nav-links">
            <a href="/how-it-works">How it works</a>
            <a href="/pricing">Pricing</a>
            <a className="jb-nav-jobs" href="/login">Log in</a>
          </div>
        </nav>
      )}

      <div className="jb-hero-wrap">
        <header className="jb-hero">
          <div className="jb-badges">
            <span className="jb-badge"><span className="jb-dot" />Built for International Students</span>
            <span className="jb-badge"><GraduationCap size={13} />F1 · CPT · OPT · STEM OPT</span>
            <span className="jb-badge"><CheckCircle2 size={13} />Full-time roles only</span>
          </div>
          <h1>Jobs that <span style={{ color: 'var(--blue)' }}>won't waste your time.</span></h1>
          <p>We hide roles that require US citizenship, security clearances, or that explicitly refuse visa sponsorship. Everything here is fair game — always confirm sponsorship with the employer.</p>
        </header>
      </div>

      <div className="jb-filters" ref={listTop}>
        <div className="jb-search">
          <input type="text" placeholder="Search job title or company…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} />
          <button onClick={runSearch}>Search</button>
        </div>
        <div className="jb-dropdowns">
          <div className="jb-select-wrap">
            <select value={workType} onChange={pickWorkType}>
              <option value="">Work type</option>
              {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <ChevronDown />
          </div>
          <div className="jb-select-wrap">
            <select value={timePosted} onChange={pickTimePosted}>
              {TIME_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <ChevronDown />
          </div>
          <div className="jb-select-wrap">
            <select value={experienceLevel} onChange={pickExperience}>
              <option value="">Experience level</option>
              {EXPERIENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <ChevronDown />
          </div>
          <div className="jb-select-wrap">
            <select value={stateFilter} onChange={pickState}>
              <option value="">State</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown />
          </div>
          {hasActiveFilters && (
            <button className="jb-clear-filters" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      </div>

      {!loading && !error && (
        <div className="jb-count">{total.toLocaleString()} job{total === 1 ? '' : 's'} found</div>
      )}

      {loading ? (
        <div className="jb-state"><div className="jb-spinner" />Loading jobs…</div>
      ) : error ? (
        <div className="jb-state">
          <h3>Something went wrong</h3>
          <p>{error}</p>
          <button className="jb-retry" onClick={fetchJobs}>Try again</button>
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
              <JobCard key={job.id} job={job} onOpen={openJob} onOptimize={optimizeFor} />
            ))}
          </div>

          <div className="jb-pager">
            <button disabled={page <= 1} onClick={() => changePage(page - 1)}>← Prev</button>
            <span className="pg">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => changePage(page + 1)}>Next →</button>
          </div>
        </>
      )}

      <div className={`jb-overlay ${selected ? 'open' : ''}`} onClick={closeJob} />
      <aside className={`jb-drawer ${selected ? 'open' : ''}`}>
        {selected && (
          <>
            <div className="jb-drawer-head">
              <button className="jb-close" onClick={closeJob}>×</button>
              <h2>{selected.title}</h2>
              <div className="co">{selected.company}</div>
              <div className="loc">{shortLoc(selected.location)} · {timeAgo(selected.postedAt)}</div>
            </div>
            <div className="jb-drawer-actions">
              <button className="jb-btn-opt" onClick={() => optimizeFor(selected)}>
                <Sparkles size={14} /> Optimize my resume
              </button>
              <a className="jb-btn-apply" href={selected.applyUrl} target="_blank" rel="noreferrer">Apply →</a>
            </div>
            {detailLoading ? (
              <div className="jb-desc-loading">Loading full description…</div>
            ) : (
              <div className="jb-desc" dangerouslySetInnerHTML={{ __html: safeDescription || 'No description available.' }} />
            )}
          </>
        )}
      </aside>

      {optimizeJob && (
        <OptimizeModal job={optimizeJob} onClose={closeOptimize} />
      )}
    </div>
  )

  return isSignedIn ? <SidebarLayout>{pageContent}</SidebarLayout> : pageContent
}