import { Link } from 'react-router-dom'
import './AboutPage.css'

export default function AboutPage() {
  return (
    <div className="page">
      {/* Page header */}
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Our story</span>
          <h1 className="page-hero-title">
            Helping people land<br />
            <span className="page-hero-title-accent">the interview</span>
          </h1>
          <p className="page-hero-sub">
            ResumeAI started with a simple frustration: great candidates getting
            filtered out before a human ever read their resume. We're here to fix that.
          </p>
        </div>
      </header>

      {/* Mission */}
      <section className="about-section">
        <div className="about-inner about-narrow">
          <p className="section-label">Our mission</p>
          <h2 className="section-title">Every resume deserves a fair read</h2>
          <p className="about-text">
            Most resumes are screened by applicant tracking systems before they reach
            a recruiter. A strong candidate with the wrong formatting or missing keywords
            can be rejected automatically — not because they aren't qualified, but because
            the software couldn't parse what made them a fit.
          </p>
          <p className="about-text">
            We built ResumeAI to level that playing field. Our optimizer reads your resume
            the way a hiring system does, then shows you exactly what to change to get
            through the filter and in front of a person.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="about-section about-section-alt">
        <div className="about-inner">
          <p className="section-label">What we believe</p>
          <h2 className="section-title">The principles behind the product</h2>
          <p className="section-sub about-section-sub">
            A few ideas guide every feature we ship.
          </p>

          <div className="values-grid">
            <div className="value-card">
              <div className="value-icon">🎯</div>
              <h3>Clarity over jargon</h3>
              <p>
                Feedback should be specific and actionable. We tell you what to change
                and why — no vague scores without direction.
              </p>
            </div>
            <div className="value-card">
              <div className="value-icon">🔒</div>
              <h3>Your data stays yours</h3>
              <p>
                Your resume is personal. We never sell your information, and you stay
                in control of everything you upload.
              </p>
            </div>
            <div className="value-card">
              <div className="value-icon">⚡</div>
              <h3>Fast and honest</h3>
              <p>
                Results in seconds, with guidance you can trust. No dark patterns,
                no upsells disguised as advice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="about-section">
        <div className="about-inner">
          <div className="stats-strip">
            <div className="stat">
              <div className="stat-num">75%</div>
              <div className="stat-label">of resumes are filtered before a human sees them</div>
            </div>
            <div className="stat">
              <div className="stat-num">6s</div>
              <div className="stat-label">average time a recruiter spends per resume</div>
            </div>
            <div className="stat">
              <div className="stat-num">3×</div>
              <div className="stat-label">more interviews with an optimized, keyword-matched resume</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-title">Ready to get past the filter?</h2>
          <p className="cta-sub">
            Optimize your resume in minutes and start landing more interviews.
          </p>
          <Link to="/signup" className="btn-primary-lg">Get started free</Link>
          <p className="cta-note">No credit card required</p>
        </div>
      </section>
    </div>
  )
}