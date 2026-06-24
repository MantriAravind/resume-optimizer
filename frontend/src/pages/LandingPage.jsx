import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import './LandingPage.css'

function MockCard() {
  const [tpl, setTpl] = useState(0)
  const [len, setLen] = useState(1)
  const TPLS = [
    ['#4285F4', 'Search Giant'],
    ['#FF9900', 'Everything Store'],
    ['#1d1d1f', 'Cupertino'],
    ['#003A70', 'The Firm'],
    ['#E50914', 'Streaming Co'],
  ]
  return (
    <div className="mock-card">
      <div className="mock-score">
        <div className="mock-ring-wrap">
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="20" fill="none" stroke="#D1FAE5" strokeWidth="5" />
            <circle cx="26" cy="26" r="20" fill="none" stroke="#059669" strokeWidth="5"
              strokeDasharray={126} strokeDashoffset={126 * 0.18}
              strokeLinecap="round" transform="rotate(-90 26 26)" />
          </svg>
          <div className="mock-ring-num">82</div>
        </div>
        <div>
          <div className="mock-score-title">ATS Match Score</div>
          <div className="mock-score-badge">✓ Strong match</div>
          <div className="mock-score-sub">Your resume aligns well with the role</div>
        </div>
      </div>
      <div className="mock-section">
        <div className="mock-label">Choose template</div>
        <div className="mock-tpls">
          {TPLS.map(([c, n], i) => (
            <div key={n} onClick={() => setTpl(i)} className={`mock-tpl ${i === tpl ? 'mock-tpl-active' : ''}`}
              style={{ borderColor: i === tpl ? c : '#E5E7EB' }}>
              <div className="mock-tpl-header" style={{ background: i === tpl ? c : '#F3F4F6' }} />
              <div className="mock-tpl-body">
                <div className="mock-tpl-line" style={{ background: i === tpl ? c : '#E5E7EB', width: '60%' }} />
                <div className="mock-tpl-line" style={{ height: 2 }} />
                <div className="mock-tpl-line" style={{ height: 2, width: '80%' }} />
              </div>
              {i === tpl && <div className="mock-tpl-check" style={{ background: c }}>✓</div>}
            </div>
          ))}
        </div>
        <div className="mock-tpl-names">
          {TPLS.map(([c, n], i) => (
            <div key={n} className="mock-tpl-name"
              style={{ color: i === tpl ? '#2563EB' : '#9CA3AF', fontWeight: i === tpl ? 700 : 400 }}>
              {n}
            </div>
          ))}
        </div>
      </div>
      <div className="mock-len-wrap">
        {[['Concise', '1 page'], ['Standard', 'Auto 1–2']].map(([l, s], i) => (
          <div key={l} onClick={() => setLen(i)} className={`mock-len-btn ${i === len ? 'mock-len-active' : ''}`}>
            <span className="mock-len-main" style={{ color: i === len ? '#0071E3' : '#6B7280' }}>{l}</span>
            <span className="mock-len-sub">{s}</span>
          </div>
        ))}
      </div>
      <div className="mock-downloads">
        <div className="mock-dl-word">📄 Word</div>
        <div className="mock-dl-pdf">⬇ PDF</div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const [billingYearly, setBillingYearly] = useState(false)

  return (
    <div className="landing">
      <Navbar />

      {/* HERO */}
      <section className="hero-split">
        <div className="hero-left">
          <div className="hero-badge">✦ AI-Powered Resume Optimization</div>
          <h1 className="hero-title">
            Get more interviews.<br />
            <span className="hero-title-accent">Beat the ATS.</span>
          </h1>
          <p className="hero-sub">
            Our AI rewrites your resume to match any job description. Choose a professional
            template inspired by top companies and download as PDF or Word.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn-primary-lg">Get started free →</Link>
            <a href="#how-it-works" className="btn-ghost-lg">How it works</a>
          </div>
          <p className="hero-note">No credit card required · Results in under 30 seconds</p>
          <div className="hero-pills">
            {['📊 ATS Score', '✍️ AI Rewriting', '🎨 5 Templates', '📄 PDF & Word'].map(f => (
              <div key={f} className="hero-pill">{f}</div>
            ))}
          </div>
        </div>
        <div className="hero-right">
          <MockCard />
        </div>
      </section>

      {/* PROOF BAR */}
      <section className="proof">
        <div className="proof-inner">
          <p className="proof-text">Helping job seekers land interviews at top companies</p>
          <div className="proof-logos">
            {['Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Netflix'].map(c => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="steps" id="how-it-works">
        <div className="steps-inner">
          <div className="section-label">How it works</div>
          <h2 className="section-title">Three steps to a better resume</h2>
          <p className="section-sub">From paste to optimized and downloaded in under 30 seconds.</p>
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-icon">📋</div>
              <div className="step-number">01</div>
              <h3>Paste your resume</h3>
              <p>Copy and paste your current resume into ResumeAI. Any format works — we handle the rest.</p>
            </div>
            <div className="step-card">
              <div className="step-icon">🎯</div>
              <div className="step-number">02</div>
              <h3>Add the job description</h3>
              <p>Paste the job posting. Our AI analyzes what the employer is looking for and tailors your resume to match.</p>
            </div>
            <div className="step-card">
              <div className="step-icon">⬇️</div>
              <div className="step-number">03</div>
              <h3>Choose, download, apply</h3>
              <p>Pick a professional template, set your preferred length, and download as PDF or Word. Ready to apply.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TEMPLATES */}
      <section className="templates-section">
        <div className="templates-inner">
          <div className="section-label">Professional Templates</div>
          <h2 className="section-title">Inspired by top companies</h2>
          <p className="section-sub">Each template is designed and written in the style that each company's recruiters favor. Same content, different impact.</p>
          <div className="templates-grid">
            {[
              { co: 'Search Giant',     ins: 'Google',   accent: '#4285F4', style: 'XYZ formula bullets · clean one-page' },
              { co: 'Everything Store', ins: 'Amazon',   accent: '#FF9900', style: 'Metrics-first · ownership language' },
              { co: 'Cupertino',        ins: 'Apple',    accent: '#1d1d1f', style: 'Minimal · craft-focused · elegant' },
              { co: 'The Firm',         ins: 'McKinsey', accent: '#003A70', style: 'Leadership framing · structured' },
              { co: 'Streaming Co',     ins: 'Netflix',  accent: '#E50914', style: 'High-leverage · bold decisions' },
            ].map(t => (
              <div key={t.co} className="template-card">
                <div className="template-visual" style={{ borderBottomColor: t.accent }}>
                  <div className="tv-name" style={{ background: t.accent }} />
                  <div className="tv-title" style={{ background: `${t.accent}66` }} />
                  <div className="tv-line" />
                  <div className="tv-line" style={{ width: '90%' }} />
                  <div className="tv-line" style={{ width: '80%' }} />
                  <div className="tv-section" style={{ background: t.accent }} />
                  <div className="tv-line" />
                  <div className="tv-line" style={{ width: '85%' }} />
                </div>
                <div className="template-info">
                  <div className="template-co">{t.co}</div>
                  <div className="template-ins" style={{ color: t.accent }}>Inspired by {t.ins}</div>
                  <div className="template-style">{t.style}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="templates-note">All templates available as PDF and Word download</p>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features">
        <div className="features-inner">
          <div className="section-label">Why ResumeAI</div>
          <h2 className="section-title">Everything you need to get hired faster</h2>
          <div className="features-grid">
            {[
              { icon: '📊', title: 'ATS Score Analysis',       body: 'See exactly how well your resume matches the job before you apply. Know your score before the recruiter does.' },
              { icon: '✍️', title: 'AI Resume Rewriting',      body: 'Our AI rewrites your entire resume to match the job description naturally — not just generic suggestions.' },
              { icon: '🎨', title: '5 Professional Templates', body: 'Choose from templates inspired by Google, Amazon, Apple, McKinsey, and Netflix — each with its own design and writing style.' },
              { icon: '📄', title: 'PDF & Word Download',      body: 'Download your optimized resume as a beautifully formatted PDF or an editable Word document. Your choice.' },
              { icon: '⚡', title: 'Results in 30 Seconds',   body: 'No waiting, no back-and-forth. Get a fully optimized resume in under 30 seconds, every time.' },
              { icon: '🔒', title: 'Private & Secure',         body: 'Your resume data is never stored or shared. Each optimization is processed privately and discarded immediately.' },
            ].map(f => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing-section" id="pricing">
        <div className="pricing-inner">
          <div className="section-label">Pricing</div>
          <h2 className="section-title">Simple, transparent pricing</h2>
          <p className="section-sub">Start free. Upgrade when you need more.</p>
          <div className="billing-toggle">
            <span className={!billingYearly ? 'billing-active' : ''} onClick={() => setBillingYearly(false)}>Monthly</span>
            <div className="billing-switch" onClick={() => setBillingYearly(!billingYearly)}>
              <div className={`billing-thumb ${billingYearly ? 'billing-thumb-on' : ''}`} />
            </div>
            <span className={billingYearly ? 'billing-active' : ''} onClick={() => setBillingYearly(true)}>
              Yearly <span className="billing-save">Save 20%</span>
            </span>
          </div>
          <div className="pricing-grid">
            <div className="pricing-card">
              <div className="pricing-tier">Free</div>
              <div className="pricing-price">$0<span className="pricing-period">/month</span></div>
              <div className="pricing-desc">Perfect for trying ResumeAI and occasional job applications.</div>
              <Link to="/signup" className="pricing-btn-free">Get started free</Link>
              <ul className="pricing-features">
                <li>✓ 3 resume optimizations per month</li>
                <li>✓ ATS score analysis</li>
                <li>✓ 1 professional template</li>
                <li>✓ PDF download</li>
                <li className="pricing-no">✗ Word download</li>
                <li className="pricing-no">✗ All 5 templates</li>
                <li className="pricing-no">✗ Priority processing</li>
              </ul>
            </div>
            <div className="pricing-card pricing-card-pro">
              <div className="pricing-popular">Most popular</div>
              <div className="pricing-tier">Pro</div>
              <div className="pricing-price">
                <span>${billingYearly ? '7' : '9'}</span><span className="pricing-period">/month</span>
              </div>
              {billingYearly && <div className="pricing-billed">Billed $84/year</div>}
              <div className="pricing-desc">For active job seekers who want the best possible resume.</div>
              <Link to="/signup" className="pricing-btn-pro">Get started →</Link>
              <ul className="pricing-features">
                <li>✓ Unlimited optimizations</li>
                <li>✓ ATS score analysis</li>
                <li>✓ All 5 professional templates</li>
                <li>✓ PDF download</li>
                <li>✓ Word (.docx) download</li>
                <li>✓ Concise & Standard length control</li>
                <li>✓ Priority processing</li>
              </ul>
            </div>
          </div>
          
        </div>
      </section>

      {/* ABOUT */}
      <section className="about-section" id="about">
        <div className="about-inner">
          <div className="about-left">
            <div className="section-label">About ResumeAI</div>
            <h2 className="section-title">Built for the modern job seeker</h2>
            <p className="about-body">
              Getting a job interview shouldn't depend on knowing the right keywords or paying a career coach hundreds of dollars. ResumeAI was built to level the playing field — giving every job seeker access to the same quality of resume optimization that top candidates use to land roles at Google, Amazon, Apple, and beyond.
            </p>
            <p className="about-body">
              We use Claude — one of the world's most capable AI systems — to analyze job descriptions and rewrite resumes with precision. The result is a tailored, professional resume that speaks directly to what each employer is looking for.
            </p>
            <div className="about-stats">
              {[
                { n: '5', l: 'Professional templates' },
                { n: '30s', l: 'Average optimization time' },
                { n: '100', l: 'Maximum ATS score possible' },
              ].map(s => (
                <div key={s.n} className="about-stat">
                  <div className="about-stat-num">{s.n}</div>
                  <div className="about-stat-label">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="about-right">
            <div className="about-card">
              <div className="about-quote">"</div>
              <p className="about-quote-text">Getting past ATS filters is the first battle in any job search. ResumeAI makes sure your resume is fighting with every advantage.</p>
              <div className="about-mission-label">Our mission</div>
            </div>
            <div className="about-powered">
              <div className="about-powered-label">Powered by</div>
              <div className="about-powered-badge">Claude AI by Anthropic</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-title">Ready to land more interviews?</h2>
          <p className="cta-sub">Join thousands of job seekers who use ResumeAI to stand out in competitive job markets.</p>
          <Link to="/signup" className="btn-primary-lg">Get started free →</Link>
          <p className="cta-note">Free to start · No credit card required</p>
        </div>
      </section>

      <Footer />
    </div>
  )
}