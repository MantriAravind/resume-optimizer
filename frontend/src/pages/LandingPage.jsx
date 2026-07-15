import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, X, Search, FileText, ArrowRight, GraduationCap,
  MapPin, Building2, DollarSign, Sparkles, Star,
} from 'lucide-react';

const CSS = `
.pg { font-family: 'Space Grotesk', -apple-system, sans-serif;
  --blue: #2563EB; --blue-dark: #1D4ED8; --blue-soft: #EFF6FF; --violet: #7C3AED;
  --ink: #0A0A0B; --body: #374151; --muted: #6B7280; --border: #E5E7EB; --green: #059669;
  background: #fff; color: var(--ink);
}
.pg * { box-sizing: border-box; margin: 0; padding: 0; }
.pg a { text-decoration: none; color: inherit; }

/* Nav */
.pg-nav { display: flex; align-items: center; justify-content: space-between; padding: 16px 40px; border-bottom: 1px solid #F3F4F6; position: sticky; top: 0; background: rgba(255,255,255,.9); backdrop-filter: blur(8px); z-index: 30; }
.pg-logo { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 18px; }
.pg-logo-mark { width: 27px; height: 27px; border-radius: 7px; background: linear-gradient(135deg,#2563EB,#7C3AED); }
.pg-nav-links { display: flex; align-items: center; gap: 24px; }
.pg-nav-links a { color: var(--muted); font-size: 13.5px; font-weight: 500; }
.pg-nav-links a:hover { color: var(--ink); }
.pg-nav-cta { background: var(--blue); color: #fff; padding: 8px 17px; border-radius: 8px; font-size: 13.5px; font-weight: 700; border: none; cursor: pointer; }

/* ── HERO ── */
.pg-hero { display: grid; grid-template-columns: 1.05fr .95fr; gap: 44px; padding: 60px 40px 64px; align-items: center; background: linear-gradient(180deg,#fff,#F8FAFF); }
.pg-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: var(--blue-soft); color: var(--blue); border: 1px solid #DBEAFE; padding: 6px 13px; border-radius: 100px; font-size: 12.5px; font-weight: 600; margin-bottom: 22px; }
.pg-eyebrow svg { width: 13px; height: 13px; }
.pg-h1 { font-size: 52px; font-weight: 800; letter-spacing: -.035em; line-height: 1.04; margin-bottom: 18px; }
.pg-h1 .strike { color: #9CA3AF; text-decoration: line-through; text-decoration-color: #EF4444; text-decoration-thickness: 3px; }
.pg-sub { font-size: 16.5px; color: var(--body); line-height: 1.55; margin-bottom: 28px; max-width: 32ch; }
.pg-ctas { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; }
.pg-primary { background: var(--blue); color: #fff; padding: 14px 26px; border-radius: 11px; font-size: 15px; font-weight: 700; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.pg-primary:hover { background: var(--blue-dark); }
.pg-primary svg { width: 16px; height: 16px; }
.pg-secondary { background: #fff; color: var(--ink); padding: 14px 22px; border-radius: 11px; font-size: 15px; font-weight: 600; border: 1px solid var(--border); cursor: pointer; }
.pg-trust { font-size: 13px; color: var(--muted); font-weight: 500; }
.pg-trust b { color: var(--ink); }

/* hero demo (filter) */
.pg-demo { background: #F8FAFC; border: 1px solid var(--border); border-radius: 18px; padding: 20px; box-shadow: 0 20px 50px rgba(37,99,235,.1); }
.pg-demo-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
.pg-demo-title { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.pg-demo-count { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 100px; transition: all .4s; }
.pg-demo-count.filtering { background: #FEF3C7; color: #92400E; }
.pg-demo-count.done { background: #ECFDF5; color: var(--green); }
.pg-job { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 7px; transition: all .55s cubic-bezier(.4,0,.2,1); overflow: hidden; }
.pg-job.killed { opacity: 0; transform: translateX(-14px); max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; border-width: 0; }
.pg-job-logo { width: 30px; height: 30px; border-radius: 7px; flex-shrink: 0; color: #fff; font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.pg-job-info { flex: 1; min-width: 0; }
.pg-job-title { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-job-co { font-size: 11px; color: var(--muted); }
.pg-job-tag { font-size: 9.5px; font-weight: 700; padding: 3px 8px; border-radius: 100px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
.pg-job-tag svg { width: 9px; height: 9px; }
.pg-job-tag.good { background: #ECFDF5; color: var(--green); }
.pg-job-tag.bad { background: #FEF2F2; color: #DC2626; }

/* ── LOGO STRIP ── */
.pg-logos { padding: 28px 40px; border-bottom: 1px solid #F3F4F6; text-align: center; }
.pg-logos-label { font-size: 11.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 16px; }
.pg-logos-row { display: flex; justify-content: center; gap: 40px; flex-wrap: wrap; }
.pg-logos-row span { font-size: 17px; font-weight: 800; color: #C7CDD6; letter-spacing: -.01em; }

/* ── PILLARS (animated) ── */
.pg-section { padding: 64px 40px; }
.pg-section-head { text-align: center; margin-bottom: 40px; }
.pg-section-eyebrow { font-size: 12px; font-weight: 700; color: var(--blue); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
.pg-section-title { font-size: 34px; font-weight: 800; letter-spacing: -.025em; }
.pg-pillars { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 940px; margin: 0 auto; }
.pl { border: 1px solid var(--border); border-radius: 18px; padding: 26px; }
.pl-num { font-size: 12px; font-weight: 800; color: var(--blue); letter-spacing: .05em; }
.pl-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin: 13px 0 15px; }
.pl-icon svg { width: 21px; height: 21px; }
.pl-icon.a { background: var(--blue-soft); color: var(--blue); }
.pl-icon.b { background: #F5F3FF; color: var(--violet); }
.pl h3 { font-size: 20px; font-weight: 700; letter-spacing: -.02em; margin-bottom: 8px; }
.pl > p { font-size: 13.5px; color: var(--body); line-height: 1.55; margin-bottom: 16px; }
.pl-demo2 { background: #F8FAFC; border: 1px solid var(--border); border-radius: 13px; padding: 13px; margin-bottom: 16px; height: 188px; overflow: hidden; position: relative; }
.plf-job { display: flex; align-items: center; gap: 9px; background: #fff; border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px; margin-bottom: 6px; transition: all .55s cubic-bezier(.4,0,.2,1); overflow: hidden; }
.plf-job.killed { opacity: 0; transform: translateX(-12px); max-height: 0; margin: 0; padding: 0 10px; border-width: 0; }
.plf-logo { width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0; color: #fff; font-weight: 700; font-size: 11px; display: flex; align-items: center; justify-content: center; }
.plf-info { flex: 1; min-width: 0; }
.plf-title { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plf-co { font-size: 10px; color: var(--muted); }
.plf-tag { font-size: 9px; font-weight: 700; padding: 3px 7px; border-radius: 100px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
.plf-tag svg { width: 8px; height: 8px; }
.plf-tag.good { background: #ECFDF5; color: var(--green); }
.plf-tag.bad { background: #FEF2F2; color: #DC2626; }
.plf-status { position: absolute; bottom: 11px; left: 13px; right: 13px; font-size: 10.5px; font-weight: 700; color: var(--muted); text-align: center; padding: 6px; background: #fff; border-radius: 8px; border: 1px solid var(--border); }
.plf-status b { color: var(--green); }
.pll-score-wrap { display: flex; align-items: center; gap: 13px; margin-bottom: 13px; }
.pll-ring { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pll-ring-inner { width: 43px; height: 43px; border-radius: 50%; background: #F8FAFC; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; }
.pll-score-label { font-size: 12px; font-weight: 700; }
.pll-score-sub { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
.pll-kw-label { font-size: 9.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.pll-kws { display: flex; flex-wrap: wrap; gap: 5px; }
.pll-kw { font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 100px; transition: all .4s; }
.pll-kw.missing { background: #fff; color: var(--muted); border: 1px dashed #CBD5E1; }
.pll-kw.added { background: #D1FAE5; color: #047857; border: 1px solid transparent; }
.pll-kw svg { width: 8px; height: 8px; vertical-align: -1px; margin-right: 2px; }
.pl-feat { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--body); margin-bottom: 7px; }
.pl-feat svg { width: 15px; height: 15px; color: var(--green); flex-shrink: 0; }

/* ── HOW IT WORKS ── */
.pg-how { padding: 64px 40px; background: #F8FAFC; }
.pg-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 1000px; margin: 0 auto; }
.pg-step { text-align: center; }
.pg-step-num { width: 40px; height: 40px; border-radius: 50%; background: #fff; border: 2px solid var(--blue); color: var(--blue); font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
.pg-step h4 { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
.pg-step p { font-size: 12.5px; color: var(--muted); line-height: 1.5; }

/* ── DIFFERENTIATOR BAND ── */
.pg-band { background: linear-gradient(135deg, #172554, #1E3A8A); color: #fff; padding: 56px 40px; text-align: center; }
.pg-band h2 { font-size: 32px; font-weight: 800; letter-spacing: -.025em; margin-bottom: 14px; }
.pg-band h2 .hl { color: #93C5FD; }
.pg-band p { font-size: 15px; color: #BFDBFE; max-width: 54ch; margin: 0 auto 26px; line-height: 1.6; }
.pg-band-cta { background: #fff; color: #172554; padding: 14px 28px; border-radius: 11px; font-size: 15px; font-weight: 700; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.pg-band-cta svg { width: 16px; height: 16px; }

/* ── PRICING ── */
.pg-pricing { padding: 64px 40px; }
.pg-price-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 720px; margin: 32px auto 0; }
.pg-price { border: 1px solid var(--border); border-radius: 18px; padding: 28px; }
.pg-price.pro { border-color: var(--blue); border-width: 2px; position: relative; }
.pg-price-tag { position: absolute; top: -11px; left: 28px; background: var(--blue); color: #fff; font-size: 10.5px; font-weight: 700; padding: 3px 11px; border-radius: 100px; }
.pg-price-name { font-size: 14px; font-weight: 700; color: var(--muted); }
.pg-price-amt { font-size: 38px; font-weight: 800; letter-spacing: -.02em; margin: 6px 0 2px; }
.pg-price-amt span { font-size: 15px; font-weight: 600; color: var(--muted); }
.pg-price-feat { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--body); margin: 16px 0 0; }
.pg-price-feat svg { width: 15px; height: 15px; color: var(--green); flex-shrink: 0; }
.pg-price-btn { width: 100%; margin-top: 20px; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; }
.pg-price-btn.free { background: #fff; border: 1px solid var(--border); color: var(--ink); }
.pg-price-btn.pro { background: var(--blue); border: none; color: #fff; }

/* ── HONEST PROOF BAND ── */
.pg-proof { padding: 56px 40px; border-top: 1px solid #F3F4F6; border-bottom: 1px solid #F3F4F6; }
.pg-proof-head { text-align: center; margin-bottom: 36px; }
.pg-proof-eyebrow { font-size: 12px; font-weight: 700; color: var(--blue); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
.pg-proof-title { font-size: 32px; font-weight: 800; letter-spacing: -.025em; }
.pg-proof-title .hl { color: var(--blue); }
.pg-proof-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 940px; margin: 0 auto; }
.pg-proof-card { text-align: center; padding: 24px 16px; border: 1px solid var(--border); border-radius: 16px; background: #F8FAFC; }
.pg-proof-num { font-size: 40px; font-weight: 800; letter-spacing: -.03em; line-height: 1; margin-bottom: 8px; }
.pg-proof-num.blue { color: var(--blue); }
.pg-proof-num.green { color: var(--green); }
.pg-proof-num.violet { color: var(--violet); }
.pg-proof-num.ink { color: var(--ink); }
.pg-proof-label { font-size: 12.5px; color: var(--body); font-weight: 500; line-height: 1.4; }
.pg-proof-note { text-align: center; font-size: 12.5px; color: var(--muted); margin-top: 24px; }

/* ── FAQ ── */
.pg-faq { padding: 64px 40px; max-width: 760px; margin: 0 auto; }
.pg-faq-item { border-bottom: 1px solid var(--border); }
.pg-faq-q { display: flex; align-items: center; justify-content: space-between; padding: 20px 0; cursor: pointer; gap: 16px; }
.pg-faq-q h4 { font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
.pg-faq-toggle { width: 26px; height: 26px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px; font-weight: 700; color: var(--muted); transition: all .2s; }
.pg-faq-item.open .pg-faq-toggle { background: var(--blue); color: #fff; transform: rotate(45deg); }
.pg-faq-a { max-height: 0; overflow: hidden; transition: max-height .28s ease, padding .28s ease; }
.pg-faq-item.open .pg-faq-a { max-height: 200px; padding-bottom: 20px; }
.pg-faq-a p { font-size: 14px; color: var(--body); line-height: 1.6; }

/* ── FOOTER ── */
.pg-footer { padding: 40px; border-top: 1px solid #F3F4F6; text-align: center; }
.pg-footer-logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; margin-bottom: 10px; }
.pg-footer-tag { font-size: 13px; color: var(--muted); margin-bottom: 18px; }
.pg-footer-links { display: flex; justify-content: center; gap: 22px; flex-wrap: wrap; }
.pg-footer-links a { font-size: 13px; color: var(--muted); }
.pg-footer-links a:hover { color: var(--ink); }
`;

