import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function PrivacyPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Legal</span>
          <h1 className="page-hero-title">Privacy Policy</h1>
          <p className="page-hero-sub">Last updated: August 24, 2026</p>
        </div>
      </header>

      <section className="legal-section">
        <div className="legal-inner">
          <div className="legal-disclaimer">
            We wrote this in plain language so you can actually read it. It has not yet
            been reviewed by an attorney; we will do that before we charge anyone money.
            If anything here is unclear, email us and we will answer honestly.
          </div>

          <h2>Who we are</h2>
          <p>
            Optyply (optyply.com) is a job board and resume optimization tool built for
            international students in the United States. It is run by a solo developer.
            You can reach us at support@optyply.com.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account details</strong> — your email address, and your name if you
              provide it. Sign-in is handled by Clerk, our authentication provider.
            </li>
            <li>
              <strong>Resume text</strong> — when you upload a resume, we extract the text
              and store that text. The uploaded file is kept too, so a tailored resume can be returned in your own layout.
            </li>
            <li>
              <strong>Your activity in the app</strong> — jobs you track and resumes you
              generate, so your tracker and history work.
            </li>
          </ul>

          <h2>What we deliberately don't do</h2>
          <ul>
            <li>No analytics or tracking scripts. No Google Analytics, no ad pixels.</li>
            <li>We do not sell or rent your information to anyone.</li>
            <li>We never send your resume to employers or any third party unless you
              yourself choose to apply somewhere.</li>
            <li>We do not use your resume to train AI models.</li>
          </ul>

          <h2>How your resume is processed</h2>
          <p>
            When you upload a resume or optimize it against a job posting, the text is
            sent to Anthropic's Claude API for analysis and rewriting, under Anthropic's
            commercial terms. The results come back to us and are stored with your
            account so you can access them again.
          </p>

          <h2>Where your data lives</h2>
          <p>
            Account data is held by Clerk. Resume text and app data are stored in MongoDB
            Atlas. The site runs on Vercel and Render. All connections use HTTPS.
          </p>

          <h2>Deleting your data</h2>
          <p>
            Email support@optyply.com from your account email and ask us to delete your
            account. We will delete your account and stored resume text within 30 days
            and confirm by reply. An in-app delete button is planned.
          </p>

          <h2>Security</h2>
          <p>
            We use encrypted connections and restrict access to stored data. No system is
            perfectly secure, and we won't pretend otherwise; we will tell you if we
            learn of a breach affecting your data.
          </p>

          <h2>Children</h2>
          <p>
            The service is for university students and graduates. It is not directed at
            children under 13, and we do not knowingly collect their information.
          </p>

          <h2>Changes</h2>
          <p>
            If this policy changes in a way that matters, we will update this page and
            the date above.
          </p>

          <h2>Contact</h2>
          <p>
            support@optyply.com, or through the <Link to="/contact">contact page</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}
