import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function PrivacyPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Legal</span>
          <h1 className="page-hero-title">Privacy Policy</h1>
          <p className="page-hero-sub">Last updated: June 19, 2026</p>
        </div>
      </header>

      <section className="legal-section">
        <div className="legal-inner">
          <div className="legal-disclaimer">
            This is placeholder policy text for a site still in development. It is not
            legal advice and should be reviewed and finalized by a licensed attorney
            before the site launches to real users.
          </div>

          <h2>Overview</h2>
          <p>
            This Privacy Policy describes how ResumeAI ("we," "us") collects, uses, and
            protects information when you use our website and resume optimization service.
          </p>

          <h2>Information we collect</h2>
          <p>We collect the following types of information:</p>
          <ul>
            <li>Account information you provide, such as your name and email address.</li>
            <li>Resume content and job descriptions you upload or paste for optimization.</li>
            <li>Usage data, such as pages visited and features used, to help us improve the product.</li>
          </ul>

          <h2>How we use your information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide and improve the resume optimization service.</li>
            <li>Process your resume against job descriptions using AI analysis.</li>
            <li>Communicate with you about your account or support requests.</li>
          </ul>

          <h2>Data storage and security</h2>
          <p>
            We take reasonable measures to protect your information, including encrypted
            connections and restricted access to stored data. No method of transmission
            or storage is completely secure, and we cannot guarantee absolute security.
          </p>

          <h2>Third-party services</h2>
          <p>
            Resume analysis is processed using a third-party AI service. We do not sell
            your personal information to advertisers or data brokers.
          </p>

          <h2>Your rights and choices</h2>
          <p>
            You can access, update, or delete your account information at any time from
            your account settings, or by contacting us directly.
          </p>

          <h2>Children's privacy</h2>
          <p>
            This service is not directed at children under 13, and we do not knowingly
            collect information from children under 13.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We may update this policy from time to time. Material changes will be posted
            on this page with an updated date.
          </p>

          <h2>Contact us</h2>
          <p>
            Questions about this policy? <Link to="/contact">Reach out through our contact page</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}