const HERO_JOBS = [
  { logo: 'L', grad: 'linear-gradient(135deg,#DC2626,#991B1B)', title: 'Systems Engineer', co: 'Lockheed Martin', tag: 'Clearance', bad: true },
  { logo: 'R', grad: 'linear-gradient(135deg,#DC2626,#991B1B)', title: 'Federal Data Analyst', co: 'RTX', tag: 'Citizens only', bad: true },
  { logo: 'S', grad: 'linear-gradient(135deg,#0EA5E9,#2563EB)', title: 'Data Scientist', co: 'Stripe', tag: 'Sponsors visa', bad: false },
  { logo: 'D', grad: 'linear-gradient(135deg,#6366F1,#2563EB)', title: 'Product Designer', co: 'Discord', tag: 'Sponsors visa', bad: false },
  { logo: 'A', grad: 'linear-gradient(135deg,#2563EB,#7C3AED)', title: 'ML Engineer', co: 'Airbnb', tag: 'Sponsors visa', bad: false },
];
const KEYWORDS = ['Python', 'SQL', 'PySpark', 'Distributed', 'Warehousing'];

function useFilterLoop() {
  const [filtered, setFiltered] = useState(false);
  useEffect(() => {
    const seq = () => { setFiltered(false); setTimeout(() => setFiltered(true), 1400); };
    seq();
    const t = setInterval(seq, 4600);
    return () => clearInterval(t);
  }, []);
  return filtered;
}

