import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SidebarLayout from '../components/SidebarLayout'
import { Mail, Send } from 'lucide-react'

// No backend. The form composes a mailto: link and opens the student's own
// email app pre-filled — nothing to host, nothing to silently lose. If support
// volume ever justifies a real inbox endpoint, this page is where it plugs in.
const SUPPORT_EMAIL = 'support@optyply.com'

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
.sp {
  --blue:#2563EB; --soft:#EFF6FF; --ink:#0A0A0B; --body:#374151;
  --muted:#6B7280; --border:#EEF2F6;
  font-family:'Space Grotesk',-apple-system,sans-serif; color:var(--ink);
  -webkit-font-smoothing:antialiased; padding:16px 32px 70px; max-width:1400px;
}
.sp * { box-sizing:border-box; }
.sp h1 { font-size:25px; font-weight:700; letter-spacing:-.02em; margin:0; }
.sp-sub { font-size:13px; color:var(--muted); margin-top:5px; }
.sp-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:22px; }
@media (max-width: 900px) { .sp-grid { grid-template-columns:1fr; } }
.sp-card { background:#fff; border:1px solid var(--border); border-radius:14px; padding:22px; }
.sp-card h3 { font-size:15.5px; font-weight:700; margin:0 0 6px; }
.sp-card p { font-size:13px; color:var(--muted); line-height:1.7; margin:0; }
.sp-mail {
  display:inline-flex; align-items:center; gap:7px; margin-top:14px;
  font-size:13px; font-weight:700; color:var(--blue); text-decoration:none;
}
.sp-mail:hover { text-decoration:underline; }
.sp-quick { list-style:none; margin:12px 0 0; padding:0; }
.sp-quick li { font-size:13px; padding:9px 0; border-top:1px solid #F3F4F6; }
.sp-quick li:first-child { border-top:none; }
.sp-quick button {
  border:none; background:none; font:inherit; font-weight:600; color:var(--ink);
  cursor:pointer; padding:0; text-align:left;
}
.sp-quick button:hover { color:var(--blue); }
.sp-form { grid-column:1 / -1; }
.sp-frow { display:grid; grid-template-columns:1fr; gap:12px; margin-top:14px; max-width:360px; }
.sp label { font-size:11px; font-weight:700; letter-spacing:.05em; color:var(--muted); display:block; margin-bottom:5px; }
.sp select, .sp textarea {
  width:100%; font-family:inherit; font-size:13.5px; padding:10px 12px;
  border:1px solid var(--border); border-radius:9px; background:#FBFCFE; color:var(--ink);
}
.sp textarea { min-height:120px; resize:vertical; margin-top:14px; max-width:720px; display:block; }
.sp-send {
  display:inline-flex; align-items:center; gap:8px; margin-top:14px;
  padding:11px 20px; border:none; border-radius:10px; background:var(--blue);
  color:#fff; font-weight:700; font-size:13.5px; cursor:pointer; font-family:inherit;
}
.sp-send:hover { background:#1D4ED8; }
.sp-send:disabled { opacity:.5; cursor:default; }
.sp-btnrow { display:flex; gap:10px; flex-wrap:wrap; }
.sp-send--ghost { background:#fff; color:var(--body); border:1px solid var(--border); }
.sp-send--ghost:hover { background:#F8FAFC; color:var(--ink); border-color:#CBD5E1; }
.sp-hint { font-size:11.5px; color:var(--muted); margin-top:10px; line-height:1.6; }
`

const TOPICS = ['Question', 'Bug report', 'Job data looks wrong', 'Feedback']

export default function SupportPage() {
  const navigate = useNavigate()
  const [topic, setTopic] = useState(TOPICS[0])
  const [message, setMessage] = useState('')

  const [copied, setCopied] = useState(false)

  // Two ways out, because mailto: depends on the machine having a default mail
  // app — on a Windows box without one, the browser opens a dead blank tab
  // (observed live). Gmail's compose URL works for anyone signed into Gmail in
  // the browser, which is nearly every student, so it is the primary button.
  function subjectAndBody() {
    return {
      su: `[${topic}] Optyply support`,
      body: message,
    }
  }
  function openGmail() {
    const { su, body } = subjectAndBody()
    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&to=${SUPPORT_EMAIL}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`,
      '_blank', 'noopener'
    )
  }
  function openMailApp() {
    const { su, body } = subjectAndBody()
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`
  }
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`To: ${SUPPORT_EMAIL}\nSubject: [${topic}] Optyply support\n\n${message}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* clipboard unavailable — the address is printed on the page */ }
  }

  return (
    <SidebarLayout>
      <div className="sp">
        <style>{CSS}</style>
        <h1>Support</h1>
        <div className="sp-sub">Stuck, found a bug, or have a question? Two ways to reach us.</div>

        <div className="sp-grid">
          <div className="sp-card">
            <h3>Email us</h3>
            <p>Fastest for account issues or anything with screenshots. We read everything.</p>
            <a className="sp-mail" href={`mailto:${SUPPORT_EMAIL}`}>
              <Mail size={14} /> {SUPPORT_EMAIL}
            </a>
          </div>

          <div className="sp-card">
            <h3>Common questions</h3>
            <ul className="sp-quick">
              <li><button onClick={() => navigate('/faq')}>Does “won’t reject for needing a visa” mean the job sponsors?</button></li>
              <li><button onClick={() => navigate('/faq')}>How does the resume optimizer decide what to change?</button></li>
              <li><button onClick={() => navigate('/faq')}>Why did a job disappear from the board?</button></li>
            </ul>
          </div>

          <div className="sp-card sp-form">
            <h3>Send a message</h3>
            <p>Write it here — the button opens Gmail (or your email app) with everything filled in, so the reply lands in your own inbox.</p>
            <div className="sp-frow">
              <div>
                <label>TOPIC</label>
                <select value={topic} onChange={e => setTopic(e.target.value)}>
                  {TOPICS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <textarea
              placeholder="What’s going on? If a specific job looks wrong, paste its link."
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
            <div className="sp-btnrow">
              <button className="sp-send" onClick={openGmail} disabled={!message.trim()}>
                <Send size={14} /> Open in Gmail
              </button>
              <button className="sp-send sp-send--ghost" onClick={openMailApp} disabled={!message.trim()}>
                Use email app
              </button>
              <button className="sp-send sp-send--ghost" onClick={copyAll} disabled={!message.trim()}>
                {copied ? '✓ Copied' : 'Copy message'}
              </button>
            </div>
            <div className="sp-hint">
              Goes to {SUPPORT_EMAIL}. Replies come to whichever email you send from.
              If neither button works on your machine, Copy message and paste it into any email.
            </div>
          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}
