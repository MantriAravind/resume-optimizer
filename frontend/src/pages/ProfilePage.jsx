import { useState, useEffect, useRef } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import SidebarLayout from '../components/SidebarLayout'
import { FileText, Check, AlertCircle, RotateCcw, X, ArrowRight } from 'lucide-react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'
const MAX_BYTES = 10 * 1024 * 1024


// The right-hand column. targetRole, yearsExperience and field are NOT here — they
// live in the header sentence, because they are the only ones that change what the
// job board shows. Everything in this list is just the student's details.
// targetRole lives in this grid rather than in its own row. It is the only field that
// changes what the board shows — it runs through categorizeJob() on save and ranks the
// board — but a separate sentence for one field was more weight than the page needed.
//
// Required is visual plus a blocked Save — never a blocked board. A resume with no
// phone number is common, and locking that student out of jobs entirely would be a
// far worse failure than an incomplete profile.
const PERSONAL = [
  ['firstName', 'First name', true],
  ['lastName',  'Last name',  true],
  ['email',     'Email',      true],
  ['phone',     'Phone',      true],
  ['linkedin',  'LinkedIn'],
  ['github',    'GitHub'],
  ['location',   'Location'],
  ['targetRole', 'Target role', true],
]

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
.pf{--blue:#2563EB;--blue-dark:#1D4ED8;--ink:#0A0A0B;--muted:#6B7280;--border:#E5E7EB;--red:#DC2626;
  font-family:'Space Grotesk',-apple-system,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.pf *{box-sizing:border-box;margin:0;padding:0}

.pf-banner{display:flex;gap:10px;align-items:center;padding:11px 26px;background:#FFFBEB;
  border-bottom:1px solid #FDE68A;font-size:12.5px;color:#78350F;line-height:1.5}
.pf-banner svg{width:15px;height:15px;flex:none}

.pf-htop{padding:17px 26px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
/* The board button sits in the title row, where a primary action belongs. Keeping it
   out of the sentence row means the sentence gets the full width and the two never
   compete for space on a narrow window. */
.pf-goboard{background:var(--blue);color:#fff;border:0;padding:9px 18px;border-radius:9px;
  font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;
  align-items:center;gap:7px;flex:none;white-space:nowrap}
.pf-goboard:hover{background:var(--blue-dark)}
.pf-goboard svg{width:15px;height:15px}
.pf-htop h1{font-size:21px;font-weight:800;letter-spacing:-.025em}
.pf-htop p{font-size:12.5px;color:var(--muted);margin-top:2px}

/* The sentence carries the two fields the student actually sets. The field the board
   filters on is derived from the role on save — see /me/profile in server.js. */
/* An unread value gets real words, not a hole in a sentence — "roles in all fields"
   is both true and grammatical where an empty box was neither. */

.pf-body{padding:16px 26px 44px}
.pf-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.pf-panel{border:1px solid var(--border);border-radius:13px;overflow:hidden}
.pf-ph{display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:10px 14px;background:#FAFBFC;border-bottom:1px solid var(--border)}
.pf-pt{font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:7px}
.pf-pt svg{width:14px;height:14px;color:var(--blue)}
.pf-mini{padding:6px 12px;border-radius:7px;font-size:11.5px;font-weight:620;border:1px solid #D5DAE2;
  background:#fff;color:#374151;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px}
.pf-mini:hover{background:#F8FAFC}
.pf-mini svg{width:12px;height:12px}

.pf-fline{display:flex;align-items:center;gap:11px;padding:11px 14px;border-bottom:1px solid #F3F4F6}
.pf-fico{width:33px;height:33px;border-radius:8px;background:#EEF2FF;display:grid;place-items:center;flex:none}
.pf-fico svg{width:15px;height:15px;color:var(--blue)}
.pf-panel.bad .pf-fico{background:#FEF2F2}
.pf-panel.bad .pf-fico svg{color:var(--red)}
.pf-fname{font-size:12.5px;font-weight:645}
.pf-fmeta{font-size:10.5px;color:var(--muted);margin-top:2px}
.pf-panel.bad .pf-fmeta{color:#B91C1C}
.pf-flag{display:flex;gap:8px;padding:10px 14px;background:#FFFBEB;border-bottom:1px solid #FDE68A;
  font-size:11.5px;color:#78350F;line-height:1.5}
.pf-flag svg{width:13px;height:13px;flex:none;margin-top:1px}

.pf-rt{display:block;width:100%;border:0;padding:12px 14px;font-size:11.5px;line-height:1.72;
  color:#374151;font-family:inherit;resize:vertical;height:520px;background:#fff}
.pf-rt:focus{outline:none}
.pf-rtf{padding:8px 14px;background:#FAFBFC;border-top:1px solid #F3F4F6;font-size:10px;
  color:#9CA3AF;display:flex;justify-content:space-between;gap:8px}

.pf-drop{margin:13px 14px;border:2px dashed #CBD5E1;border-radius:12px;padding:26px 16px;
  text-align:center;background:#F9FAFB;cursor:pointer}
.pf-drop:hover,.pf-drop.over{border-color:var(--blue);background:#F7FAFF}
.pf-drop .ic{font-size:25px;margin-bottom:7px}
.pf-drop .t{font-size:13.5px;font-weight:650;margin-bottom:3px}
.pf-drop .h{font-size:11.5px;color:#9CA3AF}

.pf-fields{padding:13px}
.pf-frow{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.pf-fld{margin-bottom:12px}
.pf-fld label{display:block;font-size:10px;font-weight:650;color:var(--muted);
  text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.pf-req{color:#DC2626;margin-left:2px}
.pf-fld input.needed{border-color:#FCA5A5;background:#FEF2F2}
.pf-fld input{width:100%;padding:8px 11px;border:1px solid #BAE6FD;border-radius:7px;
  font-size:12.5px;font-family:inherit;background:#F0F9FF;color:var(--ink)}
.pf-fld input:focus{outline:none;border-color:var(--blue)}
.pf-fld .hint{font-size:9.5px;margin-top:3px;color:#0369A1}

.pf-msg{display:flex;gap:9px;font-size:12.5px;padding:11px 14px;border-radius:10px;line-height:1.55;margin-top:14px}
.pf-msg svg{width:15px;height:15px;flex:none;margin-top:1px}
.pf-ok{background:#F0FDF4;border:1px solid #BBF7D0;color:#166534}
.pf-err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B}
.pf-foot{display:flex;gap:11px;margin-top:16px}
.pf-save{background:var(--blue);color:#fff;border:0;padding:11px 22px;border-radius:9px;
  font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px}
.pf-save:hover:not(:disabled){background:var(--blue-dark)}
.pf-save:disabled{background:#BFDBFE;cursor:default}
.pf-spin{border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;
  width:14px;height:14px;animation:pf-spin .7s linear infinite}
@keyframes pf-spin{to{transform:rotate(360deg)}}
.pf-load{padding:70px 24px;text-align:center;color:var(--muted);font-size:14px}
.pf-loadspin{width:30px;height:30px;border:3px solid var(--border);border-top-color:var(--blue);
  border-radius:50%;margin:0 auto 14px;animation:pf-spin .7s linear infinite}

@media (max-width:1000px){ .pf-cols{grid-template-columns:1fr} }
@media (max-width:640px){ .pf-body,.pf-htop{padding-left:16px;padding-right:16px} .pf-frow{grid-template-columns:1fr} }
`

function formatDate(iso) {
  if (!iso) return null
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return null }
}

export default function ProfilePage() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(false)

  const [resumeText, setResumeText] = useState('')
  const [fileName, setFileName]     = useState('')
  const [updatedAt, setUpdatedAt]   = useState(null)
  const [profile, setProfile]       = useState({})

  const [replacing, setReplacing] = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [scrambled, setScrambled] = useState(false)

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
        // The resume's email wins — a student often applies with a different address
        // to the one they signed up with, and the resume is what an employer sees.
        // The account email is only a fallback, so a resume without one does not
        // leave a required box empty and block Save for no reason.
        const p = data.profile || {}
        if (!p.email && user?.primaryEmailAddress?.emailAddress) {
          p.email = user.primaryEmailAddress.emailAddress
        }
        setProfile(p)
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
        setError(data.message + ' Paste the text into the box on the left instead.')
        return
      }
      setResumeText(data.text || '')
      setFileName(data.fileName || f.name)
      setScrambled(data.status === 'not_resume')
      if (data.profile) setProfile(p => ({ ...p, ...data.profile }))
      setReplacing(false)
      setSaved(false)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (!resumeText.trim()) { setError('Your resume text is empty.'); return }
    setSaving(true); setError(''); setSaved(false)
    try {
      const token = await getToken()
      const res = await fetch(`${BACKEND}/me/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resumeText, resumeFileName: fileName, profile }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not save. Please try again.'); return }
      setSaved(true)
      setUpdatedAt(data.updatedAt)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setProfile(p => ({ ...p, [k]: v }))

  if (loading) {
    return (
      <SidebarLayout>
        <div className="pf"><style>{CSS}</style>
          <div className="pf-load"><div className="pf-loadspin" />Loading your profile…</div>
        </div>
      </SidebarLayout>
    )
  }

  // yearsExperience is still extracted and still saved — it is only hidden. Nothing
  // in the product reads it yet, but a job card showing "5+ years" or an experience
  // filter would need it, and by then everyone who signed up already has the value.
  // Deleting it would mean asking every user to re-upload.
  const broken = !profile.targetRole
  const when = formatDate(updatedAt)

  // Plain boxes, no caption underneath. The hints ("From your resume" / "Couldn't read
  // this") and the amber tint made every empty optional field look like a task — a
  // student with no GitHub read it as something they had failed to do. The only tint
  // left is on a required field that is empty, because that one genuinely blocks Save.
  const fld = ([key, label, required]) => {
    const empty = !profile[key]
    return (
      <div className="pf-fld" key={key}>
        <label>{label}{required && <span className="pf-req">*</span>}</label>
        <input
          className={required && empty ? 'needed' : ''}
          value={profile[key] || ''}
          placeholder={required ? 'Required' : ''}
          onChange={e => set(key, e.target.value)}
        />
      </div>
    )
  }

  // Blocks Save, not the board. The student can still browse jobs with an incomplete
  // profile — they just cannot save one that is missing the basics.
  const missingRequired = PERSONAL.filter(([k, , req]) => req && !profile[k]).map(([, l]) => l)

  return (
    <SidebarLayout>
      <div className="pf">
        <style>{CSS}</style>

        {broken && (
          <div className="pf-banner">
            <AlertCircle />
            <span><b>Your resume didn't come through cleanly.</b> Some fields are blank — check the text and fill in what's missing.</span>
          </div>
        )}

        <div className="pf-htop">
          <div>
            <h1>Your profile</h1>
            <p>Read from your resume. Edit anything that looks wrong.</p>
          </div>
          <button className="pf-goboard" onClick={() => navigate('/jobs')}>
            Go to job board <ArrowRight />
          </button>
        </div>

        <div className="pf-body">
          <div className="pf-cols">

            {/* ── LEFT: the resume ── */}
            <div className={`pf-panel ${scrambled ? 'bad' : ''}`}>
              <div className="pf-ph">
                <div className="pf-pt"><FileText />Your resume</div>
                <button className="pf-mini" onClick={() => setReplacing(v => !v)}>
                  {replacing ? <><X />Cancel</> : <><RotateCcw />Replace</>}
                </button>
              </div>
              <div className="pf-fline">
                <div className="pf-fico"><FileText /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="pf-fname">{fileName || 'Your resume'}</div>
                  <div className="pf-fmeta">
                    {when ? `Updated ${when}` : 'Not saved yet'}
                  </div>
                </div>
              </div>

              {scrambled && (
                <div className="pf-flag">
                  <AlertCircle />
                  <span><b>This came out jumbled.</b> Your resume may have two columns, which PDFs often scramble. Fix the text below, or replace it with a single-column version.</span>
                </div>
              )}

              {replacing && (
                <>
                  <div className="pf-flag">
                    <AlertCircle />
                    <span>A new file replaces the text below and re-reads every field. Anything you have corrected by hand will be overwritten.</span>
                  </div>
                  <div
                    className={`pf-drop ${dragOver ? 'over' : ''}`}
                    onClick={() => inputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
                  >
                    <div className="ic">📄</div>
                    <div className="t">{uploading ? 'Reading…' : 'Drop a new resume, or click to choose'}</div>
                    <div className="h">PDF or Word · up to 10MB</div>
                  </div>
                  <input ref={inputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                    onChange={e => handleFile(e.target.files?.[0])} />
                </>
              )}

              <textarea className="pf-rt" value={resumeText} onChange={e => setResumeText(e.target.value)} />
              <div className="pf-rtf">
                <span>{resumeText.length.toLocaleString()} characters · what your job matches and rewrites are built from</span>
                <span>editable</span>
              </div>
            </div>

            {/* ── RIGHT: the details ── */}
            <div>
              <div className="pf-panel">
                <div className="pf-ph"><div className="pf-pt"><Check />What we read from it</div></div>
                <div className="pf-fields">
                  <div className="pf-frow">{fld(PERSONAL[0])}{fld(PERSONAL[1])}</div>
                  <div className="pf-frow">{fld(PERSONAL[2])}{fld(PERSONAL[3])}</div>
                  <div className="pf-frow">{fld(PERSONAL[4])}{fld(PERSONAL[5])}</div>
                  <div className="pf-frow">{fld(PERSONAL[6])}{fld(PERSONAL[7])}</div>

                </div>
              </div>

              {error && <div className="pf-msg pf-err"><AlertCircle />{error}</div>}
              {saved && !error && <div className="pf-msg pf-ok"><Check />Saved.</div>}

              <div className="pf-foot">
                <button className="pf-save" onClick={handleSave} disabled={saving || missingRequired.length > 0}>
                  {saving ? <><span className="pf-spin" />Saving…</> : 'Save changes'}
                </button>
                {missingRequired.length > 0 && (
                  <span style={{ fontSize: 12, color: '#B91C1C', alignSelf: 'center' }}>
                    Add {missingRequired.join(', ')} to save
                  </span>
                )}
              </div>

                </div>

          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}