function HeroDemo() {
  const filtered = useFilterLoop();
  const good = HERO_JOBS.filter(j => !j.bad).length;
  return (
    <div className="pg-demo">
      <div className="pg-demo-head">
        <span className="pg-demo-title">Live job feed</span>
        <span className={`pg-demo-count ${filtered ? 'done' : 'filtering'}`}>
          {filtered ? `${good} you can take` : 'Filtering…'}
        </span>
      </div>
      {HERO_JOBS.map((j, i) => (
        <div key={i} className={`pg-job ${filtered && j.bad ? 'killed' : ''}`}>
          <div className="pg-job-logo" style={{ background: j.grad }}>{j.logo}</div>
          <div className="pg-job-info">
            <div className="pg-job-title">{j.title}</div>
            <div className="pg-job-co">{j.co}</div>
          </div>
          <span className={`pg-job-tag ${j.bad ? 'bad' : 'good'}`}>
            {j.bad ? <><X />{j.tag}</> : <><Check />{j.tag}</>}
          </span>
        </div>
      ))}
    </div>
  );
}

function FindDemo() {
  const filtered = useFilterLoop();
  const good = HERO_JOBS.filter(j => !j.bad).length;
  return (
    <div className="pl-demo2">
      {HERO_JOBS.map((j, i) => (
        <div key={i} className={`plf-job ${filtered && j.bad ? 'killed' : ''}`}>
          <div className="plf-logo" style={{ background: j.grad }}>{j.logo}</div>
          <div className="plf-info">
            <div className="plf-title">{j.title}</div>
            <div className="plf-co">{j.co}</div>
          </div>
          <span className={`plf-tag ${j.bad ? 'bad' : 'good'}`}>
            {j.bad ? <><X />{j.tag}</> : <><Check />Sponsors</>}
          </span>
        </div>
      ))}
      <div className="plf-status">
        {filtered ? <>Showing <b>{good} jobs you can take</b></> : <>Filtering out clearance & citizenship…</>}
      </div>
    </div>
  );
}

