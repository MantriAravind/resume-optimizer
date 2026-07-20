import { useNavigate, useLocation } from 'react-router-dom'
import { UserButton, useUser } from '@clerk/clerk-react'
import { Briefcase, User, FileText, Calendar, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { icon: Briefcase, label: 'Job Board',   path: '/jobs', available: true },
  { icon: User,      label: 'Profile',     path: '/profile', available: true },
  { icon: FileText,  label: 'Resume Tool', path: '/app', available: true },
  { icon: Calendar,  label: 'Tracker',     path: '/tracker', available: false },
  { icon: Settings,  label: 'Settings',    path: '/settings', available: false },
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
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh;
}
.sl-brand {
  display: flex; align-items: center; gap: 9px; padding: 20px 18px 22px;
  font-weight: 700; font-size: 18px; letter-spacing: -.02em; cursor: pointer;
}
.sl-brand-mark { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg,#2563EB,#7C3AED); flex-shrink: 0; }

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

@media (max-width: 820px) {
  .sl-sidebar { width: 68px; }
  .sl-brand span, .sl-item span, .sl-plan, .sl-user-info { display: none; }
  .sl-brand { justify-content: center; padding: 20px 0 22px; }
  .sl-item { justify-content: center; }
  .sl-user { justify-content: center; }
}
`

export default function SidebarLayout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useUser()

  const firstName = user?.firstName || user?.username || 'there'

  return (
    <div className="sl-root">
      <style>{CSS}</style>

      <aside className="sl-sidebar">
        <div className="sl-brand" onClick={() => navigate('/')}>
          <div className="sl-brand-mark" />
          <span>ResumeAI</span>
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