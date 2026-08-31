import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import SidebarLayout from '../components/SidebarLayout'
import { Download, FileText, ExternalLink, Trash2, Check, Briefcase } from 'lucide-react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'
const DOC_FONT = 'Times New Roman'

function when(d) {
  if (!d) return ''
  const then = new Date(d), now = new Date()
  const days = Math.floor((now - then) / 864e5)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
.tk {
  --blue:#2563EB; --blue-dark:#1D4ED8; --soft:#EFF6FF; --ink:#0A0A0B; --body:#374151;
  --muted:#6B7280; --border:#EEF2F6; --green:#059669; --amber:#B45309; --bg:#F8FAFC;
  font-family:'Space Grotesk',-apple-system,sans-serif; color:var(--ink);
  -webkit-font-smoothing:antialiased; padding:16px 32px 70px; max-width:1400px;
}
.tk * { box-sizing:border-box; }
.tk h1 { font-size:25px; font-weight:700; letter-spacing:-.02em; margin:0; }
.tk-sub { font-size:13px; color:var(--muted); margin-top:5px; }

.tk-list { border:1px solid var(--border); border-radius:14px; overflow:hidden; margin-top:22px; }
.tk-hd {
  display:grid; grid-template-columns:1fr 132px 78px 150px; gap:12px; padding:11px 16px;
  background:var(--bg); font-size:10px; font-weight:700; letter-spacing:.05em;
  text-transform:uppercase; color:var(--muted);
}
.tk-hd div:nth-child(3) { text-align:center; }
.tk-row { border-top:1px solid var(--border); }
.tk-main {
  display:grid; grid-template-columns:1fr 132px 78px 150px; gap:12px; padding:13px 16px;
  align-items:center; cursor:pointer;
}
.tk-main:hover { background:#FCFDFE; }
.tk-t { font-size:14px; font-weight:600; letter-spacing:-.01em; line-height:1.3; }
.tk-c { font-size:12px; color:var(--muted); margin-top:2px; }

.tk-pill {
  font-size:11px; font-weight:600; padding:5px 11px; border-radius:20px;
  border:1px solid var(--border); background:#fff; color:var(--muted);
  font-family:inherit; cursor:pointer; white-space:nowrap;
  display:inline-flex; align-items:center; gap:4px;
}
.tk-pill:hover { border-color:#CBD5E1; color:var(--ink); }
.tk-pill.on { background:#ECFDF5; border-color:#A7F3D0; color:#047857; }
.tk-pill.static { cursor:default; }
.tk-pill.static:hover { border-color:#A7F3D0; color:#047857; }

.tk-score {
  width:34px; height:34px; border-radius:50%; border:2.5px solid var(--green); color:var(--green);
  display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; margin:0 auto;
}
.tk-score.mid { border-color:#D97706; color:#D97706; }
.tk-score.none { border-color:var(--border); color:#CBD5E1; font-size:15px; }

.tk-acts { display:flex; gap:6px; justify-content:flex-end; }
.tk-btn {
  padding:6px 10px; border-radius:8px; border:1px solid var(--border); background:#fff;
  color:var(--body); font-family:inherit; font-weight:600; font-size:11px; cursor:pointer;
  display:inline-flex; align-items:center; gap:4px; text-decoration:none; white-space:nowrap;
}
.tk-btn:hover { background:var(--bg); color:var(--ink); }
.tk-btn.p { background:var(--blue); border-color:var(--blue); color:#fff; }
.tk-btn.p:hover { background:var(--blue-dark); }
.tk-btn:disabled { opacity:.4; cursor:default; }

.tk-exp { display:none; padding:0 16px 15px; background:#FCFDFE; border-top:1px dashed var(--border); }
.tk-row.open .tk-exp { display:block; }
.tk-meta { font-size:12px; color:var(--body); line-height:1.9; padding-top:12px; }
.tk-meta b { font-weight:600; }
.tk-dl { display:flex; gap:7px; margin-top:11px; flex-wrap:wrap; }
.tk-rm {
  font-size:11.5px; color:#DC2626; background:none; border:none; font-family:inherit;
  cursor:pointer; padding:0; margin-top:11px; font-weight:500;
  display:inline-flex; align-items:center; gap:5px;
}

.tk-note {
  background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:12px 14px;
  font-size:12px; color:#78350F; line-height:1.6; margin-top:14px;
}
.tk-tabs { display:flex; gap:6px; margin-top:18px; }
.tk-tab {
  font-family:inherit; font-size:12.5px; font-weight:700; padding:7px 14px; border-radius:8px;
  border:none; background:transparent; color:var(--muted); cursor:pointer;
  display:inline-flex; align-items:center; gap:6px;
}
.tk-tab .n { font-weight:600; opacity:.75; }
.tk-tab.on { background:var(--soft); color:var(--blue); }
.tk-mk-main {
  display:grid; grid-template-columns:1fr 190px; gap:12px; padding:13px 16px; align-items:center;
}
.tk-mk-note { font-size:11.5px; color:var(--muted); margin-top:10px; line-height:1.6; }
.tk-empty { border:1px dashed var(--border); border-radius:14px; padding:52px 24px; text-align:center; margin-top:22px; }
.tk-empty h3 { font-size:16px; font-weight:600; margin-bottom:7px; }
.tk-empty p { font-size:13px; color:var(--muted); max-width:390px; margin:0 auto 18px; line-height:1.6; }

@media (max-width: 780px) {
  .tk { padding:24px 16px 60px; }
  .tk-hd { display:none; }
  .tk-main { grid-template-columns:1fr; gap:9px; }
  .tk-score { margin:0; }
  .tk-acts { justify-content:flex-start; }
}
`

export default function TrackerPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState({})
  const [busy, setBusy] = useState('')
  // Saved-for-later and hidden jobs. Rows are SNAPSHOTS taken when the job was
  // marked, so they stay readable after the pipeline prunes the posting.
  const [saved, setSaved] = useState([])
  const [hidden, setHidden] = useState([])
  const [section, setSection] = useState('applied')

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      const [r, rm] = await Promise.all([
        fetch(`${BACKEND}/applications`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND}/me/job-marks`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (r.ok) {
        const { applications = [] } = await r.json()
        setRows(applications)
      }
      if (rm.ok) {
        const data = await rm.json()
        setSaved(data.saved || [])
        setHidden(data.hidden || [])
      }
    } catch (err) {
      console.warn('Could not load tracker:', err)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { load() }, [load])

  // Unsave / unhide. Optimistic; a failed delete restores the row.
  async function unmark(row) {
    const wasSaved = row.state === 'saved'
    const restoreS = saved, restoreH = hidden
    if (wasSaved) setSaved(list => list.filter(r => r.jobId !== row.jobId))
    else setHidden(list => list.filter(r => r.jobId !== row.jobId))
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/me/job-marks/${row.jobId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error()
    } catch {
      setSaved(restoreS); setHidden(restoreH)
      alert('Could not update that. Please try again.')
    }
  }

  async function toggle(row) {
    if (row.status === 'applied') return      // one-way; see the pill above
    const next = 'applied'
    setRows(rs => rs.map(r => r._id === row._id ? { ...r, status: next } : r))   // optimistic
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/applications/${row._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      })
      if (!r.ok) throw new Error()
    } catch {
      setRows(rs => rs.map(r => r._id === row._id ? { ...r, status: row.status } : r))
    }
  }

  async function remove(row) {
    const back = row.status === 'applied'
      ? ` It will show on the job board again.`
      : ''
    if (!window.confirm(`Remove ${row.company} from your tracker? The resume you sent goes with it.${back}`)) return
    const before = rows
    setRows(rs => rs.filter(r => r._id !== row._id))
    try {
      const token = await getToken()
      const r = await fetch(`${BACKEND}/applications/${row._id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error()
    } catch {
      setRows(before)
      alert('Could not remove that. Please try again.')
    }
  }

  // Two hops on purpose: the list endpoint leaves resumeText out because it is large
  // and never rendered, so the text is fetched only for the row being downloaded.
  async function download(row, type) {
    setBusy(row._id + type)
    try {
      const token = await getToken()
      const rt = await fetch(`${BACKEND}/applications/${row._id}/resume`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!rt.ok) { alert('No optimized resume was saved for this application.'); return }
      const { resumeText } = await rt.json()

      const res = await fetch(`${BACKEND}/download-${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, font: DOC_FONT, length: 'standard' }),
      })
      if (!res.ok) { alert('Download failed. Please try again.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safe = (row.company || 'resume').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      a.download = `${safe}-resume.${type === 'pdf' ? 'pdf' : 'docx'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed. Please try again.')
    } finally {
      setBusy('')
    }
  }

  const marked = rows.filter(r => r.status === 'applied').length

  return (
    <SidebarLayout>
      <div className="tk">
        <style>{CSS}</style>
        <h1>Tracker</h1>
        <p className="tk-sub">
          {loading ? 'Loading…'
            : `${rows.length} applied · ${saved.length} saved · ${hidden.length} hidden`}
        </p>

        <div className="tk-tabs">
          <button className={`tk-tab ${section === 'applied' ? 'on' : ''}`} onClick={() => setSection('applied')}>
            Applied {rows.length ? <span className="n">{rows.length}</span> : null}
          </button>
          <button className={`tk-tab ${section === 'saved' ? 'on' : ''}`} onClick={() => setSection('saved')}>
            Saved for later {saved.length ? <span className="n">{saved.length}</span> : null}
          </button>
          <button className={`tk-tab ${section === 'hidden' ? 'on' : ''}`} onClick={() => setSection('hidden')}>
            Hidden {hidden.length ? <span className="n">{hidden.length}</span> : null}
          </button>
        </div>

        {section === 'applied' && !loading && !rows.length && (
          <div className="tk-empty">
            <h3>Nothing here yet</h3>
            <p>
              When you apply to a job from the board it lands here — with the exact
              resume you sent, ready to download again.
            </p>
            <button className="tk-btn p" onClick={() => navigate('/jobs')}>
              <Briefcase size={12} /> Browse jobs
            </button>
          </div>
        )}

        {section === 'applied' && !!rows.length && (
          <>
            <div className="tk-list">
              <div className="tk-hd">
                <div>Role</div><div>Status</div><div>Coverage</div><div />
              </div>

              {rows.map(row => {
                const on = row.status === 'applied'
                const isOpen = !!open[row._id]
                return (
                  <div key={row._id} className={`tk-row ${isOpen ? 'open' : ''}`}>
                    <div
                      className="tk-main"
                      onClick={() => setOpen(o => ({ ...o, [row._id]: !o[row._id] }))}
                    >
                      <div>
                        <div className="tk-t">{row.title}</div>
                        <div className="tk-c">
                          {row.company}{row.location ? ` · ${row.location}` : ''} · {when(row.appliedAt)}
                        </div>
                      </div>

                      <div onClick={e => e.stopPropagation()}>
                        {on
                          // One-way. Applied is a statement about something that already
                          // happened out in the world; un-saying it would not un-send the
                          // application. Removing the row is the way out, and that reads
                          // as what it is rather than as rewriting history.
                          ? <span className="tk-pill on static"><Check size={11} /> Applied</span>
                          : <button className="tk-pill" onClick={() => toggle(row)}>Mark as applied</button>}
                      </div>

                      <div>
                        {row.optimized
                          ? <div className={`tk-score ${row.scoreAfter < 85 ? 'mid' : ''}`}>{row.scoreAfter ?? '–'}</div>
                          : <div className="tk-score none">–</div>}
                      </div>

                      <div className="tk-acts" onClick={e => e.stopPropagation()}>
                        {row.optimized
                          ? <button className="tk-btn p" disabled={!!busy} onClick={() => download(row, 'pdf')}>
                              <Download size={11} />{busy === row._id + 'pdf' ? '…' : 'Resume'}
                            </button>
                          : <button className="tk-btn" disabled>No resume</button>}
                        {row.applyUrl && (
                          <a className="tk-btn" href={row.applyUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={11} /> Posting
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="tk-exp">
                      <div className="tk-meta">
                        <b>Applied to</b> {row.company}{row.location ? ` · ${row.location}` : ''}<br />
                        <b>Status</b>{' '}
                        {on
                          ? 'You marked this applied, so it no longer shows on the job board. Removing this row puts it back.'
                          : `Opened on ${row.company}'s site — we can't tell whether you submitted.`}<br />
                        {row.optimized ? (
                          <>
                            <b>ATS coverage</b> {row.scoreAfter}
                            {row.scoreBefore != null ? `, up from ${row.scoreBefore}` : ''}<br />
                            <b>Confirmed skills in this version</b>{' '}
                            {row.confirmedSkills?.length ? row.confirmedSkills.join(', ') : 'none'}
                          </>
                        ) : (
                          <>
                            <b>Resume</b> You applied straight from the board, so there is no
                            optimized version to download. Your resume on file was sent as written.
                          </>
                        )}
                      </div>

                      {row.optimized && (
                        <div className="tk-dl">
                          <button className="tk-btn" disabled={!!busy} onClick={() => download(row, 'pdf')}>
                            <Download size={11} />{busy === row._id + 'pdf' ? 'Preparing…' : 'PDF'}
                          </button>
                          <button className="tk-btn" disabled={!!busy} onClick={() => download(row, 'word')}>
                            <FileText size={11} />{busy === row._id + 'word' ? 'Preparing…' : 'Word'}
                          </button>
                        </div>
                      )}

                      <button className="tk-rm" onClick={() => remove(row)}>
                        <Trash2 size={11} /> Remove from tracker
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Stated rather than hidden. A tracker that quietly implies every row has a
                downloadable resume would be making a claim it cannot keep. */}
          </>
        )}

        {section === 'saved' && !loading && (
          !saved.length ? (
            <div className="tk-empty">
              <h3>No saved jobs yet</h3>
              <p>Use “Save for later” on any job card and it lands here — details kept even after the posting leaves the board.</p>
              <button className="tk-btn p" onClick={() => navigate('/jobs')}>
                <Briefcase size={12} /> Browse jobs
              </button>
            </div>
          ) : (
            <>
              <div className="tk-list">
                <div className="tk-hd" style={{ gridTemplateColumns: '1fr 190px' }}>
                  <div>Role</div><div />
                </div>
                {saved.map(row => (
                  <div key={row.jobId} className="tk-row">
                    <div className="tk-mk-main">
                      <div>
                        <div className="tk-t">{row.title}</div>
                        <div className="tk-c">
                          {row.company}{row.location ? ` · ${row.location}` : ''} · saved {when(row.markedAt)}
                        </div>
                      </div>
                      <div className="tk-acts">
                        {row.applyUrl && (
                          <a className="tk-btn p" href={row.applyUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={11} /> Apply
                          </a>
                        )}
                        <button className="tk-btn" onClick={() => unmark({ ...row, state: 'saved' })}>Unsave</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="tk-mk-note">
                Saved jobs keep their details even after the employer’s posting expires — the
                Apply link may stop working once the employer closes it.
              </div>
            </>
          )
        )}

        {section === 'hidden' && !loading && (
          !hidden.length ? (
            <div className="tk-empty">
              <h3>No hidden jobs</h3>
              <p>Use the ✕ on any job card to hide it. Hidden jobs never appear on your board; Unhide brings one back.</p>
            </div>
          ) : (
            <>
              <div className="tk-list">
                <div className="tk-hd" style={{ gridTemplateColumns: '1fr 190px' }}>
                  <div>Role</div><div />
                </div>
                {hidden.map(row => (
                  <div key={row.jobId} className="tk-row">
                    <div className="tk-mk-main">
                      <div>
                        <div className="tk-t">{row.title}</div>
                        <div className="tk-c">
                          {row.company}{row.location ? ` · ${row.location}` : ''} · hidden {when(row.markedAt)}
                        </div>
                      </div>
                      <div className="tk-acts">
                        <button className="tk-btn" onClick={() => unmark({ ...row, state: 'hidden' })}>Unhide</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="tk-mk-note">Unhidden jobs reappear on your board on the next reload.</div>
            </>
          )
        )}
      </div>
    </SidebarLayout>
  )
}
