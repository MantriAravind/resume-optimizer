import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import DOMPurify from 'dompurify'
import { useHasResume } from '../hooks/useHasResume'
import SidebarLayout from '../components/SidebarLayout'
import OptimizeModal from './OptimizeModal'
import {
  MapPin, Building2, TrendingUp, DollarSign, Clock,
  CheckCircle2, Search, ChevronDown, X, Sparkles, GraduationCap, Check,
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
// Must match CATEGORIES in backend/jobCategory.mjs. The server validates against
// that list, so a value only present here would silently return an empty board.

const EXPERIENCE_LEVELS = ['Internship', 'Entry', 'Mid', 'Senior', 'Staff', 'Director']
const TIME_OPTIONS = [
  { value: '', label: 'Time posted' },
  { value: 'today', label: 'Today' },
  { value: '3days', label: 'Past 3 days' },
  { value: 'week', label: 'Past week' },
  { value: '2weeks', label: 'Past 2 weeks' },
  // 30 days is the pipeline's cutoff, so this is the widest window that can return
  // anything. Two weeks stays as well — a student who wants only fresh postings
  // shouldn't lose that just because the board now holds more.
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

.jb-hero-wrap { max-width: 900px; margin: 0 auto; padding: 10px 28px 0; }
.jb-hero {
  background: linear-gradient(135deg, #EFF6FF 0%, #F5F3FF 100%);
  border-radius: 12px; padding: 10px 15px;
}
.jb-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.jb-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10.5px; font-weight: 600; letter-spacing: .01em;
  background: #fff; color: var(--blue); border: 1px solid #DBEAFE;
  padding: 4px 10px; border-radius: 100px; box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
.jb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--blue); animation: jbPulse 1.8s ease-in-out infinite; }
@keyframes jbPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.8); } }
@media (prefers-reduced-motion: reduce) { .jb-dot { animation: none; } }
.jb-hero h1 { font-size: clamp(22px, 3vw, 28px); font-weight: 700; letter-spacing: -.03em; line-height: 1.15; margin-bottom: 8px; }
.jb-hero p { font-size: 11.5px; color: var(--muted); max-width: none; line-height: 1.4; }