function LandDemo() {
  const [score, setScore] = useState(58);
  const [optimized, setOptimized] = useState(false);
  useEffect(() => {
    const run = () => {
      setOptimized(false); setScore(58);
      setTimeout(() => {
        setOptimized(true);
        const climb = setInterval(() => {
          setScore(s => { if (s >= 94) { clearInterval(climb); return 94; } return s + 2; });
        }, 40);
      }, 900);
    };
    run();
    const t = setInterval(run, 4600);
    return () => clearInterval(t);
  }, []);
  const rc = optimized ? '#059669' : '#D97706';
  return (
    <div className="pl-demo2">
      <div className="pll-score-wrap">
        <div className="pll-ring" style={{ background: `conic-gradient(${rc} 0% ${score}%, #E5E7EB ${score}% 100%)` }}>
          <div className="pll-ring-inner" style={{ color: rc }}>{score}</div>
        </div>
        <div>
          <div className="pll-score-label" style={{ color: rc }}>{optimized ? 'Strong match' : 'Needs work'}</div>
          <div className="pll-score-sub">{optimized ? 'Ready to beat the ATS' : 'Missing key skills'}</div>
        </div>
      </div>
      <div className="pll-kw-label">{optimized ? 'Keywords added' : 'Keywords missing'}</div>
      <div className="pll-kws">
        {KEYWORDS.map(kw => (
          <span key={kw} className={`pll-kw ${optimized ? 'added' : 'missing'}`}>
            {optimized && <Check />}{kw}
          </span>
        ))}
      </div>
    </div>
  );
}

