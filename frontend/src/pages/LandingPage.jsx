import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import './LandingPage.css'

export default function LandingPage() {
  return (
    <div className="landing">
      <Navbar />

      {/* Hero */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-badge">✦ AI-Powered Resume Optimization</div>
          <h1 className="hero-title">
            Get more interviews.<br />
            <span className="hero-title-accent">Beat the ATS.</span>
          </h1>
          <p className="hero-sub">
            Paste your resume and a job description. Our AI instantly rewrites your resume
            to match the role, boost your ATS score, and help you stand out to recruiters.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn-primary-lg">Get started free →</Link>
            <Link to="/how-it-works" className="btn-ghost-lg">See how it works</Link>
          </div>
          <p className="hero-note">No credit card required · Results in under 30 seconds</p>
        </div>
      </section>

      {/* Social proof */}
      <section className="proof">
        <div className="proof-inner">
          <p className="proof-text">Helping job seekers land interviews at top companies</p>
          <div className="proof-logos">
            <span>Google</span>
            <span>Microsoft</span>
            <span>Amazon</span>
            <span>Meta</span>
            <span>Apple</span>
            <span>Netflix</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="steps">
        <div className="steps-inner">
          <div className="section-label">How it works</div>
          <h2 className="section-title">Three steps to a better resume</h2>
          <p className="section-sub">From paste to optimized in under 30 seconds.</p>
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">01</div>
              <h3>Paste your resume</h3>
              <p>Copy and paste your current resume into ResumeAI. Any format works — we handle the rest.</p>
            </div>
            <div className="step-card">
              <div className="step-number">02</div>
              <h3>Add the job description</h3>
              <p>Paste the job description you're applying for. Our AI analyzes what the employer is really looking for.</p>
            </div>
            <div className="step-card">
              <div className="step-number">03</div>
              <h3>Get your optimized resume</h3>
              <p>Receive an ATS score and a fully rewritten resume tailored to that specific role. Copy and apply.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="features-inner">
          <div className="section-label">Why ResumeAI</div>
          <h2 className="section-title">Everything you need to get hired faster</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">📊</div>
              <h3>ATS Score Analysis</h3>
              <p>See exactly how well your resume matches the job before you apply. Know your score before the recruiter does.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">✍️</div>
              <h3>AI Resume Rewriting</h3>
              <p>Our AI doesn't just suggest edits — it rewrites your entire resume to match the job description naturally.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3>Results in Seconds</h3>
              <p>No waiting, no back-and-forth. Get a fully optimized resume in under 30 seconds, every time.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🎯</div>
              <h3>Role-Specific Tailoring</h3>
              <p>Every optimization is unique to the specific job you're applying for. Not generic advice — targeted results.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📋</div>
              <h3>One-Click Copy</h3>
              <p>Copy your optimized resume to clipboard instantly. Paste it wherever you need it — no downloads required.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔒</div>
              <h3>Private & Secure</h3>
              <p>Your resume data is never stored or shared. Each optimization is processed privately and discarded immediately.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
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