import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import SidebarLayout from '../components/SidebarLayout'
import { FileText, Check, AlertCircle } from 'lucide-react'

const BACKEND = 'https://resume-optimizer-cuii.onrender.com'

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

.pf-page {
  --blue: #2563EB; --blue-dark: #1D4ED8; --blue-soft: #EFF6FF;
  --ink: #0A0A0B; --body: #374151; --muted: #6B7280; --border: #E5E7EB;
  --green: #059669; --red: #DC2626;
  font-family: 'Space Grotesk', -apple-system, sans-serif;
  color: var(--ink); padding: 32px 36px 60px; max-width: 760px;
  -webkit-font-smoothing: antialiased;
}
.pf-page * { box-sizing: border-box; margin: 0; padding: 0; }

.pf-head { margin-bottom: 24px; }
.pf-head h1 { font-size: 26px; font-weight: 800; letter-spacing: -.03em; margin-bottom: 5px; }
.pf-head p { font-size: 14px; color: var(--muted); line-height: 1.5; }

.pf-card { border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
.pf-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; }
.pf-card-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.pf-card-title svg { width: 16px; height: 16px; color: var(--blue); }
.pf-saved-tag {
  font-size: 11px; font-weight: 700; background: #ECFDF5; color: var(--green);
  border: 1px solid #A7F3D0; padding: 4px 10px; border-radius: 100px;
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
}
.pf-saved-tag svg { width: 11px; height: 11px; }
.pf-empty-tag {
  font-size: 11px; font-weight: 700; background: #FEF3C7; color: #92400E;
  padding: 4px 10px; border-radius: 100px; white-space: nowrap;
}

.pf-textarea {
  width: 100%; min-height: 320px; border-radius: 12px; background: #F8FAFC;
  border: 1px solid var(--border); padding: 16px; font-size: 14px;
  font-family: inherit; color: var(--ink); resize: vertical; line-height: 1.6;
  transition: border-color .15s, background .15s;
}
.pf-textarea::placeholder { color: #A1A1A6; }
.pf-textarea:focus { outline: none; background: #fff; border-color: var(--blue); }

.pf-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; gap: 12px; }
.pf-count { font-size: 12px; color: #A1A1A6; }
.pf-updated { font-size: 12px; color: var(--muted); }

.pf-msg {
  border-radius: 10px; padding: 12px 14px; font-size: 13px; font-weight: 500;
  margin-top: 14px; display: flex; align-items: center; gap: 8px;
}
.pf-msg svg { width: 15px; height: 15px; flex-shrink: 0; }
.pf-msg-error { background: #FEF2F2; color: var(--red); }
.pf-msg-ok { background: #ECFDF5; color: var(--green); }

.pf-actions { margin-top: 18px; }
.pf-save {
  background: var(--blue); color: #fff; border: none; padding: 13px 26px;
  border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer;
  font-family: inherit; display: inline-flex; align-items: center; gap: 8px;
}
.pf-save:hover:not(:disabled) { background: var(--blue-dark); }
.pf-save:disabled { background: #B0D4F5; cursor: default; }
.pf-spin {
  border: 2.5px solid rgba(255,255,255,.4); border-top-color: #fff;
  border-radius: 50%; width: 14px; height: 14px;
  animation: pf-spin .7s linear infinite; flex-shrink: 0;
}
@keyframes pf-spin { to { transform: rotate(360deg); } }

.pf-loading { padding: 60px 24px; text-align: center; color: var(--muted); font-size: 14px; }
.pf-loading-spin {
  width: 32px; height: 32px; border: 3px solid var(--border);
  border-top-color: var(--blue); border-radius: 50%;
  margin: 0 auto 14px; animation: pf-spin .7s linear infinite;
}

.pf-hint {
  background: var(--blue-soft); border: 1px solid #DBEAFE; border-radius: 12px;
  padding: 14px 16px; font-size: 13px; color: #1E40AF; line-height: 1.55;
  margin-top: 18px;
}
.pf-hint b { font-weight: 700; }

@media (max-width: 640px) {
  .pf-page { padding: 24px 20px 48px; }
  .pf-head h1 { font-size: 22px; }
}
`

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return null
  }
}

export default function ProfilePage() {
  const { getToken } = useAuth()

  const [resumeText, setResumeText] = useState('')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [saved, setSaved]           = useState(false)
  const [updatedAt, setUpdatedAt]   = useState(null)
  const [hasResume, setHasResume]   = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const token = await getToken()
        const res = await fetch(`${BACKEND}/me/resume`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('load failed')
        const data = await res.json()
        if (cancelled) return
        setResumeText(data.resumeText || '')
        setUpdatedAt(data.updatedAt || null)
        setHasResume(Boolean(data.hasResume))
      } catch {
        if (!cancelled) setError('Could not load your saved resume. Please refresh.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [getToken])

  async function handleSave() {
    if (!resumeText.trim()) {
      setError('Please paste your resume before saving.')
      return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const token = await getToken()
      const res = await fetch(`${BACKEND}/me/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ resumeText }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not save. Please try again.')
        return
      }
      setSaved(true)
      setHasResume(true)
      setUpdatedAt(data.updatedAt)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Could not connect to the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const when = formatDate(updatedAt)

  return (
    <SidebarLayout>
      <div className="pf-page">
        <style>{CSS}</style>

        <div className="pf-head">
          <h1>Profile</h1>
          <p>Save your resume once. Every job you optimize will use it automatically.</p>
        </div>

        {loading ? (
          <div className="pf-loading">
            <div className="pf-loading-spin" />
            Loading your resume…
          </div>
        ) : (
          <>
            <div className="pf-card">
              <div className="pf-card-head">
                <div className="pf-card-title"><FileText />Your resume</div>
                {hasResume
                  ? <span className="pf-saved-tag"><Check />Saved</span>
                  : <span className="pf-empty-tag">Not saved yet</span>}
              </div>

              <textarea
                className="pf-textarea"
                placeholder="Paste your resume text here. Include work experience, skills, education, and any other relevant sections."
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
              />

              <div className="pf-meta">
                <span className="pf-count">{resumeText.length.toLocaleString()} characters</span>
                {when && <span className="pf-updated">Last updated {when}</span>}
              </div>

              {error && (
                <div className="pf-msg pf-msg-error"><AlertCircle />{error}</div>
              )}
              {saved && !error && (
                <div className="pf-msg pf-msg-ok"><Check />Resume saved.</div>
              )}

              <div className="pf-actions">
                <button className="pf-save" onClick={handleSave} disabled={saving}>
                  {saving ? <><span className="pf-spin" />Saving…</> : 'Save resume'}
                </button>
              </div>
            </div>

            <div className="pf-hint">
              <b>Coming soon:</b> upload a PDF or Word file instead of pasting. For now, open your resume, select all, and paste it above.
            </div>
          </>
        )}
      </div>
    </SidebarLayout>
  )
}