const FAQS = [
  { q: 'How do you know a job will sponsor a visa?', a: "We scan every job description against 50+ patterns for citizenship requirements, security clearances, and explicit \"no sponsorship\" language — and hide any job that matches. When a posting explicitly mentions sponsorship, we show a green \"Sponsors visa\" badge. We're deliberately strict: we'd rather hide a borderline job than let a dead-end slip through." },
  { q: 'Where do the job listings come from?', a: "Directly from company career pages — not aggregators like Indeed or LinkedIn. Every \"Apply\" button takes you straight to the company's official application, so you're never chasing a reposted or expired listing." },
  { q: 'What visa types is this built for?', a: "International students on F1, CPT, OPT, and STEM OPT. Every filter is tuned for people who need employer sponsorship to work in the US — so you only see roles that are actually open to you." },
  { q: 'Is it free?', a: "Yes — the full job board is free, along with 3 resume optimizations per month. Pro ($9/month) unlocks unlimited optimizations, cover letters, and application tracking." },
  { q: 'How current are the jobs?', a: "The board refreshes regularly, and expired or filled roles are removed so you're not wasting time on listings that are already gone." },
]

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`pg-faq-item ${open ? 'open' : ''}`}>
      <div className="pg-faq-q" onClick={() => setOpen(!open)}>
        <h4>{q}</h4>
        <span className="pg-faq-toggle">+</span>
      </div>
      <div className="pg-faq-a"><p>{a}</p></div>
    </div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  return (
    <div className="pg">
      <style>{CSS}</style>

      <nav className="pg-nav">
        <div className="pg-logo"><div className="pg-logo-mark" />ResumeAI</div>
        <div className="pg-nav-links">
          <a href="#find">Job Board</a>
          <a href="#find">Resume Tool</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <button className="pg-nav-cta" onClick={() => navigate('/login')}>Log in</button>
        </div>
      </nav>

      {/* HERO */}
      <section className="pg-hero">
        <div>
          <div className="pg-eyebrow"><GraduationCap />Built for F1 · CPT · OPT · STEM OPT</div>
          <h1 className="pg-h1">Stop applying to jobs that <span className="strike">won't sponsor you.</span></h1>
          <p className="pg-sub">We hide every role requiring citizenship or clearance — then help you tailor a resume that beats the ATS.</p>
          <div className="pg-ctas">
            <button className="pg-primary" onClick={() => navigate('/jobs')}>Browse jobs free <ArrowRight /></button>
            <a className="pg-secondary" href="#how" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>See how it works</a>
          </div>
          <div className="pg-trust"><b>54,658</b> sponsor-friendly jobs · updated daily · no credit card</div>
        </div>
        <HeroDemo />
      </section>

      {/* LOGO STRIP */}
      <div className="pg-logos">
        <div className="pg-logos-label">Jobs pulled directly from company career pages</div>
        <div className="pg-logos-row">
          <span>Stripe</span><span>Airbnb</span><span>Discord</span><span>Coinbase</span><span>Databricks</span><span>Reddit</span>
        </div>
      </div>

      {/* PILLARS */}
      <section className="pg-section" id="find">
        <div className="pg-section-head">
          <div className="pg-section-eyebrow">Two tools, one job search</div>
          <div className="pg-section-title">Find the job. Land the job.</div>
        </div>
        <div className="pg-pillars">
          <div className="pl">
            <div className="pl-num">01 — FIND</div>
            <div className="pl-icon a"><Search /></div>
            <h3>A job board that won't waste your time</h3>
            <p>Direct links to company career pages, filtered so you never see a job you can't legally take.</p>
            <FindDemo />
            <div className="pl-feat"><Check />Hides citizenship & clearance roles</div>
            <div className="pl-feat"><Check />Green badge when sponsorship is confirmed</div>
            <div className="pl-feat"><Check />Filter by role, location, experience</div>
          </div>
          <div className="pl">
            <div className="pl-num">02 — LAND</div>
            <div className="pl-icon b"><FileText /></div>
            <h3>A resume built to beat the ATS</h3>
            <p>Paste any job, and our AI tailors your resume to match — then download in a template inspired by top companies.</p>
            <LandDemo />
            <div className="pl-feat"><Check />Instant ATS match score</div>
            <div className="pl-feat"><Check />5 recruiter-tested templates</div>
            <div className="pl-feat"><Check />Download as Word or PDF</div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="pg-how" id="how">
        <div className="pg-section-head">
          <div className="pg-section-eyebrow">How it works</div>
          <div className="pg-section-title">From search to sent in minutes</div>
        </div>
        <div className="pg-steps">
          <div className="pg-step"><div className="pg-step-num">1</div><h4>Browse filtered jobs</h4><p>Only roles that will actually sponsor you.</p></div>
          <div className="pg-step"><div className="pg-step-num">2</div><h4>Click optimize</h4><p>See your ATS match and what's missing.</p></div>
          <div className="pg-step"><div className="pg-step-num">3</div><h4>Tailor your resume</h4><p>AI rewrites it to match the role.</p></div>
          <div className="pg-step"><div className="pg-step-num">4</div><h4>Apply direct</h4><p>Straight to the company's career page.</p></div>
        </div>
      </section>

      {/* DIFFERENTIATOR */}
      <section className="pg-band">
        <h2>Every job here is <span className="hl">actually possible</span> for you.</h2>
        <p>No citizenship walls. No clearance requirements. No "we don't sponsor" surprises after you've already spent an hour on the application. Just jobs you can take — so every application actually counts.</p>
        <button className="pg-band-cta" onClick={() => navigate('/jobs')}>Start browsing jobs <ArrowRight /></button>
      </section>

      {/* HONEST PROOF BAND */}
      <section className="pg-proof">
        <div className="pg-proof-head">
          <div className="pg-proof-eyebrow">Why you can trust the results</div>
          <div className="pg-proof-title">We don't have millions of jobs. We have the <span className="hl">right</span> ones.</div>
        </div>
        <div className="pg-proof-grid">
          <div className="pg-proof-card">
            <div className="pg-proof-num blue">54,658</div>
            <div className="pg-proof-label">jobs you can actually take</div>
          </div>
          <div className="pg-proof-card">
            <div className="pg-proof-num green">7,531</div>
            <div className="pg-proof-label">dead-end jobs filtered out</div>
          </div>
          <div className="pg-proof-card">
            <div className="pg-proof-num violet">50+</div>
            <div className="pg-proof-label">citizenship & clearance checks per job</div>
          </div>
          <div className="pg-proof-card">
            <div className="pg-proof-num ink">0</div>
            <div className="pg-proof-label">aggregators — direct company links only</div>
          </div>
        </div>
        <div className="pg-proof-note">Every number here is real. No inflated counts, no jobs you'll get rejected from for sponsorship.</div>
      </section>

      {/* PRICING */}
      <section className="pg-pricing" id="pricing">
        <div className="pg-section-head">
          <div className="pg-section-eyebrow">Pricing</div>
          <div className="pg-section-title">Start free. Upgrade when you're ready.</div>
        </div>
        <div className="pg-price-grid">
          <div className="pg-price">
            <div className="pg-price-name">Free</div>
            <div className="pg-price-amt">$0<span>/month</span></div>
            <div className="pg-price-feat"><Check />Full job board access</div>
            <div className="pg-price-feat"><Check />3 resume optimizations / month</div>
            <div className="pg-price-feat"><Check />All 5 templates</div>
            <button className="pg-price-btn free" onClick={() => navigate('/signup')}>Get started</button>
          </div>
          <div className="pg-price pro">
            <div className="pg-price-tag">MOST POPULAR</div>
            <div className="pg-price-name">Pro</div>
            <div className="pg-price-amt">$9<span>/month</span></div>
            <div className="pg-price-feat"><Check />Everything in Free</div>
            <div className="pg-price-feat"><Check />Unlimited optimizations</div>
            <div className="pg-price-feat"><Check />Cover letters & tracking</div>
            <button className="pg-price-btn pro" onClick={() => navigate('/signup')}>Upgrade to Pro</button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pg-faq" id="faq">
        <div className="pg-section-head" style={{ marginBottom: 24 }}>
          <div className="pg-section-eyebrow">Questions</div>
          <div className="pg-section-title">The honest answers</div>
        </div>
        {FAQS.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} />)}
      </section>

      {/* FOOTER */}
      <footer className="pg-footer">
        <div className="pg-footer-logo"><div className="pg-logo-mark" />ResumeAI</div>
        <div className="pg-footer-tag">Job hunting, without the dead ends.</div>
        <div className="pg-footer-links">
          <a href="/about">About</a><a href="/pricing">Pricing</a><a href="/faq">FAQ</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
        </div>
      </footer>
    </div>
  );
}
