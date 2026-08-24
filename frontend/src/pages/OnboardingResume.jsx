import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { FileText, Shield, AlertCircle, Check, X, ArrowRight, RotateCcw } from 'lucide-react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'
const MAX_BYTES = 10 * 1024 * 1024
const MIN_CHARS = 200

// MUST MATCH the list in ProfilePage.jsx — same keys, same order, same required flags.
// These drifted apart once: this screen still collected fullName, field, degree and
// major after the profile had moved to firstName/lastName/phone/linkedin. A new
// student saw a tidy review screen, hit Continue, and landed on a profile with four
// empty required boxes and no explanation — the moment a first-time user decides the
// product is broken. If one list changes, change both.
const FIELDS = [
  ['firstName',  'First name', true],
  ['lastName',   'Last name',  true],
  ['email',      'Email',      true],
  ['phone',      'Phone',      true],
  ['linkedin',   'LinkedIn'],
  ['github',     'GitHub'],
  ['location',   'Location'],
  ['targetRole', 'Target role'],
]

const CHECK_LABELS = {
  email:    'email address',
  phone:    'phone number',
  sections: 'Experience, Education or Skills section',
  dates:    'dates',
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
.ob{--blue:#2563EB;--blue-dark:#1D4ED8;--ink:#0A0A0B;--muted:#6B7280;--border:#E5E7EB;
  font-family:'Space Grotesk',-apple-system,sans-serif;min-height:100vh;
  background:linear-gradient(180deg,#fff,#F8FAFF);color:var(--ink);-webkit-font-smoothing:antialiased}
.ob *{box-sizing:border-box;margin:0;padding:0}
.ob-nav{display:flex;align-items:center;justify-content:space-between;padding:15px 30px;border-bottom:1px solid #F3F4F6;background:#fff}
.ob-logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:16.5px}
.ob-mark{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#2563EB,#7C3AED)}
.ob-step{font-size:12.5px;color:var(--muted)}
.ob-body{max-width:1180px;margin:0 auto;padding:36px 22px 60px}
/* The review step mirrors the profile page: resume left, what was read out of it on
   the right. Left to right matches the direction the data flows, and it puts a
   scrambled extraction beside the empty boxes it caused rather than a scroll away.
   Showing the same layout twice is also the point of a review step. */
.ob-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.ob-panel{border:1px solid var(--border);border-radius:13px;overflow:hidden}
.ob-frow{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.ob-rvfoot{padding:8px 14px;background:#FAFBFC;border-top:1px solid var(--border);
  font-size:10px;color:#9CA3AF;display:flex;justify-content:space-between;gap:8px}
.ob-ph{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#FAFBFC;
  border-bottom:1px solid var(--border);font-size:12.5px;font-weight:700}
.ob-ph svg{width:14px;height:14px;color:var(--blue)}
/* Every screen except the review stays narrow — they are one short column. */
.ob-narrow{max-width:600px;margin:0 auto}
.ob-eyebrow{display:inline-flex;align-items:center;gap:7px;background:#EFF6FF;color:var(--blue);
  border:1px solid #DBEAFE;padding:5px 13px;border-radius:100px;font-size:12.5px;font-weight:600;margin-bottom:16px}
.ob-eyebrow svg{width:13px;height:13px}
.ob h1{font-size:31px;font-weight:800;letter-spacing:-.03em;line-height:1.13;margin-bottom:10px}
.ob-sub{font-size:14px;color:var(--muted);line-height:1.6;margin-bottom:24px}

.ob-drop{border:2px dashed #CBD5E1;border-radius:14px;padding:40px 22px;text-align:center;
  background:#F9FAFB;cursor:pointer;transition:border-color .15s,background .15s}
.ob-drop:hover,.ob-drop.over{border-color:var(--blue);background:#F7FAFF}
.ob-drop .ic{font-size:30px;margin-bottom:10px}
.ob-drop .t{font-size:15px;font-weight:660;margin-bottom:4px}
.ob-drop .h{font-size:12.5px;color:#9CA3AF}

.ob-file{display:flex;align-items:center;gap:12px;padding:13px 15px;background:#F0F9FF;
  border:1px solid #BAE6FD;border-radius:12px;margin-bottom:14px}
.ob-file.bad{background:#FEF2F2;border-color:#FECACA}
.ob-fico{width:37px;height:37px;border-radius:9px;background:#fff;border:1px solid #BAE6FD;
  display:grid;place-items:center;flex:none}
.ob-file.bad .ob-fico{border-color:#FECACA}
.ob-fico svg{width:17px;height:17px;color:var(--blue)}
.ob-file.bad .ob-fico svg{color:#DC2626}
.ob-fname{font-size:13.5px;font-weight:645}
.ob-fmeta{font-size:11.5px;color:#0369A1;margin-top:2px}
.ob-file.bad .ob-fmeta{color:#B91C1C}
.ob-x{margin-left:auto;background:none;border:0;cursor:pointer;color:var(--muted);padding:4px;font-family:inherit}
.ob-x svg{width:16px;height:16px;display:block}

.ob-track{height:6px;background:#E8ECF2;border-radius:4px;overflow:hidden;margin:22px 0 13px}
.ob-fill{height:100%;background:var(--blue);transition:width .45s ease}
.ob-ptxt{font-size:14px;color:#374151;text-align:center}

.ob-msg{display:flex;gap:9px;font-size:12.5px;padding:12px 14px;border-radius:10px;line-height:1.55;margin-bottom:14px}
.ob-msg svg{width:15px;height:15px;flex:none;margin-top:1px}
.ob-ok{background:#F0FDF4;border:1px solid #BBF7D0;color:#166534}
.ob-err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B}

.ob-checks{border:1px solid var(--border);border-radius:11px;overflow:hidden;margin-bottom:14px}
.ob-crow{display:flex;align-items:center;gap:9px;padding:9px 13px;font-size:12.5px;border-bottom:1px solid #F3F4F6}
.ob-crow:last-child{border-bottom:0}
.ob-crow svg{width:14px;height:14px;flex:none}
.ob-crow.pass svg{color:#059669}
.ob-crow.fail{background:#FEF2F2;color:#7F1D1D}
.ob-crow.fail svg{color:#DC2626}

.ob-fld label{display:block;font-size:10.5px;font-weight:650;color:var(--muted);
  text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.ob-fld input{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:7px;
  font-size:12.5px;font-family:inherit;background:#fff;color:var(--ink)}
.ob-fld input.auto{background:#F0F9FF;border-color:#BAE6FD}
.ob-fld input.empty{background:#FFFBEB;border-color:#FDE68A}
.ob-fld input.needed{background:#FEF2F2;border-color:#FCA5A5}
.ob-req{color:#DC2626;margin-left:2px}
.ob-fld input:focus{outline:none;border-color:var(--blue)}
.ob-fld .hint{font-size:10px;margin-top:3px;color:#0369A1}
.ob-fld .hint.miss{color:#B45309}

.ob-rv{border:1px solid var(--border);border-radius:11px;overflow:hidden;margin-bottom:14px}
.ob-rvh{display:flex;justify-content:space-between;gap:10px;padding:9px 13px;background:#F9FAFB;
  border-bottom:1px solid var(--border);font-size:11.5px;color:var(--muted)}
.ob-rvh b{color:var(--ink);font-weight:640}
.ob-rvt{display:block;width:100%;border:0;padding:13px 14px;font-size:11.5px;line-height:1.72;
  color:#374151;font-family:inherit;resize:vertical;height:430px;background:#fff}
.ob-rvt:focus{outline:none}
.ob-rvt.bad{background:#FEF2F2;color:#7F1D1D}

.ob-paste{width:100%;min-height:170px;border:1px solid var(--border);border-radius:11px;padding:13px;
  font-size:13px;font-family:inherit;line-height:1.6;color:var(--ink);resize:vertical;background:#fff}
.ob-paste:focus{outline:none;border-color:var(--blue)}

.ob-priv{display:flex;gap:10px;background:#F0FDF4;border:1px solid #BBF7D0;color:#166534;
  font-size:12px;padding:12px 14px;border-radius:10px;margin-top:18px;line-height:1.55}
.ob-priv svg{width:15px;height:15px;flex:none;margin-top:1px}

.ob-row{display:flex;gap:9px;margin-top:16px;flex-wrap:wrap}
.ob-btn{padding:12px 23px;border-radius:10px;font-size:13.5px;font-weight:700;border:0;
  cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:7px}
.ob-btn svg{width:16px;height:16px}
.ob-p{background:var(--blue);color:#fff}
.ob-p:hover:not(:disabled){background:var(--blue-dark)}
.ob-p:disabled{background:#BFDBFE;cursor:default}
.ob-g{background:#fff;border:1px solid #D5DAE2;color:#374151}
.ob-g:hover{background:#F8FAFC}
.ob-spin{border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;
  width:15px;height:15px;animation:ob-spin .7s linear infinite}
@keyframes ob-spin{to{transform:rotate(360deg)}}

@media (max-width:640px){
  .ob-body{padding:28px 17px 55px}
  .ob h1{font-size:25px}
}
@media (max-width:1000px){ .ob-cols{grid-template-columns:1fr} }
@media (max-width:560px){ .ob-frow{grid-template-columns:1fr} }
`

const STEPS = [
  [20, 'Reading your resume…'],
  [48, 'Finding your experience…'],
  [76, 'Working out your field…'],
  [95, 'Almost there…'],
]

export default function OnboardingResume() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const inputRef = useRef(null)
  const timers = useRef([])

  // idle · working · review · paste
  const [stage, setStage] = useState('idle')
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(STEPS[0])

  const [result, setResult] = useState(null)
  const [text, setText] = useState('')
  const [profile, setProfile] = useState({})
  const [pasteText, setPasteText] = useState('')
  const [saving, setSaving] = useState(false)

  // Stops at 95%. A bar that fills before the server answers claims "done" while the
  // request is still in flight.
  function runProgress() {
    timers.current.forEach(clearTimeout)
    timers.current = STEPS.map((_, i) => setTimeout(() => setProgress(STEPS[i]), i * 750))
  }
  function stopProgress() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  function applyResult(data, chosenFile) {
    setResult(data)
    setText(data.text || '')
    setProfile(data.profile || {})
    if (chosenFile) setFile(chosenFile)
    // No text at all, or barely any — a scan or a photo. Paste is the only way through.
    setStage(data.status === 'empty' || data.status === 'short' ? 'paste' : 'review')
  }

  async function handleFile(f) {
    setError('')
    if (!f) return
    if (!/\.(pdf|docx|doc)$/i.test(f.name)) {
      setError('Please choose a PDF or Word file.')
      return
    }
    if (f.size > MAX_BYTES) {
      setError('That file is over 10MB. Please choose a smaller one.')
      return
    }

    setFile(f)
    setStage('working')
    setProgress(STEPS[0])
    runProgress()

    try {
      const token = await getToken()
      const form = new FormData()
      form.append('resume', f)
      const res = await fetch(`${BACKEND}/me/resume/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not read that file.')
        setStage('idle')
        return
      }
      applyResult(data, f)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setStage('idle')
    } finally {
      stopProgress()
    }
  }

  async function analysePaste() {
    const t = pasteText.trim()
    if (t.length < MIN_CHARS) {
      setError('That looks short for a resume — please paste the whole thing.')
      return
    }
    setError('')
    setStage('working')
    setProgress(STEPS[0])
    runProgress()
    try {
      const token = await getToken()
      const res = await fetch(`${BACKEND}/me/resume/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: t }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not read that.')
        setStage('paste')
        return
      }
      applyResult(data, null)
    } catch {
      setError('Could not reach the server. Please try again.')
      setStage('paste')
    } finally {
      stopProgress()
    }
  }

  // Nothing reaches the database until this runs. The student has seen the extracted
  // text and the fields read from it, and said they are right — which is the whole
  // point of the review step, since scrambled extraction is invisible otherwise.
  async function saveAndGo() {
    if (!text.trim()) {
      setError('Your resume text is empty.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`${BACKEND}/me/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resumeText: text, resumeFileName: file?.name || '', profile }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not save. Please try again.')
        setSaving(false)
        return
      }
      navigate('/jobs', { replace: true })
    } catch {
      setError('Could not reach the server. Please try again.')
      setSaving(false)
    }
  }

  function reset() {
    stopProgress()
    setStage('idle'); setFile(null); setResult(null)
    setText(''); setProfile({}); setPasteText(''); setError('')
  }

  const chrome = (
    <div className="ob-nav">
      <div className="ob-logo"><div className="ob-mark" />ResumeAI</div>
      <div className="ob-step">One step to go</div>
    </div>
  )

  const heading = (
    <>
      <div className="ob-eyebrow"><FileText />Last step</div>
      <h1>Upload your resume</h1>
      <p className="ob-sub">
        We read it to show jobs in your field — and to tailor
        your resume to any job you like, without inventing experience you don't have.
      </p>
    </>
  )

  const privacy = (
    <div className="ob-priv">
      <Shield />
      <span>
        We read the text and store that. The file itself is not kept, and your resume is
        never sent to employers or third parties without you choosing to.
      </span>
    </div>
  )

  const errorBox = error ? <div className="ob-msg ob-err"><AlertCircle />{error}</div> : null

  const fileRow = (bad, extra) => file && (
    <div className={`ob-file ${bad ? 'bad' : ''}`}>
      <div className="ob-fico"><FileText /></div>
      <div>
        <div className="ob-fname">{file.name}</div>
        <div className="ob-fmeta">{Math.round(file.size / 1024)} KB{extra}</div>
      </div>
      {extra && <button className="ob-x" onClick={reset} title="Choose another file"><X /></button>}
    </div>
  )

  // ── WORKING ───────────────────────────────────────────────────────────────
  if (stage === 'working') {
    return (
      <div className="ob"><style>{CSS}</style>{chrome}
        <div className="ob-body ob-narrow">{heading}
          {fileRow(false, '')}
          <div className="ob-track"><div className="ob-fill" style={{ width: `${progress[0]}%` }} /></div>
          <div className="ob-ptxt">{progress[1]}</div>
        </div>
      </div>
    )
  }

  // ── PASTE — reached only after extraction found no text ───────────────────
  if (stage === 'paste') {
    return (
      <div className="ob"><style>{CSS}</style>{chrome}
        <div className="ob-body ob-narrow">{heading}
          {fileRow(true, '')}
          <div className="ob-msg ob-err"><AlertCircle />{result?.message}</div>
          <p style={{ fontSize: 12.5, color: '#374151', marginBottom: 9 }}>
            Paste the text instead — open your resume, select all, and paste below.
          </p>
          <textarea
            className="ob-paste"
            placeholder="Paste your resume here…"
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); if (error) setError('') }}
            autoFocus
          />
          {errorBox}
          <div className="ob-row">
            <button className="ob-btn ob-p" onClick={analysePaste} disabled={pasteText.trim().length < MIN_CHARS}>
              Continue <ArrowRight />
            </button>
            <button className="ob-btn ob-g" onClick={reset}><RotateCcw />Try another file</button>
          </div>
          {privacy}
        </div>
      </div>
    )
  }

  // ── REVIEW ────────────────────────────────────────────────────────────────
  // Two columns, mirroring the profile page: the resume on the left, what was read out
  // of it on the right. Left to right matches the direction the data flows, and it puts
  // a scrambled extraction beside the empty boxes it caused rather than a scroll away.
  if (stage === 'review') {
    const suspect = result?.status === 'not_resume'
    const readCount = FIELDS.filter(([k]) => profile[k]).length
    // Blocks the button, never the board — a resume with no phone number is common, and
    // locking that student out of jobs entirely is a far worse failure than an
    // incomplete profile.
    const missingRequired = FIELDS.filter(([k, , req]) => req && !profile[k]).map(([, l]) => l)

    return (
      <div className="ob"><style>{CSS}</style>{chrome}
        <div className="ob-body">{heading}

          <div className="ob-cols">

            {/* ── LEFT: the resume ── */}
            <div className="ob-panel">
              <div className="ob-ph"><FileText />Your resume</div>
              <div style={{ padding: 12 }}>
                {fileRow(suspect, ` · we read ${readCount} of ${FIELDS.length} fields from this`)}

                {suspect ? (
                  <>
                    <div className="ob-msg ob-err"><AlertCircle />{result.message}</div>
                    {result.checks && (
                      <div className="ob-checks">
                        {Object.entries(result.checks).map(([k, ok]) => (
                          <div key={k} className={`ob-crow ${ok ? 'pass' : 'fail'}`}>
                            {ok ? <Check /> : <X />}
                            {ok ? `Found ${CHECK_LABELS[k]}` : `No ${CHECK_LABELS[k]}`}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="ob-msg ob-ok" style={{ marginBottom: 0 }}>
                    <Check />
                    <span><b>Read {text.length.toLocaleString()} characters.</b> This looks like a resume.</span>
                  </div>
                )}
              </div>

              <textarea
                className={`ob-rvt ${suspect ? 'bad' : ''}`}
                value={text}
                onChange={e => setText(e.target.value)}
              />
              <div className="ob-rvfoot">
                <span>{text.length.toLocaleString()} characters · what your job matches are built from</span>
                <span>editable</span>
              </div>
            </div>

            {/* ── RIGHT: what was read out of it ── */}
            <div>
              <div className="ob-panel">
                <div className="ob-ph"><Check />What we read from it</div>
                <div style={{ padding: 13 }}>
                  {/* Paired two-up, matching ProfilePage. Eight stacked boxes made the
                      right column twice the height of the left, and a phone number does
                      not need 500px. */}
                  {[[0, 1], [2, 3], [4, 5], [6, 7]].map(pair => (
                    <div className="ob-frow" key={pair[0]}>
                      {pair.map(i => {
                        const [key, label, required] = FIELDS[i]
                        const empty = !profile[key]
                        return (
                          <div className="ob-fld" key={key} style={{ marginBottom: 11 }}>
                            <label>{label}{required && <span className="ob-req">*</span>}</label>
                            <input
                              className={required && empty ? 'needed' : (empty ? 'empty' : 'auto')}
                              value={profile[key] || ''}
                              placeholder={required ? 'Required' : 'Not found'}
                              onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
                            />
                            <div className={`hint ${empty ? 'miss' : ''}`}>
                              {empty
                                ? (required ? 'Please add this' : "Couldn't read this")
                                : 'From your resume'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {errorBox}

              <div className="ob-row">
                <button className="ob-btn ob-p" onClick={saveAndGo} disabled={saving || missingRequired.length > 0}>
                  {saving
                    ? <><span className="ob-spin" />Saving…</>
                    : <>{suspect ? 'Use it anyway' : 'Looks right — see my jobs'} <ArrowRight /></>}
                </button>
                <button className="ob-btn ob-g" onClick={reset}><RotateCcw />Upload a different file</button>
              </div>

              {missingRequired.length > 0 && (
                <p style={{ fontSize: 12.5, color: '#B91C1C', marginTop: 9 }}>
                  Add {missingRequired.join(', ')} to continue
                </p>
              )}

              {privacy}
            </div>

          </div>
        </div>
      </div>
    )
  }

  // ── IDLE ──────────────────────────────────────────────────────────────────
  // Upload only. A paste box sitting alongside makes the main path look optional;
  // paste appears later, and only once extraction has demonstrably failed.
  return (
    <div className="ob"><style>{CSS}</style>{chrome}
      <div className="ob-body ob-narrow">{heading}
        <div
          className={`ob-drop ${dragOver ? 'over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
        >
          <div className="ic">📄</div>
          <div className="t">Drop your resume here, or click to choose</div>
          <div className="h">PDF or Word · up to 10MB</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
        />
        {errorBox}
        {privacy}
      </div>
    </div>
  )
}