.jb-filters { max-width: 900px; margin: 14px auto 0; padding: 0 28px; }
.jb-weak {
  background: #F8F6F2; border: 1px solid #F1EDE7; border-radius: 10px;
  padding: 11px 13px; margin-bottom: 10px;
}
.jb-weak h4 { margin: 0; font-size: 13.5px; font-weight: 600; color: #111827; }
.jb-weak p {
  margin: 5px 0 0; font-size: 10.5px; font-weight: 600; color: #6B7280;
  text-transform: uppercase; letter-spacing: .06em;
}
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

.jb-count { display: none; }

/* Shared-link pin. The job opened from ?job=<id> is almost never on page one, so
   it is rendered ABOVE the list instead of being hunted for inside it. Without this
   the right pane showed the correct job while the left pane showed unrelated ones,
   which read as a broken link even though the fetch had worked. */
.jb-shared-pill { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: #1D4ED8; background: #DBEAFE; padding: 3px 9px;
  border-radius: 6px; margin: 0 0 9px 2px; }
.jb-shared-divider { display: flex; align-items: center; gap: 10px; margin: 16px 2px 12px;
  color: #9CA3AF; font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; }
.jb-shared-divider::before, .jb-shared-divider::after { content: ''; height: 1px; background: #ECECEF; flex: 1; }
.jb-list { max-width: 900px; margin: 0 auto; padding: 6px 28px 60px; display: flex; flex-direction: column; gap: 12px; }
.jb-drawer-actions--closed { display: block; }
.jb-closed-bar {
  background: #FDF0F0; border: 1px solid #F5D0D0; border-radius: 10px; padding: 13px 16px;
}
.jb-closed-bar strong { display: block; font-size: 13.5px; font-weight: 600; color: #B02020; margin-bottom: 3px; }
.jb-closed-bar span { font-size: 12.5px; color: #8B4A4A; line-height: 1.5; }

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
.jb-card { position: relative; }
.jb-card-savedtag {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 10px;
  font-size: 11.5px; font-weight: 700; color: #2563EB;
  background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 7px; padding: 4px 9px;
}
.jb-card:hover { border-color: #BFDBFE; box-shadow: 0 6px 20px rgba(37,99,235,.09); transform: translateY(-1px); }
.jb-x {
  position: absolute; top: 8px; right: 8px; width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px; background: transparent; color: #9CA3AF;
  font-size: 16px; line-height: 1; cursor: pointer;
}
.jb-x:hover { background: #F3F4F6; color: #374151; }
.jb-hide-menu {
  position: absolute; top: 36px; right: 8px; z-index: 6;
  background: #fff; border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 4px;
}
.jb-hide-menu button {
  border: none; background: none; font: inherit; font-size: 13px; font-weight: 600;
  color: #B91C1C; padding: 7px 12px; border-radius: 7px; cursor: pointer; white-space: nowrap;
}
.jb-hide-menu button:hover { background: #FEF2F2; }
.jb-save-row { display: flex; justify-content: flex-end; margin-top: 10px; }
.jb-save-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border); background: #fff; border-radius: 8px;
  padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 600;
  color: #374151; cursor: pointer;
}
.jb-save-btn:hover { border-color: #BFDBFE; color: #2563EB; }
.jb-save-btn.on { background: #EFF6FF; border-color: #BFDBFE; color: #2563EB; }
.jb-card-top { display: flex; gap: 14px; }
.jb-logo {
  width: 72px; height: 72px; border-radius: 15px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 28px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25);
}
.jb-logo--img { background: #fff; border: 1px solid var(--line, #E5E7EB); padding: 8px; box-shadow: none; }
@media (max-width: 640px) {
  .jb-logo { width: 56px; height: 56px; font-size: 22px; border-radius: 13px; }
}
.jb-logo--img img { width: 100%; height: 100%; object-fit: contain; display: block; }
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

/* ── Tracker: the applied control in the detail pane, and the card indicator.
   The row only exists once a job has been opened on the employer's site, so it never
   adds height to a job the student has not touched. */
.jb-applied-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 12px; padding: 11px 14px; border-radius: 10px;
  background: #F8FAFC; border: 1px solid var(--border);
}
.jb-applied-txt { font-size: 12.5px; color: var(--muted); flex: 1; min-width: 180px; line-height: 1.45; }
.jb-applied-btn {
  padding: 7px 14px; border-radius: 20px; border: 1px solid var(--border);
  background: #fff; color: var(--body); font-family: inherit; font-weight: 600;
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.jb-applied-btn:hover { border-color: #CBD5E1; color: var(--ink); }
.jb-applied-btn.on { background: #ECFDF5; border-color: #A7F3D0; color: #047857; }

/* Centred, and above the optimize modal on purpose.
   The modal is still open when they come back from the employer — they clicked Apply
   from inside it — so a corner toast would sit behind the resume they were reading and
   be missed. This is the one moment the answer is cheap to give, so it takes the screen. */
.jb-ask-overlay {
  /* Above the optimize modal, which sits at 1000. They clicked Apply from inside it,
     so it is still open behind this — a lower value put the question underneath the
     resume, where it was invisible. */
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; padding: 22px;
  animation: jbFade .18s ease;
}
@keyframes jbFade { from { opacity: 0 } to { opacity: 1 } }
.jb-ask {
  background: #fff; border-radius: 16px; padding: 26px 28px; width: 100%; max-width: 400px;
  box-shadow: 0 24px 60px rgba(15,23,42,.28); text-align: center;
  animation: jbAskIn .22s cubic-bezier(.2,.8,.3,1);
}
@keyframes jbAskIn { from { opacity: 0; transform: translateY(14px) scale(.97) } to { opacity: 1; transform: none } }
.jb-ask h4 { font-size: 18px; font-weight: 600; letter-spacing: -.01em; margin-bottom: 8px; }
.jb-ask p { font-size: 13px; color: var(--muted); line-height: 1.6; margin-bottom: 20px; }
.jb-ask-btns { display: flex; gap: 9px; }
.jb-ask-yes, .jb-ask-no {
  flex: 1; font-family: inherit; font-size: 13.5px; font-weight: 600; padding: 11px 16px;
  border-radius: 10px; cursor: pointer; border: 1px solid var(--border); background: #fff; color: var(--body);
}
.jb-ask-yes { background: var(--blue); border-color: var(--blue); color: #fff; }
.jb-ask-yes:hover { background: var(--blue-dark); }
.jb-ask-no:hover { background: #F8FAFC; color: var(--ink); }
.jb-ask-yes:focus-visible, .jb-ask-no:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
@media (max-width: 480px) { .jb-ask { padding: 22px 20px; } .jb-ask-btns { flex-direction: column-reverse; } }

.jb-card-tracked {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  margin-top: 9px; padding-top: 9px; border-top: 1px dashed var(--border);
}
.jb-tr { font-size: 11px; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.jb-tr--yes { color: var(--green); }
.jb-tr--plain { color: #B45309; font-weight: 500; }

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
.jb-more { width: 100%; max-width: 320px; padding: 11px 20px !important; font-weight: 600 !important; color: var(--blue) !important; border-color: #DBEAFE !important; background: var(--blue-soft) !important; }
.jb-more:not(:disabled):hover { border-color: var(--blue) !important; }
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
.jb-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: var(--ink); color: #fff; padding: 10px 18px; border-radius: 9px;
  font-size: 13px; font-weight: 500; z-index: 60; box-shadow: 0 6px 20px rgba(0,0,0,.18);
}
.jb-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.jb-head-text { min-width: 0; }
.jb-head-actions { display: flex; gap: 6px; flex-shrink: 0; }
.jb-btn-ghost--on { background: #EFF6FF; border-color: #BFDBFE; color: #2563EB; }
.jb-btn-ghost {
  border: 1px solid var(--border); background: #fff; color: var(--body);
  border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap;
}
.jb-btn-ghost:hover { border-color: #C7D2E0; }
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
/* Companies mark section headings every which way — <h1>..<h6>, or a paragraph whose
   whole content is bold (<strong> or <b>). Style them all identically, otherwise the
   same posting shows some headings blue and others plain black. */
/* Every heading renders the same: plain bold dark text. Companies write headings a
   dozen different ways (<h2>, fully-bold paragraph, bold text with the colon OUTSIDE
   the bold tag...), and each attempt to style "real" headings blue left some blue and
   some black in the same posting. One uniform style can't be inconsistent. */
.jb-desc .jb-h, .jb-desc .jb-h > strong, .jb-desc .jb-h > b {
  display: block; color: var(--ink); font-weight: 700; margin: 16px 0 4px; line-height: 1.4;
}
.jb-desc .jb-h:first-child { margin-top: 0; }
.jb-desc .jb-h > strong, .jb-desc .jb-h > b { margin: 0; display: inline; }
  .jb-desc-loading { padding: 40px 28px; text-align: center; color: var(--muted); }
.jb-locpick { padding: 12px 28px 0; }
.jb-locpick-label { font-size: 11.5px; color: var(--muted); margin-bottom: 7px; }
.jb-locpick-row { display: flex; gap: 6px; flex-wrap: wrap; }
.jb-locpick-btn {
  font-size: 11.5px; padding: 5px 11px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--border); background: #fff; color: var(--body); font-family: inherit;
}
.jb-locpick-btn:hover { border-color: #C7D2E0; }
.jb-locpick-btn.on { background: var(--blue-soft); border-color: #DBEAFE; color: var(--blue); font-weight: 600; }

@media (max-width: 560px) {
  .jb-nav-links a:not(.jb-nav-jobs) { display: none; }
  .jb-search { flex-direction: column; }
  .jb-pills, .jb-card-foot { padding-left: 0; }
  .jb-card-top { flex-direction: column; }
}

/* ── Two-pane layout (desktop ≥1100px) ──────────────────────────────────────
   The page becomes a fixed-height app region: hero + filters on top, then the job
   list (left) and the full description (right) fill the rest of the screen and
   scroll INDEPENDENTLY. Below 1100px this all switches off and the original
   slide-in drawer is used, because two panes do not fit on a narrow screen. */
.jb-detail-col { display: none; }
.jb-detail-empty { display: flex; align-items: center; justify-content: center;
  height: 100%; padding: 40px; text-align: center; color: #9CA3AF; font-size: 14px; }

@media (min-width: 1100px) {
  .jb-root { height: 100vh; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

  .jb-hero-wrap, .jb-filters, .jb-count { max-width: 1500px; width: 100%; }
  .jb-hero-wrap { padding: 14px 26px 0; }
  .jb-hero { padding: 10px 15px; }
  .jb-filters { margin: 12px auto 0; padding: 0 26px; }
  .jb-count { padding: 10px 26px 2px; }

  .jb-panes { flex: 1; min-height: 0; display: flex; gap: 18px;
    width: 100%; max-width: 1500px; margin: 0 auto; padding: 4px 26px 0; }

  .jb-list-col { flex: 0 0 45%; min-width: 0; overflow-y: auto; padding-right: 6px; }
  .jb-list { max-width: none; margin: 0; padding: 4px 0 12px; }
  /* compact job cards so more fit on screen */
  .jb-card { padding: 11px 13px; border-radius: 11px; margin-bottom: 8px; }
  .jb-card h3 { font-size: 13.5px; line-height: 1.3; }
  .jb-card .co { font-size: 11.5px; }
  .jb-logo { width: 56px; height: 56px; font-size: 22px; border-radius: 13px; }
  .jb-card-top { gap: 10px; }
  .jb-pills { gap: 5px; margin: 8px 0 0; padding-left: 44px; }
  .jb-pill { font-size: 10.5px; padding: 3px 8px; }
  .jb-card-foot { margin-top: 9px; padding-top: 9px; padding-left: 44px; }
  .jb-posted { font-size: 10.5px; }
  .jb-btn-opt, .jb-btn-apply { font-size: 11.5px; padding: 6px 11px; }

  /* tighter filters + count */
  .jb-search { gap: 8px; margin-bottom: 8px; }
  .jb-search input { padding: 8px 12px; font-size: 12.5px; border-radius: 9px; }
  .jb-search button { padding: 8px 18px; font-size: 12.5px; border-radius: 9px; box-shadow: 0 2px 8px rgba(37,99,235,.22); }
  .jb-dropdowns { gap: 7px; }
  .jb-dropdowns select { padding: 8px 12px; font-size: 12.5px; }

  .jb-filters { margin: 9px auto 0; }
  .jb-card.sel { border-color: var(--blue); background: #F8FBFF;
    box-shadow: 0 3px 14px rgba(37,99,235,.10); }
  .jb-card.sel:hover { transform: none; }
  .jb-pager { max-width: none; margin: 0; padding: 0 0 20px; }

  .jb-detail-col { display: block; flex: 1; min-width: 0; overflow-y: auto;
    background: #fff; border: 1px solid var(--border); border-radius: 14px;
    margin-bottom: 14px; }
  .jb-detail-col .jb-close { display: none; }
  .jb-detail-col .jb-drawer-head { padding: 14px 20px 10px; }
  .jb-detail-col .jb-drawer-head h2 { margin-right: 0; font-size: 16.5px; margin-bottom: 3px; }
  .jb-detail-col .jb-drawer-head .co { font-size: 12px; }
  .jb-detail-col .jb-drawer-head .loc { font-size: 11px; margin-top: 4px; }
  .jb-detail-col .jb-drawer-actions { padding: 10px 20px; gap: 8px; top: 66px; }
  .jb-detail-col .jb-locpick { padding: 10px 20px 0; }
  .jb-detail-col .jb-drawer-actions .jb-btn-opt,
  .jb-detail-col .jb-drawer-actions .jb-btn-apply { padding: 9px; font-size: 12.5px; }

  /* smaller, tighter description so much more of the job fits on screen */
  .jb-detail-col .jb-desc { padding: 14px 20px 24px; font-size: 12px; line-height: 1.55; }
  .jb-detail-col .jb-desc p { margin-bottom: 6px; }
  .jb-detail-col .jb-desc li { margin-bottom: 4px; }
  .jb-detail-col .jb-desc ul { padding-left: 16px; margin-bottom: 5px; }
  .jb-detail-col .jb-desc .jb-h { margin: 13px 0 3px; }

  /* the mobile drawer never appears in two-pane mode */
  .jb-drawer, .jb-overlay { display: none !important; }
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

// Same role posted in several cities is folded into one card, so the pill reads
// "New York, NY +2 more" instead of the list repeating the job three times.
function locLabel(job) {
  const extra = (job.locationCount || 1) - 1
  return extra > 0 ? `${shortLoc(job.location)} +${extra} more` : shortLoc(job.location)
}

// Company logo with a hard fallback chain: real logo (from the enrichment
// pipeline, hotlinked from the provider CDN) → the same gradient initials
// circle the board always had. The container is fixed-size either way, so a
// missing or slow logo never shifts the card layout. onError covers dead
// domains, blocked hotlinks, and provider outages — the render can fail,
// the card cannot.
function CompanyLogo({ job, closed }) {
  const [broken, setBroken] = useState(false)
  const url = job.brand?.logoUrl
  if (url && !broken && !closed) {
    return (
      <div className="jb-logo jb-logo--img">
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
      </div>
    )
  }
  const initial = job.brand?.initials || (job.company ? job.company[0] : '?')
  if (closed) return <div className="jb-logo jb-logo--closed">{initial}</div>
  return <div className="jb-logo" style={{ background: gradientFor(job.company) }}>{initial}</div>
}

function JobCard({ job, onOpen, selected, tracked, marked, onSave, onHide }) {
  // The x opens a one-item menu rather than hiding immediately: hiding is
  // destructive-ish (the job leaves the board), so it gets a deliberate second
  // click. Menu state is per-card and resets when the card unmounts.
  const [hideMenu, setHideMenu] = useState(false)
  const salary = formatSalary(job.salaryMin, job.salaryMax)
  const years = formatYears(job.yearsMin, job.yearsMax)

  // A job the backend has confirmed is gone from the source. These are normally
  // filtered out of the list, so this only shows for a board loaded before the job
  // closed. Nothing here should be clickable.
  if (job.closed) {
    return (
      <div className="jb-card jb-card--closed">
        <div className="jb-card-top">
          <CompanyLogo job={job} closed />
          <div className="jb-card-head">
            <div>
              <h3>{job.title}</h3>
              <div className="co">{job.company}</div>
            </div>
          </div>
        </div>

        <div className="jb-pills">
          <span className="jb-pill jb-pill--closed">No longer open</span>
          <span className="jb-pill jb-pill--location"><MapPin />{locLabel(job)}</span>
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
    <div className={`jb-card ${selected ? 'sel' : ''}`} onClick={() => onOpen(job)}>
      <button
        className="jb-x" title="Hide options" aria-label="Hide options"
        onClick={(e) => { e.stopPropagation(); setHideMenu(v => !v) }}
      >×</button>
      {hideMenu && (
        <div className="jb-hide-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setHideMenu(false); onHide(job) }}>Hide job</button>
        </div>
      )}
      <div className="jb-card-top">
        <CompanyLogo job={job} />
        <div className="jb-card-head">
          <div>
            <h3>{job.title}</h3>
            {/* "Posted x ago" rides on the company line instead of its own footer row —
                that footer cost a full row on every card, roughly a third of the jobs
                visible on screen. */}
            <div className="co">{job.company} · Posted {timeAgo(job.postedAt)}</div>
          </div>
          {job.sponsorBadge && (
            <span className="jb-sponsor"><CheckCircle2 size={13} /> Sponsors visa</span>
          )}
        </div>
      </div>

      <div className="jb-pills">
        <span className="jb-pill jb-pill--location"><MapPin />{locLabel(job)}</span>
        {job.workType && <span className="jb-pill jb-pill--worktype"><Building2 />{job.workType}</span>}
        {job.experienceLevel && <span className="jb-pill jb-pill--experience"><TrendingUp />{job.experienceLevel}</span>}
        {salary && <span className="jb-pill jb-pill--salary"><DollarSign />{salary}</span>}
        {years && <span className="jb-pill jb-pill--years"><Clock />{years}</span>}
      </div>

      {/* No Optimize/Apply here: both already exist in the detail pane, so a second
          copy on every card was pure duplication. */}

      {/* Applied state. The control that CHANGES it lives in the detail pane, which is
          where the student lands when they come back from the employer's site. This is
          just the reminder they see when scrolling the list days later. */}
      {tracked && (
        <div className="jb-card-tracked">
          {tracked.status === 'applied'
            ? <span className="jb-tr jb-tr--yes"><Check size={11} /> Applied</span>
            : <span className="jb-tr">Opened — not marked applied</span>}
        </div>
      )}
      {marked === 'saved' && (
        <div className="jb-card-savedtag"><Check size={11} /> Saved for later</div>
      )}
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

  // Search and filters live in the URL, so refreshing the page (to check for new
  // openings) keeps what you were looking at, and the link can be shared/bookmarked.
  const [searchParams, setSearchParams] = useSearchParams()
  // A shared link (?job=<id>) should open that posting rather than the top of the
  // board. One-shot: the id is cleared after use so it can't fight the normal
  // auto-select when the user searches or pages.
  const sharedJobId = useRef(searchParams.get('job'))
  // Stays true for the life of the page: the auto-select must never replace a job the
  // user was sent a link to, even after the first page of results arrives.
  const cameFromSharedLink = useRef(Boolean(searchParams.get('job')))

  const [searchInput, setSearchInput] = useState(searchParams.get('query') || '')
  const [query, setQuery] = useState(searchParams.get('query') || '')
  // True when the server found nothing matching the whole query and the list is made up
  // of jobs that share a single word with it. Drives the banner, nothing else.
  const [weakMatch, setWeakMatch] = useState(false)
  const [workType, setWorkType] = useState(searchParams.get('workType') || '')
  const [experienceLevel, setExperienceLevel] = useState(searchParams.get('experienceLevel') || '')
  const [timePosted, setTimePosted] = useState(searchParams.get('timePosted') || '')
  const [stateFilter, setStateFilter] = useState(searchParams.get('state') || '')
  // The board is no longer filtered by field. Instead the student's TARGET ROLE is
  // sent as a ranking hint whenever they have not searched: every job is present, the
  // closest title matches lead. Day still beats relevance, so today's postings come
  // first and the best matches sit at the top of each day.
  const { profile } = useHasResume()
  const targetRole = profile?.targetRole || ''


  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [optimizeJob, setOptimizeJob] = useState(null)

  const [loadingMore, setLoadingMore] = useState(false)
  const [locIndex, setLocIndex] = useState(0)
  const [copiedShare, setCopiedShare] = useState(false)
  // The posting a ?job=<id> link opened, pinned above the list so the left and right
  // panes agree. Null in every normal visit.
  const [sharedJob, setSharedJob] = useState(null)

  // ── Tracker
  //
  // Keyed by jobId so a card can look itself up without scanning an array on every
  // render. Value is the row: { _id, status, optimized }.
  const [apps, setApps] = useState({})
  const { getToken } = useAuth()

  const loadApplications = useCallback(async () => {
    if (!isSignedIn) return
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/applications`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return
      const { applications = [] } = await r.json()
      const byJob = {}
      for (const a of applications) byJob[a.jobId] = a
      setApps(byJob)
    } catch (err) {
      // The board must still work with no tracker. This is an enhancement, not a
      // dependency — a failed fetch here should cost the student nothing.
      console.warn('Could not load applications:', err)
    }
  }, [isSignedIn, getToken])

  useEffect(() => { loadApplications() }, [loadApplications])

  // ── Saved / hidden marks. jobId -> 'saved' | 'hidden'. Same contract as apps:
  // the board must work fully with no marks — a failed fetch costs nothing.
  const [marks, setMarks] = useState({})
  const loadMarks = useCallback(async () => {
    if (!isSignedIn) { setMarks({}); return }
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/me/job-marks`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return
      const data = await r.json()
      const m = {}
      for (const row of data.saved  || []) m[row.jobId] = 'saved'
      for (const row of data.hidden || []) m[row.jobId] = 'hidden'
      setMarks(m)
    } catch (err) {
      console.warn('Could not load job marks:', err)
    }
  }, [isSignedIn, getToken])
  useEffect(() => { loadMarks() }, [loadMarks])

  // Optimistic in both directions; the server write follows. On failure the
  // previous state is restored, so a dead network never eats a card silently.
  async function setJobMark(job, state) {
    if (!isSignedIn) { navigate('/login'); return }
    const prev = marks[job.id]
    // Second tap on Save = unsave.
    const removing = state === 'saved' && prev === 'saved'
    setMarks(m => {
      const n = { ...m }
      if (removing) delete n[job.id]
      else n[job.id] = state
      return n
    })
    try {
      const token = await getToken()
      if (removing) {
        await fetch(`${BACKEND}/me/job-marks/${job.id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        })
      } else {
        await fetch(`${BACKEND}/me/job-marks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jobId: job.id, state }),
        })
      }
    } catch {
      setMarks(m => {
        const n = { ...m }
        if (prev) n[job.id] = prev; else delete n[job.id]
        return n
      })
    }
  }

  // Records an apply made straight from the board, with no optimize step. The row has
  // no resume attached, and the tracker says so rather than pretending otherwise.
  //
  // Not awaited by the link: the posting opens either way. A tracker write must never
  // stand between someone and a job application.
  async function trackDirectApply(job, url, location) {
    if (!isSignedIn) return
    // No optimistic row here: the server records direct applies only when
    // TRACK_DIRECT_APPLIES is on, and drawing a row that the server then refuses would
    // put a state on screen that vanishes on the next refresh.
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jobId: job.id, title: job.title, company: job.company,
          location: location || job.location || '', applyUrl: url,
        }),
      })
      if (r.ok) {
        const { application } = await r.json()
        if (application) setApps(p => ({ ...p, [job.id]: application }))
      }
    } catch (err) {
      console.warn('Could not record this application:', err)
    }
  }

  // ── "Did you apply?" on return
  //
  // Fires when the tab regains focus after the student clicked through to an employer.
  // Asked ONCE per job, and only if they come back within the window.
  //
  // The window is an hour, not a couple of minutes. Filling in a real application form
  // takes ten to thirty minutes, so a short window would fire only for the people who
  // bounced straight off the page — precisely the ones who did NOT apply — and stay
  // silent for everyone who did. It exists to stop the question appearing the next
  // morning, not to catch people quickly.
  const ASK_WINDOW_MS = 60 * 60 * 1000
  const [ask, setAsk] = useState(null)          // { jobId, company }
  const leftAt = useRef({})                     // jobId -> timestamp of the click-through
  const askedFor = useRef(new Set())            // jobs already asked about, once each

  // Called by the optimize modal the moment the student clicks through to apply.
  const pendingCompany = useRef({})
  const armAsk = useCallback((jobId, company) => {
    leftAt.current[jobId] = Date.now()
    if (company) pendingCompany.current[jobId] = company
    loadApplications()
  }, [loadApplications])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      const jobId = Object.keys(leftAt.current).find(id =>
        !askedFor.current.has(id) && now - leftAt.current[id] < ASK_WINDOW_MS)
      if (!jobId) return
      const row = apps[jobId]
      // Nothing to ask about if they already marked it applied. The row itself may not
      // have loaded yet — the company name is kept from the click-through for exactly
      // that case, so a slow /applications response cannot swallow the question.
      if (row && row.status === 'applied') return
      askedFor.current.add(jobId)
      const company = row?.company || pendingCompany.current[jobId] || 'this employer'
      // Short beat only, so it does not paint in the same frame as the tab redrawing.
      setTimeout(() => setAsk({ jobId, company }), 250)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [apps])

  async function answerAsk(yes) {
    const pending = ask
    setAsk(null)
    if (!pending) return
    // "Not yet" deliberately changes nothing. The card keeps its Mark as applied button
    // for as long as they need it, so a wrong tap here costs nothing.
    if (!yes) return

    // Closing is not conditional on the write succeeding. They answered the question;
    // leaving the resume open because a PATCH was slow would make the app feel broken
    // at the exact moment it should feel finished.
    closeOptimize()
    // Move to the next job rather than clearing the pane. Clearing left "Select a job to
    // read the full description" on screen, which reads as having lost your place —
    // the applied job vanishes from the list, so there is nothing obvious to click back to.
    if (selected?.id === pending.jobId) {
      // Continue DOWN the list from where they were, not back to the top. Searching the
      // whole array returns the first result every time, which threw you to the top of
      // the board after each application and lost your place in a list of thousands.
      const at = jobs.findIndex(j => j.id === pending.jobId)
      const usable = j => j && j.id !== pending.jobId && apps[j.id]?.status !== 'applied' && !j.closed
      const next = jobs.slice(at + 1).find(usable)
        // Only if they applied to the last one does it fall back up the list.
        || [...jobs.slice(0, Math.max(at, 0))].reverse().find(usable)
      if (next) openJob(next)
      else setSelected(null)
    }
    try { await toggleApplied(pending.jobId) } catch (err) {
      console.warn('Could not mark applied:', err)
    }
  }

  async function toggleApplied(jobId) {
    let row = apps[jobId]
    // The row may not have arrived yet — /applications is fetched in the background when
    // they click through, and a slow response would otherwise make this a silent no-op.
    // Fetch it directly rather than giving up.
    if (!row?._id) {
      try {
        const token = await getToken()
        const r = await fetch(`${BACKEND}/applications`, { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const { applications = [] } = await r.json()
          const byJob = {}
          for (const a of applications) byJob[a.jobId] = a
          setApps(byJob)
          row = byJob[jobId]
        }
      } catch {}
    }
    if (!row?._id) return
    const next = row.status === 'applied' ? 'opened' : 'applied'
    setApps(prev => ({ ...prev, [jobId]: { ...row, status: next } }))   // optimistic
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/applications/${row._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      })
      if (!r.ok) setApps(prev => ({ ...prev, [jobId]: row }))           // put it back
    } catch {
      setApps(prev => ({ ...prev, [jobId]: row }))
    }
  }

  useEffect(() => {
    const next = {}
    if (query) next.query = query
    if (workType) next.workType = workType
    if (experienceLevel) next.experienceLevel = experienceLevel
    if (timePosted) next.timePosted = timePosted
    if (stateFilter) next.state = stateFilter
    // Keep ?job= until the shared-link effect has used it. This effect runs on mount,
    // before the jobs have loaded, so writing the params immediately would strip the id
    // out of the URL and the shared link would just open the top of the board.
    if (sharedJobId.current) next.job = sharedJobId.current
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, workType, experienceLevel, timePosted, stateFilter])
  const listTop = useRef(null)

  const fetchJobs = useCallback(async () => {
    if (page === 1) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (query.trim()) params.set('query', query.trim())
      if (workType) params.set('workType', workType)
      if (experienceLevel) params.set('experienceLevel', experienceLevel)
      if (timePosted) params.set('time_posted', timePosted)
      if (stateFilter) params.set('state', stateFilter)
      // Ranking hint only, and only when they have not typed their own search.
      if (!query && targetRole) params.set('role', targetRole)

      const res = await fetch(`${BACKEND}/jobs?${params.toString()}`)
      if (!res.ok) throw new Error('bad response')
      const data = await res.json()
      // Page 1 replaces the list (new search/filter); later pages APPEND, so
      // "Load more" genuinely adds to what is already on screen.
      setJobs(prev => (page === 1 ? (data.jobs || []) : [...prev, ...(data.jobs || [])]))
      setTotal(data.total || 0)
      setPages(data.pages || 1)
      setWeakMatch(Boolean(data.weakMatch))
    } catch {
      setError("Couldn't load jobs. The server may be waking up — try again in a few seconds.")
      if (page === 1) setJobs([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [page, query, workType, experienceLevel, timePosted, stateFilter, targetRole])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  function runSearch() {
    setSharedJob(null)
    setPage(1)
    setQuery(searchInput)
  }

  // Each of these clears the pin: once the student runs their own search, a job from
  // someone else's link sitting at the top is just noise.
  function pickWorkType(e) { setSharedJob(null); setPage(1); setWorkType(e.target.value) }
  function pickExperience(e) { setSharedJob(null); setPage(1); setExperienceLevel(e.target.value) }
  function pickTimePosted(e) { setSharedJob(null); setPage(1); setTimePosted(e.target.value) }
  function pickState(e) { setSharedJob(null); setPage(1); setStateFilter(e.target.value) }

  function clearFilters() {
    setSharedJob(null)
    setPage(1)
    setSearchInput('')
    setQuery('')
    setWorkType('')
    setExperienceLevel('')
    setTimePosted('')
    setStateFilter('')
  }

  const hasActiveFilters = query || workType || experienceLevel || timePosted || stateFilter

  // Two panes only exist on wide screens; below that we use the slide-in drawer.
  function isTwoPane() {
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches
  }

  // Keep the right pane filled on desktop: when a new page of results loads, or the
  // current selection is no longer in the list, select the first open job.
  useEffect(() => {
    const id = sharedJobId.current
    if (!id) return
    sharedJobId.current = null
    // Fetch the job directly rather than looking for it in the list: a shared posting
    // is usually not on the first page of results, so searching the list would miss it.
    ;(async () => {
      try {
        const res = await fetch(`${BACKEND}/jobs/${id}`)
        if (!res.ok) return
        const full = await res.json()
        setSelected(full)
        setSharedJob(full)
        setLocIndex(0)
        setCopiedShare(false)
        if (!isTwoPane()) document.body.style.overflow = 'hidden'
      } catch {
        // job gone or backend asleep — fall through to the normal board
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isTwoPane() || !jobs.length) return
    // Don't clobber a job opened from a shared link with the first search result.
    if (cameFromSharedLink.current) { cameFromSharedLink.current = false; return }
    const visible = jobs.filter(j => apps[j.id]?.status !== 'applied' && marks[j.id] !== 'hidden')
    const stillListed = selected && visible.some(j => j.id === selected.id)
    if (!stillListed && visible.length) openJob(visible.find(j => !j.closed) || visible[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  // Share copies a link that reopens THIS job. ?job=<id> is read on load so the
  // recipient lands on the posting, not the top of the board.
  async function shareJob() {
    if (!selected) return
    const url = `${window.location.origin}${window.location.pathname}?job=${selected.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: `${selected.title} at ${selected.company}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
    } catch {
      return   // share sheet dismissed, or clipboard blocked
    }
    setCopiedShare(true)
    setTimeout(() => setCopiedShare(false), 2000)
  }

  async function openJob(job) {
    setSelected(job)
    setLocIndex(0)
    setCopiedShare(false)
    setDetailLoading(true)
    // Only lock the page behind the slide-in drawer. In two-pane mode nothing is
    // covered, so the page must stay usable.
    if (!isTwoPane()) document.body.style.overflow = 'hidden'
    try {
      const res = await fetch(`${BACKEND}/jobs/${job.id}`)
      if (res.ok) {
        const full = await res.json()
        // MERGE, don't replace: /jobs/:id returns one posting and knows nothing about
        // the grouped `locations` the list built, so replacing here would wipe the
        // location picker the instant the description finished loading.
        setSelected(prev => ({ ...prev, ...full, locations: prev?.locations, locationCount: prev?.locationCount }))
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
    // Open the modal in place — no navigation, no lost job.
    //
    // The selected job is NOT cleared. It used to be, which meant closing the modal
    // dropped you on an empty pane reading "Select a job" — the job you had just been
    // reading, gone. On mobile the detail drawer is a full-screen overlay that would
    // sit behind the modal, so that one is still closed; on desktop the detail is a
    // pane and there is nothing to hide.
    if (selected && window.innerWidth < 1100) closeJob()
    setOptimizeJob(job)
    document.body.style.overflow = 'hidden'
  }

  function closeOptimize() {
    setOptimizeJob(null)
    document.body.style.overflow = ''
  }

  // "Load more" appends the next page; the list keeps its scroll position.
  function loadMore() {
    if (page < pages && !loadingMore) setPage(page + 1)
  }

  // Companies mark section headings inconsistently — <h2>, <h4>, a fully-bold
  // paragraph, sometimes with a stray <br> or &nbsp; inside. CSS selectors can't cover
  // every shape (":only-child" breaks the moment a <br> sneaks in), which left some
  // headings blue and others plain black in the same posting. So we detect them in
  // code: any short block whose visible text is ENTIRELY bold is a heading, and gets
  // one class the CSS can style. Also strips leftover ATS tracking tags like "#LI-JCS".
  function markHeadings(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => el.classList.add('jb-h'))
      doc.querySelectorAll('p,div').forEach(el => {
        if (el.querySelector('p,div,ul,ol,li,table')) return          // container, not a heading
        const text = (el.textContent || '').replace(/\u00a0/g, ' ').trim()
        if (!text || text.length > 120) return
        const bold = Array.from(el.querySelectorAll('strong,b'))
          .map(b => (b.textContent || '').replace(/\u00a0/g, ' ').trim())
          .join(' ')
          .trim()
        // every visible character is inside a <strong>/<b> → it's a heading
        if (bold && bold.replace(/\s+/g, '') === text.replace(/\s+/g, '')) el.classList.add('jb-h')
      })
      // ATS tracking tags ("#LI-JCS") are noise for a student reading the posting
      doc.querySelectorAll('p,div,span').forEach(el => {
        if (/^#LI-[A-Za-z0-9-]+$/.test((el.textContent || '').trim())) el.remove()
      })
      return doc.body.innerHTML
    } catch {
      return html
    }
  }

  const safeDescription = selected?.description
    ? markHeadings(DOMPurify.sanitize(selected.description))
    : ''

  // A grouped job carries every location it was posted in. The student picks one and
  // the Apply link switches to THAT posting — applying to the wrong city would be a
  // silent failure, so the choice has to drive the link, not just the label.
  const variants = selected?.locations?.length ? selected.locations : null
  const chosen = variants ? (variants[locIndex] || variants[0]) : null
  const applyUrl = chosen?.applyUrl || selected?.applyUrl
  const shownLocation = chosen?.location || selected?.location

  const detailBody = selected && (
    <>
      <div className="jb-drawer-head">
        <button className="jb-close" onClick={closeJob}>×</button>
        <div className="jb-head-row">
          <div className="jb-head-text">
            <h2>{selected.title}</h2>
            <div className="co">{selected.company}</div>
            <div className="loc">{shortLoc(shownLocation)} · {timeAgo(selected.postedAt)}</div>
          </div>
          <div className="jb-head-actions">
            <button
              className={`jb-btn-ghost ${marks[selected.id] === 'saved' ? 'jb-btn-ghost--on' : ''}`}
              onClick={() => setJobMark(selected, 'saved')}
            >
              {marks[selected.id] === 'saved' ? '✓ Saved' : 'Save for later'}
            </button>
            <button className="jb-btn-ghost" onClick={shareJob}>
              {copiedShare ? '✓ Copied' : '↗ Share'}
            </button>
          </div>
        </div>
      </div>
      {variants && variants.length > 1 && (
        <div className="jb-locpick">
          <div className="jb-locpick-label">Posted in {variants.length} locations — pick one to apply</div>
          <div className="jb-locpick-row">
            {variants.map((v, i) => (
              <button
                key={v.id || i}
                className={`jb-locpick-btn ${i === locIndex ? 'on' : ''}`}
                onClick={() => setLocIndex(i)}
              >
                {shortLoc(v.location)}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* The detail route re-checks this posting against Greenhouse on every open, so
          `closed` here is live rather than however stale the last pipeline run left it.
          It used to be fetched and then ignored, which is how a job that shut this
          morning still offered a working Apply button — and worse, an Optimize button,
          which costs a paid rewrite and a minute of someone's time before they find out. */}
      {selected.closed ? (
        <div className="jb-drawer-actions jb-drawer-actions--closed">
          <div className="jb-closed-bar">
            <strong>This posting has closed.</strong>
            <span>The employer took it down since we last checked. It drops off the board on the next refresh.</span>
          </div>
        </div>
      ) : (
        <div className="jb-drawer-actions">
          <button className="jb-btn-opt" onClick={() => optimizeFor(selected)}>
            <Sparkles size={14} /> Optimize my resume
          </button>
          <a
            className="jb-btn-apply"
            href={applyUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackDirectApply(selected, applyUrl, shownLocation)}
          >Apply →</a>
        </div>
      )}

      {/* Appears only after they have clicked through. This is the whole reason the
          control lives in the detail pane and not the tracker: the student comes back
          from the employer's tab to exactly this view, so marking it is one tap with
          no navigation. */}
      {apps[selected.id] && (
        <div className="jb-applied-row">
          <span className="jb-applied-txt">
            {apps[selected.id].status === 'applied'
              ? 'You marked this applied.'
              : `Opened on ${selected.company}'s site — we can't tell whether you submitted.`}
          </span>
          <button
            className={`jb-applied-btn ${apps[selected.id].status === 'applied' ? 'on' : ''}`}
            onClick={() => toggleApplied(selected.id)}
          >
            {apps[selected.id].status === 'applied' ? '✓ Applied' : 'Mark as applied'}
          </button>
        </div>
      )}
      {detailLoading ? (
        <div className="jb-desc-loading">Loading full description…</div>
      ) : (
        <div className="jb-desc" dangerouslySetInnerHTML={{ __html: safeDescription || 'No description available.' }} />
      )}
    </>
  )

  const pageContent = (
    <div className="jb-root">
      <style>{CSS}</style>

      {!isSignedIn && (
        <nav className="jb-nav">
          <div className="jb-nav-logo" onClick={() => navigate('/')}>Optyply</div>
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
          <p>We hide roles requiring US citizenship, security clearances, or that refuse visa sponsorship — always confirm sponsorship with the employer.</p>
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
      ) : (jobs.length === 0 && !sharedJob) ? (
        <div className="jb-state">
          <h3>No jobs match that search</h3>
          <p>Try a different keyword or clear your filters.</p>
        </div>
      ) : (
        <div className="jb-panes">
          <div className="jb-list-col">
            {/* Nothing matched the query as a whole. The jobs below are the best the
                board has, but calling them results for what was typed would be false —
                so the list gets a heading that says what it actually is. */}
            {weakMatch && query && !sharedJob && (
              <div className="jb-weak">
                <h4>No exact matches for “{query}” right now.</h4>
                <p>Roles that share words with your search</p>
              </div>
            )}
            <div className="jb-list">
              {sharedJob && (
                <>
                  <span className="jb-shared-pill">Shared with you</span>
                  <JobCard
                    tracked={apps[sharedJob.id]}
                    job={sharedJob}
                    onOpen={openJob}
                    selected={selected?.id === sharedJob.id}
                    marked={marks[sharedJob.id]}
                    onSave={(j) => setJobMark(j, 'saved')}
                    onHide={(j) => setJobMark(j, 'hidden')}
                  />
                  <div className="jb-shared-divider">All jobs</div>
                </>
              )}
              {/* Skip the pinned job if it also happens to be in this page of
                  results, otherwise the same card appears twice.

                  Applied jobs leave the board. Not deleted — the row is in the tracker
                  with the resume that was sent, and switching it back to "Opened" there
                  returns it here. That is the way back from a wrong tap. */}
              {jobs
                .filter(job => job.id !== sharedJob?.id)
                .filter(job => apps[job.id]?.status !== 'applied')
                .filter(job => marks[job.id] !== 'hidden')
                .map(job => (
                <JobCard
                  tracked={apps[job.id]} key={job.id}
                  job={job}
                  onOpen={openJob}
                  selected={selected?.id === job.id}
                  marked={marks[job.id]}
                  onSave={(j) => setJobMark(j, 'saved')}
                  onHide={(j) => setJobMark(j, 'hidden')}
                />
              ))}
            </div>

            <div className="jb-pager">
              {page < pages ? (
                <button className="jb-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more jobs'}
                </button>
              ) : (
                <span className="pg">That's all {total.toLocaleString()} jobs</span>
              )}
            </div>
          </div>

          <aside className="jb-detail-col">
            {selected ? detailBody : (
              <div className="jb-detail-empty">Select a job to read the full description.</div>
            )}
          </aside>
        </div>
      )}

      <div className={`jb-overlay ${selected ? 'open' : ''}`} onClick={closeJob} />
      {copiedShare && <div className="jb-toast">Link copied</div>}

      <aside className={`jb-drawer ${selected ? 'open' : ''}`}>
        {detailBody}
      </aside>

      {ask && (
        // Backdrop does not dismiss. A stray click behind the dialog would answer
        // nothing and lose the question, and this is the one moment it is worth asking.
        <div className="jb-ask-overlay">
          <div className="jb-ask" role="dialog" aria-modal="true" aria-label="Did you apply?">
            <h4>Did you finish applying to {ask.company}?</h4>
            <p>Only you know this — we can't see what happens on the employer's site.</p>
            <div className="jb-ask-btns">
              <button className="jb-ask-no" onClick={() => answerAsk(false)}>Not yet</button>
              <button className="jb-ask-yes" onClick={() => answerAsk(true)} autoFocus>Yes, I applied</button>
            </div>
          </div>
        </div>
      )}

      {optimizeJob && (
        <OptimizeModal job={optimizeJob} onClose={closeOptimize} onApplied={armAsk} />
      )}
    </div>
  )

  return isSignedIn ? <SidebarLayout>{pageContent}</SidebarLayout> : pageContent
}
