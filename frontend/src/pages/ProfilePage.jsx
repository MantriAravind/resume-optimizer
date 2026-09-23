import { useState, useEffect, useRef } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import SidebarLayout from '../components/SidebarLayout'
import { FileText, Check, AlertCircle, RotateCcw, X, ArrowRight, Pencil, Eye, CircleCheck, ArrowUp, ArrowDown } from 'lucide-react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'
const MAX_BYTES = 10 * 1024 * 1024

// Contact is ONE structured source of truth (developer decision 2026-09-20): these
// fields fill the account profile AND the server derives the resume's contact line
// from them on every save (Location | Phone | Email | LinkedIn | GitHub | Portfolio,
// empties skipped). The resume contact email is separate from the Clerk login email.
const CONTACT_FIELDS = [
  ['firstName', 'First name', true],
  ['lastName', 'Last name', true],
  ['location', 'Location'],
  ['phone', 'Phone', true],
  ['email', 'Resume contact email', true],
  ['linkedin', 'LinkedIn'],
  ['github', 'GitHub'],
  ['portfolio', 'Portfolio / personal website'],
]

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
.pf{--blue:#2563EB;--blue-dark:#1D4ED8;--blue-soft:#EEF4FF;--ink:#0A0A0B;--muted:#6B7280;--border:#E5E7EB;
  --red:#DC2626;--green:#159B69;--green-soft:#ECFBF5;--surface2:#F8FAFC;
  font-family:'Space Grotesk',-apple-system,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.pf *{box-sizing:border-box;margin:0;padding:0}

.pf-banner{display:flex;gap:10px;align-items:center;padding:11px 26px;background:#FFFBEB;
  border-bottom:1px solid #FDE68A;font-size:12.5px;color:#78350F;line-height:1.5}
.pf-banner svg{width:15px;height:15px;flex:none}

.pf-htop{padding:17px 26px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.pf-goboard{background:var(--blue);color:#fff;border:0;padding:9px 18px;border-radius:9px;
  font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;
  align-items:center;gap:7px;flex:none;white-space:nowrap}
.pf-goboard:hover{background:var(--blue-dark)}
.pf-goboard svg{width:15px;height:15px}
.pf-htop h1{font-size:21px;font-weight:800;letter-spacing:-.025em}
.pf-htop p{font-size:12.5px;color:var(--muted);margin-top:2px}

.pf-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin:14px 26px 0;overflow-x:auto}
.pf-tab{background:none;border:0;border-bottom:2px solid transparent;padding:11px 14px;
  font-size:13px;font-weight:650;color:var(--muted);cursor:pointer;font-family:inherit;white-space:nowrap}
.pf-tab:hover{color:var(--ink)}
.pf-tab.on{color:var(--blue);border-bottom-color:var(--blue)}

.pf-body{padding:18px 26px 44px}
.pf-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,.85fr);gap:16px;align-items:start}
.pf-stack{display:grid;gap:16px}
.pf-card{background:#fff;border:1px solid var(--border);border-radius:13px;padding:18px;box-shadow:0 8px 24px rgba(21,32,51,.05)}
.pf-chead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
.pf-eyebrow{text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-size:10.5px;font-weight:700;margin-bottom:5px}
.pf-card h2{font-size:16px;font-weight:700}
.pf-card h3{font-size:14px;font-weight:700}
.pf-sub{color:var(--muted);font-size:12.5px;line-height:1.5}

.pf-identity{display:grid;grid-template-columns:52px 1fr auto;gap:13px;align-items:center}
.pf-avatar{width:52px;height:52px;border-radius:50%;background:var(--blue-soft);color:var(--blue);
  display:grid;place-items:center;font-weight:800;font-size:17px}
.pf-role{margin-top:3px;color:var(--muted);font-size:12.5px}
.pf-status{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 10px;font-size:11px;
  font-weight:700;background:var(--green-soft);color:var(--green)}
.pf-status.warn{background:#FFFBEB;color:#92400E}
.pf-status svg{width:13px;height:13px}
.pf-cline{display:flex;gap:14px;flex-wrap:wrap;margin-top:13px;color:var(--muted);font-size:12px}

.pf-frow2{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:12px;padding:13px;
  background:var(--surface2);border-radius:11px}
.pf-fico{width:42px;height:42px;border-radius:9px;background:var(--blue-soft);color:var(--blue);display:grid;place-items:center}
.pf-fico svg{width:19px;height:19px}
.pf-fname{font-weight:650;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-fmeta{font-size:11px;color:var(--muted);margin-top:3px}
.pf-notice{margin-top:12px;padding:10px 12px;border-radius:9px;background:var(--blue-soft);color:#244A93;font-size:12px;line-height:1.5}

.pf-btn{border:1px solid var(--border);background:#fff;color:var(--ink);border-radius:9px;padding:8px 13px;
  display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;font-weight:650;
  font-size:12.5px;font-family:inherit;white-space:nowrap}
.pf-btn svg{width:14px;height:14px}
.pf-btn:hover{border-color:var(--blue);color:var(--blue)}
.pf-btn.primary{background:var(--blue);color:#fff;border-color:var(--blue)}
.pf-btn.primary:hover{background:var(--blue-dark);color:#fff}
.pf-btn.ghost{border-color:transparent;color:var(--muted)}
.pf-btn.ghost:hover{color:var(--blue)}
.pf-btn:disabled{opacity:.55;cursor:default}
.pf-actions{display:flex;gap:8px;flex-wrap:wrap}

.pf-checklist{display:grid;gap:12px}
.pf-check{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;font-weight:600}
.pf-check svg{width:16px;height:16px;color:var(--green);flex:none;margin-top:1px}
.pf-check.pend svg{color:var(--muted)}
.pf-check small{display:block;color:var(--muted);font-size:11px;font-weight:500;margin-top:2px}

.pf-rlayout{display:grid;grid-template-columns:218px minmax(0,1fr);gap:16px;align-items:start}
.pf-snav{background:#fff;border:1px solid var(--border);border-radius:13px;padding:8px;display:grid;gap:3px;position:sticky;top:14px}
.pf-snav button{border:0;background:transparent;color:var(--muted);border-radius:8px;padding:10px 11px;text-align:left;
  display:flex;justify-content:space-between;gap:10px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:inherit}
.pf-snav button.on{background:var(--blue-soft);color:var(--blue);font-weight:700}
.pf-snav em{font-style:normal;color:var(--green)}

.pf-fld{margin-bottom:11px}
.pf-fld label{display:block;font-size:10.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.pf-fld input,.pf-fld textarea{width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 11px;
  font-size:13px;font-family:inherit;color:var(--ink);background:#fff}
.pf-fld input:focus,.pf-fld textarea:focus{outline:none;border-color:var(--blue)}
.pf-fld input.needed{border-color:#FCA5A5;background:#FFFBFA}
.pf-fld input.invalid{border-color:var(--red);background:#FFF8F8}
.pf-fielderr{font-size:11px;color:var(--red);margin-top:4px;line-height:1.4}
.pf-note{background:#FFF8E6;border:1px solid #F5D77E;border-radius:8px;padding:9px 12px;font-size:12.5px;color:#7A5D00;margin-bottom:10px;line-height:1.45}
.pf-leave-overlay{position:fixed;inset:0;background:rgba(10,10,11,.45);z-index:60;display:flex;align-items:center;justify-content:center}
.pf-leave-box{background:#fff;border-radius:14px;padding:22px 24px;max-width:420px;width:calc(100% - 40px);box-shadow:0 18px 50px rgba(0,0,0,.25)}
.pf-leave-box h3{margin:0 0 6px;font-size:16.5px}
.pf-leave-box p{margin:0 0 16px;font-size:13.5px;color:var(--body);line-height:1.5}
.pf-leave-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.pf-ack-list{margin:0 0 16px;padding-left:18px;font-size:13px;color:#7A5D00;line-height:1.5}
.pf-ack-list li{margin-bottom:6px}
.pf-snav .pf-needs{color:#B45309;font-style:normal;font-weight:800}
.pf-fgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 13px}
.pf-req{color:var(--red);margin-left:2px}

.pf-entry{padding:14px 0;border-top:1px solid var(--border)}
.pf-entry:first-of-type{border-top:0;padding-top:0}
.pf-etop{display:flex;justify-content:space-between;gap:10px}
.pf-etitle{font-size:13.5px;font-weight:700}
.pf-emeta{font-size:12px;color:var(--muted);margin-top:2px}
.pf-ebullets{margin:9px 0 0 17px;display:grid;gap:5px}
.pf-ebullets li{font-size:12.5px;color:#374151;line-height:1.55}
.pf-eform{background:var(--surface2);border:1px solid var(--border);border-radius:11px;padding:13px;margin-top:11px}
.pf-brow{display:flex;gap:7px;margin-bottom:7px;align-items:flex-start}
.pf-brow textarea{flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12.5px;
  font-family:inherit;line-height:1.5;resize:vertical;min-height:38px;background:#fff}
.pf-brow textarea:focus{outline:none;border-color:var(--blue)}
.pf-ib{background:#fff;border:1px solid var(--border);border-radius:7px;width:28px;height:28px;display:grid;
  place-items:center;cursor:pointer;color:var(--muted);flex:none}
.pf-ib svg{width:13px;height:13px}
.pf-ib:hover{border-color:var(--blue);color:var(--blue)}
.pf-ib.rm:hover{border-color:#FCA5A5;color:var(--red)}
.pf-ib:disabled{opacity:.35;cursor:default}
.pf-cur{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--ink);margin-bottom:11px;cursor:pointer}
.pf-cur input{width:15px;height:15px;accent-color:var(--blue)}

.pf-srow{display:flex;gap:8px;margin-bottom:7px;align-items:center}
.pf-srow input{border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:12.5px;font-family:inherit}
.pf-srow input:focus{outline:none;border-color:var(--blue)}
.pf-add{background:#fff;border:1px dashed #CBD5E1;color:#374151;border-radius:8px;padding:8px 13px;
  font-size:12px;font-weight:650;cursor:pointer;font-family:inherit;margin-top:5px}
.pf-add:hover{border-color:var(--blue);color:var(--blue)}
.pf-sacts{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:15px;padding-top:14px;border-top:1px solid var(--border)}
.pf-help{font-size:11px;color:var(--muted);line-height:1.5}

.pf-rt{width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11.5px;line-height:1.55;
  font-family:inherit;color:#374151;height:170px;resize:vertical;margin-top:10px;background:#fff}
.pf-rawtog{background:none;border:0;color:var(--muted);font-size:11.5px;font-weight:650;cursor:pointer;
  font-family:inherit;margin-top:10px;text-decoration:underline;text-underline-offset:3px}
.pf-rawtog:hover{color:var(--blue)}
.pf-drop{border:1.5px dashed #CBD5E1;border-radius:11px;padding:22px 14px;text-align:center;cursor:pointer;margin-top:12px}
.pf-drop.over{border-color:var(--blue);background:var(--blue-soft)}
.pf-drop .ic{font-size:20px}
.pf-drop .t{font-size:12.5px;font-weight:650;margin-top:5px}
.pf-drop .h{font-size:11px;color:var(--muted);margin-top:3px}
.pf-flag{display:flex;gap:9px;align-items:flex-start;margin-top:11px;padding:10px 12px;background:#FFFBEB;
  border:1px solid #FDE68A;border-radius:9px;font-size:12px;color:#78350F;line-height:1.5}
.pf-flag svg{width:14px;height:14px;flex:none;margin-top:1px}

.pf-msg{display:flex;gap:9px;align-items:center;padding:10px 13px;border-radius:9px;font-size:12.5px;margin-top:13px}
.pf-msg svg{width:14px;height:14px;flex:none}
.pf-err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B}
.pf-ok{background:#F0FDF4;border:1px solid #BBF7D0;color:#166534}
.pf-warnb{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;margin-top:0;margin-bottom:13px;align-items:flex-start;line-height:1.5}

.pf-pending{position:sticky;top:0;z-index:40;display:flex;gap:11px;align-items:center;padding:12px 15px;
  margin-bottom:15px;background:#FFFBEB;border:1.5px solid #F59E0B;border-radius:11px;font-size:12.5px;
  color:#78350F;line-height:1.45;box-shadow:0 6px 18px rgba(120,53,15,.12)}
.pf-pending svg{width:16px;height:16px;flex:none;color:#B45309}
.pf-pending span{flex:1}
.pf-pending .pf-btn{flex:none}
.pf-toast{position:fixed;right:22px;top:72px;background:#172033;color:#fff;padding:11px 15px;border-radius:9px;
  font-size:12.5px;font-weight:650;opacity:0;transform:translateY(-6px);pointer-events:none;transition:.2s;z-index:60}
.pf-toast.show{opacity:1;transform:translateY(0)}

.pf-load{display:flex;gap:11px;align-items:center;justify-content:center;padding:80px 0;color:var(--muted);font-size:13px}
.pf-loadspin,.pf-spin{width:15px;height:15px;border:2px solid var(--border);border-top-color:var(--blue);
  border-radius:50%;animation:pfspin .7s linear infinite;display:inline-block}
@keyframes pfspin{to{transform:rotate(360deg)}}

@media (max-width:1000px){ .pf-grid,.pf-rlayout{grid-template-columns:1fr}
  .pf-snav{position:static;display:flex;overflow-x:auto} .pf-snav button{white-space:nowrap} }
@media (max-width:640px){ .pf-body,.pf-htop{padding-left:16px;padding-right:16px}
  .pf-tabs{margin-left:16px;margin-right:16px} .pf-fgrid{grid-template-columns:1fr}
  .pf-identity{grid-template-columns:44px 1fr} .pf-identity .pf-status{grid-column:1/-1;width:max-content}
  .pf-frow2{grid-template-columns:38px 1fr} .pf-frow2 .pf-actions{grid-column:1/-1} }
`

function formatDate(iso) {
  if (!iso) return null
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return null }
}

// Dates live in storage as one string ("Jan 2024 – Present"). The editor shows
// start / end / current and composes back on apply — no data model change.
function splitDates(s) {
  const t = String(s || '').trim()
  const m = t.match(/^(.*?)\s*[–—-]\s*(.+)$/)
  if (!m) return { start: t, end: '', current: false }
  const current = /present|current/i.test(m[2])
  return { start: m[1].trim(), end: current ? '' : m[2].trim(), current }
}
function composeDates(start, end, current) {
  const a = String(start || '').trim(), b = current ? 'Present' : String(end || '').trim()
  if (a && b) return `${a} – ${b}`
  return a || b || ''
}

// Skills cleanup on save (developer spec): trim, drop empties, dedupe within and
// across categories (first occurrence wins), never save an empty category row.
function cleanSkills(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    const label = String(r.label || '').trim()
    const items = []
    for (const raw of (Array.isArray(r.items) ? r.items : [])) {
      const it = String(raw || '').trim()
      if (!it) continue
      const key = it.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push(it)
    }
    if (label && items.length) out.push({ label, items })
  }
  return out
}

// Contact format checks (2026-09-21). Rule learned from the locked-Save incident:
// validation NEVER silently disables Save — it either blocks with a message that
// names the field and the problem, or it doesn't block at all. Empty optional
// fields are always valid; only required-empty and wrong-format block.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
function contactIssues(p) {
  const issues = {}
  const phone = String(p.phone || '').trim()
  if (phone) {
    const digits = phone.replace(/\D/g, '')
    if (/[^\d\s()+.\-]/.test(phone) || digits.length < 7 || digits.length > 15)
      issues.phone = 'Numbers, spaces and + ( ) - only, 7\u201315 digits.'
  }
  const email = String(p.email || '').trim()
  if (email && !EMAIL_RE.test(email)) issues.email = "This doesn't look like an email address."
  const urlish = v => !/\s/.test(v) && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#]\S*)?$/i.test(v)
  const domains = { linkedin: 'linkedin.com', github: 'github.com' }
  for (const k of ['linkedin', 'github', 'portfolio']) {
    const v = String(p[k] || '').trim()
    if (!v) continue
    if (!urlish(v)) issues[k] = domains[k] ? `Enter a ${domains[k]} link.` : 'Enter a web link, e.g. yoursite.com'
    else if (domains[k] && !v.toLowerCase().includes(domains[k])) issues[k] = `This should be a ${domains[k]} link.`
  }
  return issues
}

const SECTION_LABELS = { contact: 'Contact', summary: 'Summary', skills: 'Skills', experience: 'Experience', projects: 'Projects', education: 'Education', certifications: 'Certifications' }

export default function ProfilePage() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState('')

  const [resumeText, setResumeText] = useState('')
  const [fileName, setFileName] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [profile, setProfile] = useState({})

  const [rd, setRd] = useState(null)
  const [rdCheck, setRdCheck] = useState(null)
  const [rdNotices, setRdNotices] = useState([])
  const [dirty, setDirty] = useState(false)
  const [draftId, setDraftId] = useState('')
  const [dirtySections, setDirtySections] = useState([])
  const [leaveAsk, setLeaveAsk] = useState(null)
  const [ackAsk, setAckAsk] = useState(null)

  const [tab, setTab] = useState('overview')
  const [section, setSection] = useState('contact')
  const [roleEditing, setRoleEditing] = useState(false)
  const [roleDraft, setRoleDraft] = useState('')

  // Expand-to-edit: at most one experience/project open; drafts are copies, so
  // Cancel restores by simply dropping the draft.
  const [editingExp, setEditingExp] = useState(null)
  const [expDraft, setExpDraft] = useState(null)
  const [editingProj, setEditingProj] = useState(null)
  const [projDraft, setProjDraft] = useState(null)

  const [replacing, setReplacing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [scrambled, setScrambled] = useState(false)
  const [viewingOrig, setViewingOrig] = useState(false)
  // An upload only counts after review + Save. First real user (2026-09-21) uploaded,
  // skipped Save, went to the board, and was confused that matches used the old
  // resume. The pending state must be impossible to miss and hard to abandon.
  const [pendingUpload, setPendingUpload] = useState(false)

  useEffect(() => {
    if (!pendingUpload && !dirty) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pendingUpload, dirty])

  // Leave guard registration (2026-09-22, his spec item 1): while this page holds
  // unsaved work — typed edits or a pending upload — every sidebar exit goes
  // through the Save-or-Discard dialog below instead of silently dropping it.
  // Window registry, not a context import, so the layout stays uncoupled from
  // page file paths.
  useEffect(() => {
    window.__optyplyLeaveGuard = {
      dirty: () => dirty || pendingUpload,
      ask: () => new Promise(resolve => setLeaveAsk({ resolve })),
    }
    return () => { window.__optyplyLeaveGuard = null }
  }, [dirty, pendingUpload])

  // Phase 1.4: while a review is pending, typed edits sync into the server-side
  // draft, debounced to ~1.5s after the last keystroke. Fire-and-forget: a missed
  // sync costs at most that edit on a reload, never an error in the user's face.
  useEffect(() => {
    if (!pendingUpload) return
    const t = setTimeout(async () => {
      try {
        const token = await getToken()
        await fetch(`${BACKEND}/me/resume/draft`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeData: rd,
            profile: Object.fromEntries(CONTACT_FIELDS.map(([k]) => [k, profile[k] || ''])),
          }),
        })
      } catch { /* silent — draft sync is best-effort */ }
    }, 1500)
    return () => clearTimeout(t)
  }, [pendingUpload, rd, profile, getToken])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch(`${BACKEND}/me/resume`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('load failed')
        const data = await res.json()
        if (cancelled) return
        setResumeText(data.resumeText || '')
        setFileName(data.resumeFileName || '')
        setUpdatedAt(data.updatedAt || null)
        const p = data.profile || {}
        if (!p.email && user?.primaryEmailAddress?.emailAddress) {
          p.email = user.primaryEmailAddress.emailAddress
        }
        setProfile(p)
        setRd(data.resumeData || null)
        // Phase 1: an unconfirmed upload survives a reload — the server returns it
        // as a draft and the page reopens straight into review. The draft holds the
        // PARSED values; edits made in the review before the reload were client
        // state only and are not restored (draft-edit sync is the next increment,
        // which is why the leave-warning stays on).
        if (data.draft && (data.draft.resumeData || data.draft.text)) {
          const d = data.draft
          setResumeText(d.text || '')
          setFileName(d.fileName || '')
          if (d.profile) setProfile(prev => {
            const next = { ...prev }
            for (const [k] of CONTACT_FIELDS) next[k] = String(d.profile[k] ?? '').trim()
            return next
          })
          setRd(d.resumeData || null)
          setRdCheck(d.verification || null)
          setRdNotices(Array.isArray(d.completeness) ? d.completeness : [])
          setDraftId(d.draftId || '')
          setSaved(false)
          setPendingUpload(true)
          setTab('resume'); setSection('contact')
        }
      } catch {
        if (!cancelled) setError('Could not load your profile. Please refresh.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [getToken, user])

  async function handleFile(f) {
    setError('')
    if (!f) return
    if (!/\.(pdf|docx|doc)$/i.test(f.name)) { setError('Please choose a PDF or Word file.'); return }
    if (f.size > MAX_BYTES) { setError('That file is over 10MB.'); return }

    setUploading(true)
    try {
      const token = await getToken()
      const form = new FormData()
      form.append('resume', f)
      const res = await fetch(`${BACKEND}/me/resume/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not read that file.'); return }
      if (data.status === 'empty' || data.status === 'short') {
        setError(data.message + ' Try a different file — a PDF export usually works best.')
        return
      }
      setResumeText(data.text || '')
      setFileName(data.fileName || f.name)
      setScrambled(data.status === 'not_resume')
      // A04 (final spec): contact refreshes ENTIRELY from the new parse — a field
      // absent from the new resume shows empty for review, never the old value.
      // Only contact fields are touched; target role and all other profile fields
      // stay untouched (the 2026-09-21 clobber, fixed and kept fixed).
      if (data.profile) setProfile(p => {
        const next = { ...p }
        for (const [k] of CONTACT_FIELDS) next[k] = String(data.profile[k] ?? '').trim()
        return next
      })
      setRd(data.resumeData || null)
      setRdCheck(data.resumeDataVerification || null)
      setRdNotices(Array.isArray(data.completeness) ? data.completeness : [])
      setDraftId(data.draftId || '')
      setReplacing(false)
      setSaved(false)
      setEditingExp(null); setEditingProj(null)
      setPendingUpload(true)
      setTab('resume'); setSection('contact')
      window.scrollTo({ top: 0 })
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // In-page exits (the header's job-board button) use the same Save-or-Discard
  // dialog as the sidebar guard — found 2026-09-22: it bypassed the guard.
  async function guardedSection(next) {
    if (dirty && !pendingUpload && next !== section) {
      const ok = await new Promise(resolve => setLeaveAsk({ resolve }))
      if (!ok) return
    }
    setSection(next)
  }

  async function guardedNav(path) {
    if (dirty || pendingUpload) {
      const ok = await new Promise(resolve => setLeaveAsk({ resolve }))
      if (!ok) return
    }
    navigate(path)
  }

  async function leaveSave() {
    const ok = await handleSave()
    const ask = leaveAsk; setLeaveAsk(null)
    ask?.resolve(!!ok)
  }
  async function leaveDiscard() {
    if (pendingUpload) {
      try {
        const token = await getToken()
        await fetch(`${BACKEND}/me/resume/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      } catch { /* draft TTL cleans up; leaving proceeds regardless */ }
    }
    // Discard must actually restore the saved data, not just clear the flag —
    // a section-switch discard STAYS on this page, so the edited state would
    // otherwise still be on screen pretending to be saved.
    await restoreSaved()
    const ask = leaveAsk; setLeaveAsk(null)
    ask?.resolve(true)
  }

  function ping(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  // Phase 1: explicit discard. Deletes the server-side draft + parked file, then
  // restores the page from the saved profile — the Save-or-Discard pair, so a
  // review can always be exited without saving and without trapping anyone.
  async function restoreSaved() {
    setPendingUpload(false)
    setScrambled(false)
    setRdCheck(null)
    setRdNotices([])
    setDirty(false)
    setDirtySections([])
    setDraftId('')
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`${BACKEND}/me/resume`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setResumeText(data.resumeText || '')
      setFileName(data.resumeFileName || '')
      const p = data.profile || {}
      if (!p.email && user?.primaryEmailAddress?.emailAddress) p.email = user.primaryEmailAddress.emailAddress
      setProfile(p)
      setRd(data.resumeData || null)
      setSaved(true)
    } catch {
      setError('Could not restore your saved profile. Please refresh the page.')
    } finally {
      setLoading(false)
    }
  }

  async function cancelUpload() {
    if (!window.confirm('Discard this uploaded resume? Your saved profile stays exactly as it is.')) return
    try {
      const token = await getToken()
      await fetch(`${BACKEND}/me/resume/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    } catch { /* the draft's 24h TTL cleans up if this misses; local reset still proceeds */ }
    await restoreSaved()
  }

  // rdNext/profileNext exist because React state updates are asynchronous: a save
  // fired right after setRd would otherwise post the PRE-edit state (found 2026-09-21:
  // a deleted bullet reappeared on refresh). Callers that just changed state pass the
  // exact object they set.
  async function handleSave(msg, rdNext, profileNext, ack) {
    if (!resumeText.trim()) { setError('Your resume text is empty — replace your resume first.'); return }
    const rdUse = rdNext !== undefined ? rdNext : rd
    const profileUse = profileNext !== undefined ? profileNext : profile
    // Visible-block validation. Deliberate: target role does NOT gate saving —
    // gating on it is what locked Save after an upload. Only Contact gates, loudly.
    const missing = CONTACT_FIELDS.filter(([k, , req]) => req && !String(profileUse[k] || '').trim()).map(([, l]) => l)
    const badKeys = Object.keys(contactIssues(profileUse))
    if (missing.length || badKeys.length) {
      const badLabels = badKeys.map(k => (CONTACT_FIELDS.find(f => f[0] === k) || [, k])[1])
      const parts = []
      if (missing.length) parts.push(`fill in ${missing.join(', ')}`)
      if (badLabels.length) parts.push(`fix ${badLabels.join(', ')}`)
      setError(`Can't save yet — in the Contact section, ${parts.join(' and ')}.`)
      setTab('resume'); setSection('contact')
      return
    }
    setSaving(true); setError(''); setSaved(false)
    try {
      const token = await getToken()
      const body = {
        resumeText, resumeFileName: fileName, profile: profileUse,
        // Confirmation saves name their draft; the server 409s if that draft was
        // consumed or replaced by another tab (the stale-tab hole, 2026-09-22).
        draftId: pendingUpload ? draftId : undefined,
        completenessAck: ack === true ? true : undefined,
        resumeData: rdUse ? { ...rdUse, skills: cleanSkills(rdUse.skills) } : null,
      }
      const res = await fetch(`${BACKEND}/me/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 422 && data.needsAck) {
        // Confirm-gate: the server re-checked the submitted data against the
        // resume text and sections still look under-captured. Show the explicit
        // fix-or-acknowledge choice instead of a bare error.
        if (Array.isArray(data.completeness)) setRdNotices(data.completeness)
        setAckAsk({ msg })
        return
      }
      if (!res.ok) { setError(data.error || 'Could not save. Please try again.'); return }
      if (rdUse) setRd({ ...rdUse, skills: cleanSkills(rdUse.skills) })
      setSaved(true)
      setPendingUpload(false)
      setRdNotices([])
      setDirty(false)
      setDirtySections([])
      setDraftId('')
      setUpdatedAt(data.updatedAt)
      ping(msg || 'Changes saved')
      setTimeout(() => setSaved(false), 3000)
      return true
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // View original (developer spec): the untouched uploaded file, fetched privately
  // with the auth token — PDFs open in a tab, Word files download.
  async function viewOriginal() {
    setViewingOrig(true)
    try {
      const token = await getToken()
      const res = await fetch(`${BACKEND}/me/resume-file`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) { setError("The original file isn't available — it may predate file storage. Replace the resume to store it."); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (/\.pdf$/i.test(fileName)) {
        window.open(url, '_blank', 'noopener')
      } else {
        const a = document.createElement('a')
        a.href = url; a.download = fileName || 'resume'
        document.body.appendChild(a); a.click(); a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      setError('Could not fetch the original file. Please try again.')
    } finally {
      setViewingOrig(false)
    }
  }

  const markDirty = sec => {
    setDirty(true)
    if (sec) setDirtySections(list => (list.includes(sec) ? list : [...list, sec]))
  }
  const set = (k, v) => { markDirty('Contact'); setProfile(p => ({ ...p, [k]: v })) }
  // upd is always called from the ACTIVE section's editor, so the current section
  // name is the right label for what was touched.
  const upd = fn => { markDirty(SECTION_LABELS[section] || null); setSaved(false); setRd(r => fn(structuredClone(r || {}))) }

  // ── expand-to-edit plumbing ──
  function openExp(i) {
    if ((editingExp !== null || editingProj !== null) &&
      !window.confirm('You have an entry open for editing. Discard its unsaved changes?')) return
    setEditingProj(null); setProjDraft(null)
    const j = structuredClone(rd.experience[i])
    const d = splitDates(j.dates)
    setExpDraft({ ...j, _start: d.start, _end: d.end, _current: d.current, bullets: j.bullets?.length ? j.bullets : [''] })
    setEditingExp(i)
  }
  function applyExp() {
    const d = expDraft
    const next = structuredClone(rd)
    next.experience[editingExp] = {
      title: d.title || '', company: d.company || '', city: d.city || '',
      dates: composeDates(d._start, d._end, d._current),
      bullets: d.bullets.map(b => String(b).trim()).filter(Boolean),
    }
    setRd(next)
    setEditingExp(null); setExpDraft(null)
    handleSave(undefined, next)
  }
  function openProj(i) {
    if ((editingExp !== null || editingProj !== null) &&
      !window.confirm('You have an entry open for editing. Discard its unsaved changes?')) return
    setEditingExp(null); setExpDraft(null)
    const p = structuredClone(rd.projects[i])
    const d = splitDates(p.dates)
    setProjDraft({ ...p, _start: d.start, _end: d.end, _current: d.current, bullets: p.bullets?.length ? p.bullets : [''] })
    setEditingProj(i)
  }
  function applyProj() {
    const d = projDraft
    const next = structuredClone(rd)
    next.projects[editingProj] = {
      name: d.name || '', tech: (Array.isArray(d.tech) ? d.tech : []).map(t => t.trim()).filter(Boolean),
      dates: composeDates(d._start, d._end, d._current), github: d.github || '',
      bullets: d.bullets.map(b => String(b).trim()).filter(Boolean),
    }
    setRd(next)
    setEditingProj(null); setProjDraft(null)
    handleSave(undefined, next)
  }
  const moveBullet = (setDraft, i, dir) => setDraft(d => {
    const b = [...d.bullets]; const j = i + dir
    if (j < 0 || j >= b.length) return d
    ;[b[i], b[j]] = [b[j], b[i]]
    return { ...d, bullets: b }
  })
  const moveRow = (sec, i, dir) => upd(r => {
    const a = r[sec]; const j = i + dir
    if (j < 0 || j >= a.length) return r
    ;[a[i], a[j]] = [a[j], a[i]]
    return r
  })

  if (loading) {
    return (
      <SidebarLayout>
        <div className="pf"><style>{CSS}</style>
          <div className="pf-load"><div className="pf-loadspin" />Loading your profile…</div>
        </div>
      </SidebarLayout>
    )
  }

  const missingRequired = CONTACT_FIELDS.filter(([k, , req]) => req && !profile[k]).map(([, l]) => l)
    .concat(!profile.targetRole ? ['Target role'] : [])
  const broken = !profile.targetRole
  const when = formatDate(updatedAt)
  const initials = ((profile.firstName || '?')[0] + (profile.lastName || ' ')[0]).toUpperCase().trim()
  const contactPreview = [profile.location, profile.phone, profile.email, profile.linkedin, profile.github, profile.portfolio]
    .map(x => String(x || '').trim()).filter(Boolean)
  const contactOk = CONTACT_FIELDS.every(([k, , req]) => !req || profile[k])
  const sectionsCount = rd ? ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']
    .filter(s => s === 'summary' ? (rd.summary || rd.summaryBullets?.length) : (Array.isArray(rd[s]) ? rd[s].length : rd[s])).length : 0
  const ready = contactOk && !!profile.targetRole && !!rd

  const contactBad = contactIssues(profile)
  const fld = ([key, label, required]) => {
    const empty = !profile[key]
    const bad = contactBad[key]
    return (
      <div className="pf-fld" key={key}>
        <label>{label}{required && <span className="pf-req">*</span>}</label>
        <input className={bad ? 'invalid' : (required && empty ? 'needed' : '')} value={profile[key] || ''}
          placeholder={required ? 'Required' : ''} onChange={e => set(key, e.target.value)} />
        {bad && <div className="pf-fielderr">{bad}</div>}
      </div>
    )
  }

  const has = {
    contact: contactOk,
    summary: !!(rd?.summary || rd?.summaryBullets?.length),
    skills: !!rd?.skills?.length,
    experience: !!rd?.experience?.length,
    projects: !!rd?.projects?.length,
    education: !!rd?.education?.length,
    certifications: !!rd?.certifications?.length,
  }
  const SECTIONS = [
    ['contact', 'Contact'], ['summary', 'Summary'], ['skills', 'Skills'], ['experience', 'Experience'],
    ['projects', 'Projects'], ['education', 'Education'], ['certifications', 'Certifications'],
  ]

  const saveBar = (help, msg) => (
    <div className="pf-sacts">
      <span className="pf-help">{help}</span>
      <button className="pf-btn primary" onClick={() => handleSave(msg)} disabled={saving}>
        {saving ? <><span className="pf-spin" />Saving…</> : 'Save changes'}
      </button>
    </div>
  )

  const noRd = (
    <div className="pf-card"><p className="pf-sub">No structured details yet — replace your resume on the Overview tab and they will appear here.</p></div>
  )

  const bulletEditor = (draft, setDraft) => (
    <div className="pf-fld" style={{ marginBottom: 0 }}>
      <label>Bullets — one field per bullet</label>
      {draft.bullets.map((b, i) => (
        <div className="pf-brow" key={i}>
          <textarea value={b} onChange={e => setDraft(d => { const bs = [...d.bullets]; bs[i] = e.target.value; return { ...d, bullets: bs } })} />
          <button className="pf-ib" title="Move up" disabled={i === 0} onClick={() => moveBullet(setDraft, i, -1)}><ArrowUp /></button>
          <button className="pf-ib" title="Move down" disabled={i === draft.bullets.length - 1} onClick={() => moveBullet(setDraft, i, 1)}><ArrowDown /></button>
          <button className="pf-ib rm" title="Delete bullet" onClick={() => setDraft(d => ({ ...d, bullets: d.bullets.filter((_, k) => k !== i) }))}><X /></button>
        </div>
      ))}
      <button className="pf-add" onClick={() => setDraft(d => ({ ...d, bullets: [...d.bullets, ''] }))}>+ Add bullet</button>
    </div>
  )

  const datesEditor = (draft, setDraft) => (
    <>
      <div className="pf-fgrid">
        <div className="pf-fld"><label>Start date</label>
          <input value={draft._start} placeholder="e.g. Jan 2024" onChange={e => setDraft(d => ({ ...d, _start: e.target.value }))} /></div>
        <div className="pf-fld"><label>End date</label>
          <input value={draft._end} placeholder="e.g. Dec 2024" disabled={draft._current}
            onChange={e => setDraft(d => ({ ...d, _end: e.target.value }))} /></div>
      </div>
      <label className="pf-cur">
        <input type="checkbox" checked={draft._current}
          onChange={e => setDraft(d => ({ ...d, _current: e.target.checked }))} />
        Currently working here
      </label>
    </>
  )

  return (
    <SidebarLayout>
      <div className="pf">
        <style>{CSS}</style>
        <div className={`pf-toast ${toast ? 'show' : ''}`}>{toast}</div>

        {ackAsk && (
          <div className="pf-leave-overlay">
            <div className="pf-leave-box">
              <h3>Some sections may be incomplete</h3>
              <p>Before this resume counts, these need a look:</p>
              <ul className="pf-ack-list">
                {rdNotices.map((n, i) => <li key={i}>{n.message}</li>)}
              </ul>
              <div className="pf-leave-btns">
                <button className="pf-btn primary" onClick={() => setAckAsk(null)}>Go back and fix</button>
                <button className="pf-btn" onClick={() => { const a = ackAsk; setAckAsk(null); handleSave(a.msg, undefined, undefined, true) }}>The missing content should stay out — save</button>
              </div>
            </div>
          </div>
        )}

        {leaveAsk && (
          <div className="pf-leave-overlay">
            <div className="pf-leave-box">
              <h3>Unsaved changes</h3>
              <p>
                Your profile has unsaved changes{dirtySections.length ? <> in <b>{dirtySections.join(', ')}</b></> : (pendingUpload ? ' from your new resume upload' : '')}.
                {' '}Save them before moving on, or discard them?
              </p>
              <div className="pf-leave-btns">
                <button className="pf-btn" onClick={() => { const a = leaveAsk; setLeaveAsk(null); a.resolve(false) }}>Stay</button>
                <button className="pf-btn" onClick={leaveDiscard}>Discard changes</button>
                <button className="pf-btn primary" onClick={leaveSave}>Save and leave</button>
              </div>
            </div>
          </div>
        )}

        {broken && (
          <div className="pf-banner">
            <AlertCircle />
            <span><b>Your profile is missing its target role.</b> Set it below — it decides which jobs your board shows.</span>
          </div>
        )}

        <div className="pf-htop">
          <div>
            <h1>Your profile</h1>
            <p>Review what Optyply uses to personalize jobs and build your resume.</p>
          </div>
          <button className="pf-goboard" onClick={() => guardedNav('/jobs')}>
            Go to job board <ArrowRight />
          </button>
        </div>

        <div className="pf-tabs">
          <button className={`pf-tab ${tab === 'overview' ? 'on' : ''}`} onClick={() => setTab('overview')}>Overview</button>
          <button className={`pf-tab ${tab === 'resume' ? 'on' : ''}`} onClick={() => setTab('resume')}>Resume details</button>
        </div>

        <div className="pf-body">

          {pendingUpload && (
            <div className="pf-pending">
              <AlertCircle />
              <span><b>New resume uploaded — not saved yet.</b> Optyply is still using your previous resume. Review the details below, then press Save.</span>
              <button className="pf-btn" onClick={cancelUpload} disabled={saving}>Discard</button>
              <button className="pf-btn primary" onClick={() => handleSave('Resume saved')} disabled={saving}>
                {saving ? 'Saving…' : 'Save now'}
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <div className="pf-grid">
              <div className="pf-stack">

                <div className="pf-card">
                  <div className="pf-identity">
                    <span className="pf-avatar">{initials || '?'}</span>
                    <div>
                      <h2>{[profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Your name'}</h2>
                      <div className="pf-role">{[profile.targetRole, profile.location].filter(Boolean).join(' · ') || 'Set your target role below'}</div>
                    </div>
                    <span className={`pf-status ${ready ? '' : 'warn'}`}>
                      {ready ? <CircleCheck /> : <AlertCircle />}{ready ? 'Profile ready' : 'Needs review'}
                    </span>
                  </div>
                  {contactPreview.length > 0 && (
                    <div className="pf-cline">{contactPreview.map((c, i) => <span key={i}>{c}</span>)}</div>
                  )}
                </div>

                <div className="pf-card">
                  <div className="pf-chead">
                    <div><div className="pf-eyebrow">Source resume</div><h2>Your uploaded resume</h2></div>
                    <button className="pf-btn ghost" onClick={() => { setTab('resume'); setSection('contact') }}><Pencil />Edit details</button>
                  </div>
                  <div className="pf-frow2">
                    <div className="pf-fico"><FileText /></div>
                    <div style={{ minWidth: 0 }}>
                      <div className="pf-fname">{fileName || 'No file yet'}</div>
                      <div className="pf-fmeta">{when ? `Updated ${when}` : 'Not saved yet'}</div>
                    </div>
                    <div className="pf-actions">
                      <button className="pf-btn" onClick={() => setReplacing(v => !v)}>
                        {replacing ? <><X />Cancel</> : <><RotateCcw />Replace</>}
                      </button>
                      <button className="pf-btn" onClick={viewOriginal} disabled={viewingOrig || !fileName}>
                        {viewingOrig ? <span className="pf-spin" /> : <Eye />}View original
                      </button>
                    </div>
                  </div>

                  {scrambled && (
                    <div className="pf-flag"><AlertCircle />
                      <span><b>This came out jumbled.</b> Your resume may have two columns, which PDFs often scramble. Fix the extracted text below, or replace it with a single-column version.</span>
                    </div>
                  )}

                  {replacing && (
                    <>
                      <div className="pf-flag"><AlertCircle />
                        <span>A new file re-reads everything. Details you corrected by hand will be overwritten, and you review the new extraction before it counts.</span>
                      </div>
                      <div className={`pf-drop ${dragOver ? 'over' : ''}`}
                        onClick={() => inputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}>
                        <div className="ic">📄</div>
                        <div className="t">{uploading ? 'Reading…' : 'Drop a new resume, or click to choose'}</div>
                        <div className="h">PDF or Word · up to 5MB</div>
                      </div>
                      <input ref={inputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                        onChange={e => handleFile(e.target.files?.[0])} />
                    </>
                  )}

                  {scrambled && (
                    <textarea className="pf-rt" value={resumeText} onChange={e => setResumeText(e.target.value)} />
                  )}
                </div>

                <div className="pf-card">
                  <div className="pf-chead">
                    <div><div className="pf-eyebrow">Job-board default</div><h2>Target role</h2>
                      <p className="pf-sub" style={{ marginTop: 4 }}>Optyply uses this role to show relevant jobs when you open the job board.</p></div>
                    {!roleEditing && <button className="pf-btn ghost" onClick={() => { setRoleDraft(profile.targetRole || ''); setRoleEditing(true) }}><Pencil />Change</button>}
                  </div>
                  {!roleEditing ? (
                    <div className="pf-frow2">
                      <div className="pf-fico"><Check /></div>
                      <div>
                        <div className="pf-fname">{profile.targetRole || 'Not set'}</div>
                        <div className="pf-fmeta">You can still search and use every filter on the job board.</div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="pf-fld"><label>Target role</label>
                        <input value={roleDraft} onChange={e => setRoleDraft(e.target.value)} placeholder="e.g. Software Engineer" /></div>
                      <div className="pf-sacts">
                        <span className="pf-help">Choose the core role, not a long list of job titles.</span>
                        <div className="pf-actions">
                          <button className="pf-btn" onClick={() => setRoleEditing(false)}>Cancel</button>
                          <button className="pf-btn primary" disabled={saving || !roleDraft.trim()}
                            onClick={() => { const p2 = { ...profile, targetRole: roleDraft.trim() }; setProfile(p2); setRoleEditing(false); handleSave('Target role saved', undefined, p2) }}>
                            Save role
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="pf-stack">
                <div className="pf-card">
                  <div className="pf-chead"><div><div className="pf-eyebrow">Profile checks</div><h2>{ready ? 'Ready for matching' : 'Almost there'}</h2></div></div>
                  <div className="pf-checklist">
                    <div className={`pf-check ${contactOk ? '' : 'pend'}`}><CircleCheck /><div>Contact details confirmed<small>{contactOk ? 'Name, email and phone reviewed' : `Missing: ${missingRequired.filter(m => m !== 'Target role').join(', ') || '—'}`}</small></div></div>
                    <div className={`pf-check ${rd ? '' : 'pend'}`}><CircleCheck /><div>Resume content reviewed<small>{rd ? `${sectionsCount} sections on file` : 'Upload a resume to fill this'}</small></div></div>
                    <div className={`pf-check ${profile.targetRole ? '' : 'pend'}`}><CircleCheck /><div>Target role selected<small>{profile.targetRole || 'Not set yet'}</small></div></div>
                  </div>
                </div>
                <div className="pf-card">
                  <div className="pf-eyebrow">Privacy</div>
                  <h3>Your resume is private</h3>
                  <p className="pf-sub" style={{ marginTop: 6 }}>Employers cannot view this profile. Optyply uses it only for job matching and resume optimization.</p>
                </div>
              </div>
            </div>
          )}

          {tab === 'resume' && (
            <>
              {rdCheck && rdCheck.ok === false && (
                <div className="pf-msg pf-warnb"><AlertCircle />
                  <span><b>Please double-check your details.</b> Some may not match your resume exactly{rdCheck.violations?.length ? ': ' + rdCheck.violations.slice(0, 5).join(' · ') : '.'}</span>
                </div>
              )}
              <div className="pf-rlayout">
                <nav className="pf-snav" aria-label="Resume sections">
                  {SECTIONS.map(([id, label]) => (
                    <button key={id} className={section === id ? 'on' : ''} onClick={() => guardedSection(id)}>
                      {label} {rdNotices.some(n => n.section === id) ? <em className="pf-needs">!</em> : (has[id] && <em>✓</em>)}
                    </button>
                  ))}
                </nav>
                <div>

                  {rdNotices.filter(n => n.section === section).map((n, i) => (
                    <div key={i} className="pf-note">{n.message}</div>
                  ))}

                  {section === 'contact' && (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Contact information</h2>
                        <p className="pf-sub" style={{ marginTop: 4 }}>One source of truth: these fields fill your account details AND build the contact line on every generated resume (empties are skipped). Your login email is separate and never changes here.</p></div></div>
                      <div className="pf-fgrid">{CONTACT_FIELDS.map(fld)}</div>
                      {contactPreview.length > 0 && (
                        <div className="pf-notice">On your resume: {contactPreview.join(' | ')}</div>
                      )}
                      {saveBar('Changes apply to future optimized resumes.')}
                    </div>
                  )}

                  {section === 'summary' && (!rd ? noRd : (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Professional summary</h2></div></div>
                      <div className="pf-fld"><label>Summary</label>
                        <textarea style={{ minHeight: 110, lineHeight: 1.55 }}
                          value={rd.summaryBullets?.length ? rd.summaryBullets.join('\n') : (rd.summary || '')}
                          onChange={e => upd(r => {
                            // One paragraph, or one bullet per line: multiple lines
                            // become summaryBullets; a single line stays a paragraph.
                            const lines = e.target.value.split('\n').map(t => t.replace(/^[\s\u2022\u25aa\u00b7*-]+/, '').trim())
                            const real = lines.filter(Boolean)
                            if (real.length > 1) { r.summaryBullets = real; r.summary = '' }
                            else { r.summary = e.target.value; r.summaryBullets = [] }
                            return r
                          })} /></div>
                      <div className="pf-hint" style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>One paragraph, or one bullet point per line.</div>
                      {saveBar('Keep this factual. Job-specific wording is handled during optimization.')}
                    </div>
                  ))}

                  {section === 'skills' && (!rd ? noRd : (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Skills</h2>
                        <p className="pf-sub" style={{ marginTop: 4 }}>Categories render as lines on your resume ("Languages: Python, SQL"). Comma-separate the skills; duplicates are removed on save.</p></div></div>
                      {(rd.skills || []).map((s, i) => (
                        <div className="pf-srow" key={i}>
                          <input style={{ flex: '0 0 32%' }} value={s.label || ''} placeholder="Category"
                            onChange={e => upd(r => { r.skills[i].label = e.target.value; return r })} />
                          <input style={{ flex: 1 }} value={(s.items || []).join(', ')} placeholder="Comma-separated skills"
                            onChange={e => upd(r => { r.skills[i].items = e.target.value.split(','); return r })} />
                          <button className="pf-ib" title="Move up" disabled={i === 0} onClick={() => moveRow('skills', i, -1)}><ArrowUp /></button>
                          <button className="pf-ib" title="Move down" disabled={i === (rd.skills.length - 1)} onClick={() => moveRow('skills', i, 1)}><ArrowDown /></button>
                          <button className="pf-ib rm" title="Remove category" onClick={() => upd(r => { r.skills.splice(i, 1); return r })}><X /></button>
                        </div>
                      ))}
                      <button className="pf-add" onClick={() => upd(r => { r.skills = r.skills || []; r.skills.push({ label: '', items: [] }); return r })}>+ Add category</button>
                      {saveBar('Empty rows and duplicate skills are dropped automatically on save.')}
                    </div>
                  ))}

                  {section === 'experience' && (!rd ? noRd : (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Experience</h2></div>
                        <button className="pf-btn" onClick={() => {
                          upd(r => { r.experience = r.experience || []; r.experience.push({ title: '', company: '', city: '', dates: '', bullets: [] }); return r })
                          setTimeout(() => openExp(rd.experience?.length ?? 0), 0)
                        }}>Add experience</button></div>
                      {(rd.experience || []).map((j, i) => (
                        <div className="pf-entry" key={i}>
                          {editingExp === i && expDraft ? (
                            <div className="pf-eform">
                              <div className="pf-fgrid">
                                <div className="pf-fld"><label>Job title</label><input value={expDraft.title || ''} onChange={e => setExpDraft(d => ({ ...d, title: e.target.value }))} /></div>
                                <div className="pf-fld"><label>Company</label><input value={expDraft.company || ''} onChange={e => setExpDraft(d => ({ ...d, company: e.target.value }))} /></div>
                              </div>
                              <div className="pf-fld"><label>City / location</label><input value={expDraft.city || ''} onChange={e => setExpDraft(d => ({ ...d, city: e.target.value }))} /></div>
                              {datesEditor(expDraft, setExpDraft)}
                              {bulletEditor(expDraft, setExpDraft)}
                              <div className="pf-sacts">
                                <button className="pf-btn ghost" style={{ color: 'var(--red)' }}
                                  onClick={() => { if (window.confirm('Remove this job from your resume?')) { const next = structuredClone(rd); next.experience.splice(i, 1); setRd(next); setEditingExp(null); setExpDraft(null); handleSave(undefined, next) } }}>
                                  Remove this job
                                </button>
                                <div className="pf-actions">
                                  <button className="pf-btn" onClick={() => { setEditingExp(null); setExpDraft(null) }}>Cancel</button>
                                  <button className="pf-btn primary" onClick={applyExp} disabled={saving}>Save</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="pf-etop">
                                <div>
                                  <div className="pf-etitle">{j.title || 'Untitled role'}</div>
                                  <div className="pf-emeta">{[j.company, j.city].filter(Boolean).join(' · ')}</div>
                                  {j.dates && <div className="pf-emeta">{j.dates}</div>}
                                </div>
                                <button className="pf-btn ghost" onClick={() => openExp(i)}><Pencil />Edit</button>
                              </div>
                              {j.bullets?.length > 0 && (
                                <ul className="pf-ebullets">{j.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      <div className="pf-sacts"><span className="pf-help">Current roles use present tense; past roles use past tense — this is checked automatically at optimize time.</span></div>
                    </div>
                  ))}

                  {section === 'projects' && (!rd ? noRd : (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Projects</h2></div>
                        <button className="pf-btn" onClick={() => {
                          upd(r => { r.projects = r.projects || []; r.projects.push({ name: '', tech: [], dates: '', github: '', bullets: [] }); return r })
                          setTimeout(() => openProj(rd.projects?.length ?? 0), 0)
                        }}>Add project</button></div>
                      {(rd.projects || []).map((p, i) => (
                        <div className="pf-entry" key={i}>
                          {editingProj === i && projDraft ? (
                            <div className="pf-eform">
                              <div className="pf-fgrid">
                                <div className="pf-fld"><label>Project name</label><input value={projDraft.name || ''} onChange={e => setProjDraft(d => ({ ...d, name: e.target.value }))} /></div>
                                <div className="pf-fld"><label>Technologies — comma-separated</label>
                                  <input value={(projDraft.tech || []).join(', ')} onChange={e => setProjDraft(d => ({ ...d, tech: e.target.value.split(',') }))} /></div>
                              </div>
                              <div className="pf-fld"><label>Project link or GitHub link</label><input value={projDraft.github || ''} placeholder="Optional" onChange={e => setProjDraft(d => ({ ...d, github: e.target.value }))} /></div>
                              {datesEditor(projDraft, setProjDraft)}
                              {bulletEditor(projDraft, setProjDraft)}
                              <div className="pf-sacts">
                                <button className="pf-btn ghost" style={{ color: 'var(--red)' }}
                                  onClick={() => { if (window.confirm('Remove this project from your resume?')) { const next = structuredClone(rd); next.projects.splice(i, 1); setRd(next); setEditingProj(null); setProjDraft(null); handleSave(undefined, next) } }}>
                                  Remove this project
                                </button>
                                <div className="pf-actions">
                                  <button className="pf-btn" onClick={() => { setEditingProj(null); setProjDraft(null) }}>Cancel</button>
                                  <button className="pf-btn primary" onClick={applyProj} disabled={saving}>Save</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="pf-etop">
                                <div>
                                  <div className="pf-etitle">{p.name || 'Untitled project'}</div>
                                  <div className="pf-emeta">{(p.tech || []).filter(Boolean).join(' · ')}</div>
                                  {p.dates && <div className="pf-emeta">{p.dates}</div>}
                                </div>
                                <button className="pf-btn ghost" onClick={() => openProj(i)}><Pencil />Edit</button>
                              </div>
                              {p.bullets?.length > 0 && (
                                <ul className="pf-ebullets">{p.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      <div className="pf-sacts"><span className="pf-help">{(rd.projects || []).length} project{(rd.projects || []).length === 1 ? '' : 's'}</span></div>
                    </div>
                  ))}

                  {section === 'education' && (!rd ? noRd : (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Education</h2>
                        <p className="pf-sub" style={{ marginTop: 4 }}>Education may appear before experience for current students.</p></div>
                        <button className="pf-btn" onClick={() => upd(r => { r.education = r.education || []; r.education.push({ degree: '', school: '', city: '', dates: '', gpa: '' }); return r })}>Add education</button></div>
                      {(rd.education || []).map((e2, i) => (
                        <div className="pf-entry" key={i}>
                          <div className="pf-fgrid">
                            <div className="pf-fld"><label>Degree</label><input value={e2.degree || ''} onChange={ev => upd(r => { r.education[i].degree = ev.target.value; return r })} /></div>
                            <div className="pf-fld"><label>School</label><input value={e2.school || ''} onChange={ev => upd(r => { r.education[i].school = ev.target.value; return r })} /></div>
                          </div>
                          <div className="pf-fgrid">
                            <div className="pf-fld"><label>City</label><input value={e2.city || ''} onChange={ev => upd(r => { r.education[i].city = ev.target.value; return r })} /></div>
                            <div className="pf-fld"><label>Dates</label><input value={e2.dates || ''} placeholder="e.g. Graduated: May 2024" onChange={ev => upd(r => { r.education[i].dates = ev.target.value; return r })} /></div>
                          </div>
                          <div className="pf-fgrid">
                            <div className="pf-fld"><label>GPA — only if strong</label><input value={e2.gpa || ''} placeholder="Optional" onChange={ev => upd(r => { r.education[i].gpa = ev.target.value; return r })} /></div>
                            <div />
                          </div>
                          <button className="pf-btn ghost" style={{ color: 'var(--red)' }} onClick={() => upd(r => { r.education.splice(i, 1); return r })}>Remove</button>
                        </div>
                      ))}
                      {saveBar('')}
                    </div>
                  ))}

                  {section === 'certifications' && (!rd ? noRd : (
                    <div className="pf-card">
                      <div className="pf-chead"><div><div className="pf-eyebrow">Resume section</div><h2>Certifications</h2></div></div>
                      {(rd.certifications || []).length === 0 && (
                        <div className="pf-notice">No certifications on your resume. This section stays hidden in generated resumes until you add one.</div>
                      )}
                      {(rd.certifications || []).map((c, i) => (
                        <div className="pf-srow" key={i}>
                          <input style={{ flex: 1 }} value={c.name || ''} placeholder="Certification"
                            onChange={e => upd(r => { r.certifications[i].name = e.target.value; return r })} />
                          <input style={{ flex: '0 0 26%' }} value={c.org || ''} placeholder="Issuer"
                            onChange={e => upd(r => { r.certifications[i].org = e.target.value; return r })} />
                          <input style={{ flex: '0 0 16%' }} value={c.date || ''} placeholder="Date"
                            onChange={e => upd(r => { r.certifications[i].date = e.target.value; return r })} />
                          <button className="pf-ib rm" title="Remove" onClick={() => upd(r => { r.certifications.splice(i, 1); return r })}><X /></button>
                        </div>
                      ))}
                      <button className="pf-add" onClick={() => upd(r => { r.certifications = r.certifications || []; r.certifications.push({ name: '', org: '', date: '' }); return r })}>+ Add certification</button>
                      {saveBar('Only add certifications you have earned.')}
                    </div>
                  ))}

                </div>
              </div>
            </>
          )}

          {error && <div className="pf-msg pf-err"><AlertCircle />{error}</div>}
          {saved && !error && <div className="pf-msg pf-ok"><Check />Saved.</div>}
        </div>
      </div>
    </SidebarLayout>
  )
}
