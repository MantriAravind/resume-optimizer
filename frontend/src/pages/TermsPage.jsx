import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function TermsPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Legal</span>
          <h1 className="page-hero-title">Terms of Service</h1>
          <p className="page-hero-sub">Last updated: June 19, 2026</p>
        </div>
      </header>

      <section className="legal-section">
        <div className="legal-inner">
          <div className="legal-disclaimer">
            This is placeholder terms text for a site still in development. It is not
            legal advice and should be reviewed and finalized by a licensed attorney
            before the site launches to real users.
          </div>

          <h2>Acceptance of terms</h2>
          <p>
            By creating an account or using ResumeAI, you agree to these Terms of Service.
            If you do not agree, please do not use the service.
          </p>

          <h2>Description of service</h2>
          <p>
            ResumeAI provides AI-assisted analysis and optimization of resumes against
            job descriptions you provide. Suggestions are generated automatically and
            are not a guarantee of employment or interview outcomes.
          </p>

          <h2>Accounts</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account
            credentials and for all activity that occurs under your account.
          </p>

          <h2>Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Upload content that is unlawful, fraudulent, or infringes on others' rights.</li>
            <li>Attempt to disrupt, reverse-engineer, or gain unauthorized access to the service.</li>
            <li>Use the service to generate misleading or fraudulent application materials.</li>
          </ul>

          <h2>Your content</h2>
          <p>
            You retain ownership of the resumes and content you submit. By uploading
            content, you grant us a limited license to process it solely for the purpose
            of providing the optimization service to you.
          </p>

          <h2>Subscriptions and billing</h2>
          <p>
            Paid plans are billed on a recurring basis until canceled. You may cancel at
            any time from your account settings; cancellation takes effect at the end of
            the current billing period.
          </p>

          <h2>Disclaimers</h2>
          <p>
            The service is provided "as is" without warranties of any kind. We do not
            guarantee that optimization suggestions will result in interviews or job offers.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, ResumeAI is not liable for indirect,
            incidental, or consequential damages arising from your use of the service.
          </p>

          <h2>Termination</h2>
          <p>
            We may suspend or terminate access to the service for violation of these terms.
          </p>

          <h2>Changes to these terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the service
            after changes constitutes acceptance of the updated terms.
          </p>

          <h2>Contact us</h2>
          <p>
            Questions about these terms? <Link to="/contact">Reach out through our contact page</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}