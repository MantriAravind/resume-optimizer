import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { UserButton, useUser } from '@clerk/clerk-react'
import { Briefcase, User, FileText, Calendar, ChevronsLeft, ChevronsRight, HelpCircle } from 'lucide-react'

const NAV_ITEMS = [
  { icon: Briefcase, label: 'Job Board',   path: '/jobs', available: true },
  { icon: User,      label: 'Profile',     path: '/profile', available: true },
  // Hidden until after launch. The /app route still exists and still works — this
  // only removes it from the sidebar, so nothing has to be rebuilt to bring it back.
  // The board's own "Optimize my resume" button opens a modal and is unaffected.
  // { icon: FileText,  label: 'Resume Tool', path: '/app', available: true },
  { icon: Calendar,  label: 'Tracker',     path: '/tracker', available: true },
  { icon: HelpCircle, label: 'Support',     path: '/support', available: true },
  // Settings removed, not hidden. Every field it would have held already has a home:
  // account, email, devices and account deletion are Clerk's UserButton menu (Manage
  // account); the resume lives on Profile; role, work type and state are the board's
  // own filter row. The only field left was work authorization, and that currently
  // changes nothing — the job filter treats every user identically. It comes back the
  // day that field does something real.
]

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

.sl-root {
  --blue: #2563EB; --blue-dark: #1D4ED8; --blue-soft: #EFF6FF; --violet: #7C3AED;
  --ink: #0A0A0B; --body: #374151; --muted: #6B7280; --border: #EEF2F6; --green: #059669;
  font-family: 'Space Grotesk', -apple-system, sans-serif;
  display: flex; min-height: 100vh; background: #fff; color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
.sl-root * { box-sizing: border-box; }

.sl-sidebar {
  width: 232px; flex-shrink: 0; border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 30; background: #fff;
  transition: width .18s ease;
}
/* The sidebar is fixed, so the page content is pushed over by the same width. */
.sl-content { margin-left: 232px; transition: margin-left .18s ease; }
.sl-collapsed .sl-content { margin-left: 74px; }

.sl-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 20px 14px 20px;
}
.sl-brand {
  display: flex; align-items: center; gap: 9px; min-width: 0;
  font-weight: 700; font-size: 18px; letter-spacing: -.02em; cursor: pointer;
}
.sl-brand span { white-space: nowrap; overflow: hidden; }
.sl-brand-mark { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg,#2563EB,#7C3AED); flex-shrink: 0; }

.sl-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; flex-shrink: 0; padding: 0;
  border: none; background: none; border-radius: 8px;
  color: var(--muted); cursor: pointer; font-family: inherit;
}
.sl-toggle svg { width: 18px; height: 18px; }
.sl-toggle:hover { background: #F8FAFC; color: var(--ink); }

.sl-nav { flex: 1; padding: 0 12px; overflow-y: auto; }
.sl-item {
  display: flex; align-items: center; gap: 12px; padding: 11px 12px;
  border-radius: 10px; font-size: 14px; font-weight: 500; color: var(--muted);
  cursor: pointer; margin-bottom: 3px; border: none; background: none;
  width: 100%; text-align: left; font-family: inherit;
}
.sl-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.sl-item.active { background: var(--blue-soft); color: var(--blue); font-weight: 600; }
.sl-item:not(.active):not(.disabled):hover { background: #F8FAFC; color: var(--ink); }
.sl-item.disabled { cursor: default; color: #B4BCC8; }
.sl-soon {
  font-size: 9.5px; font-weight: 700; background: #F1F5F9; color: #94A3B8;
  padding: 2px 6px; border-radius: 100px; margin-left: auto; letter-spacing: .02em;
}

.sl-foot { padding: 14px 12px; border-top: 1px solid var(--border); }
.sl-plan {
  background: linear-gradient(135deg, #EFF6FF, #F5F3FF); border-radius: 12px;
  padding: 13px 14px; margin-bottom: 10px;
}
.sl-plan-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.sl-plan-name { font-size: 15px; font-weight: 700; color: var(--ink); margin: 2px 0 8px; }
.sl-plan-btn {
  display: block; width: 100%; text-align: center; background: var(--blue);
  color: #fff; font-size: 12px; font-weight: 700; padding: 8px; border-radius: 8px;
  border: none; cursor: pointer; font-family: inherit;
}
.sl-plan-btn:hover { background: var(--blue-dark); }

.sl-user { display: flex; align-items: center; gap: 10px; padding: 8px 6px; }
.sl-user-info { flex: 1; min-width: 0; }
.sl-user-name { font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sl-user-plan { font-size: 11px; color: var(--muted); }

.sl-content { flex: 1; min-width: 0; overflow-x: hidden; }

/* ---- Manually collapsed (toggle button) ---- */
.sl-collapsed .sl-sidebar { width: 74px; }
/* Keep the logo and the toggle side by side on one row, even when collapsed. */
.sl-collapsed .sl-header { justify-content: center; padding: 18px 4px 20px; gap: 5px; }
.sl-collapsed .sl-brand { justify-content: center; }
.sl-collapsed .sl-brand-mark { width: 27px; height: 27px; }
.sl-collapsed .sl-toggle { width: 27px; height: 27px; }
.sl-collapsed .sl-toggle svg { width: 16px; height: 16px; }
.sl-collapsed .sl-brand span { display: none; }
.sl-collapsed .sl-item { justify-content: center; }
.sl-collapsed .sl-item span { display: none; }
.sl-collapsed .sl-soon { display: none; }
.sl-collapsed .sl-plan { display: none; }
.sl-collapsed .sl-user { justify-content: center; }
.sl-collapsed .sl-user-info { display: none; }

/* ---- Auto-collapse on small screens (always icon-only; hide the manual toggle) ---- */
@media (max-width: 820px) {
  .sl-sidebar { width: 68px; }
  .sl-header { flex-direction: column; justify-content: center; padding: 18px 0 20px; gap: 12px; }
  .sl-brand span, .sl-item span, .sl-soon, .sl-plan, .sl-user-info { display: none; }
  .sl-brand { justify-content: center; }
  .sl-item { justify-content: center; }
  .sl-user { justify-content: center; }
  .sl-toggle { display: none; }
}
`

export default function SidebarLayout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useUser()
  // Starts COLLAPSED by default — the sidebar only opens when the user asks for it.
  // The choice is remembered so it does not snap shut every time you change page
  // (this component remounts on navigation, which would otherwise reset it).
  // Every page should open at the top, not wherever the previous page was scrolled to.
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sl-collapsed') !== 'false' } catch { return true }
  })

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sl-collapsed', String(next)) } catch {}
      return next
    })
  }

  const firstName = user?.firstName || user?.username || 'there'

  return (
    <div className={`sl-root ${collapsed ? 'sl-collapsed' : ''}`}>
      <style>{CSS}</style>

      <aside className="sl-sidebar">
        <div className="sl-header">
          <div className="sl-brand" onClick={() => navigate('/')}>
            <div className="sl-brand-mark" />
            <span>Optyply</span>
          </div>
          <button
            className="sl-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </button>
        </div>

        <nav className="sl-nav">
          {NAV_ITEMS.map(item => {
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.label}
                className={`sl-item ${isActive ? 'active' : ''} ${!item.available ? 'disabled' : ''}`}
                onClick={() => item.available && navigate(item.path)}
                disabled={!item.available}
                title={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
                {!item.available && <span className="sl-soon">Soon</span>}
              </button>
            )
          })}
        </nav>

        <div className="sl-foot">
          <div className="sl-plan">
            <div className="sl-plan-label">Current plan</div>
            <div className="sl-plan-name">Free</div>
            <button className="sl-plan-btn" onClick={() => navigate('/pricing')}>Upgrade to Pro</button>
          </div>
          <div className="sl-user">
            <UserButton afterSignOutUrl="/" />
            <div className="sl-user-info">
              <div className="sl-user-name">{firstName}</div>
              <div className="sl-user-plan">Free plan</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="sl-content">
        {children}
      </div>
    </div>
  )
}

