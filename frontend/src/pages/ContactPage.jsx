import { Link } from 'react-router-dom'
import './ContactPage.css'

export default function ContactPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Get in touch</span>
          <h1 className="page-hero-title">
            We&apos;re here<br />
            <span className="page-hero-title-accent">to help</span>
          </h1>
          <p className="page-hero-sub">
            Questions about your account, a job posting, or how the optimizer works —
            email us directly.
          </p>
        </div>
      </header>

      <section className="contact-section">
        <div className="contact-inner">
          <div className="contact-grid">
            <div className="contact-info">
              <div className="info-card">
                <h3>Email</h3>
                <p>support@optyply.com</p>
              </div>
              <div className="info-card">
                <h3>Response time</h3>
                <p>
                  Usually within 1 business day. Optyply is run by one person, so
                  replies come from a human, not a ticket system.
                </p>
              </div>
              <div className="info-card">
                <h3>Found a wrong job listing?</h3>
                <p>
                  If a posting slipped through that requires citizenship or refuses
                  sponsorship, email us the link — we use every report to make the
                  filter better.
                </p>
              </div>
            </div>

            <div className="contact-form-wrap">
              <div className="contact-success">
                <h3>Email us anything</h3>
                <p>
                  Bug reports, confusing results, feature ideas, or a job posting that
                  shouldn&apos;t be on the board — it all goes to the same inbox and it
                  all gets read.
                </p>
                <a
                  className="btn-primary-lg contact-submit"
                  href="mailto:support@optyply.com?subject=Optyply%20support"
                >
                  Email support@optyply.com
                </a>
                <p style={{ marginTop: 16 }}>
                  Prefer copy-paste? The address is support@optyply.com. Common questions
                  are answered on the <Link to="/faq">FAQ page</Link>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
