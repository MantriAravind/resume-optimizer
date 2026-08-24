import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function TermsPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Legal</span>
          <h1 className="page-hero-title">Terms of Service</h1>
          <p className="page-hero-sub">Last updated: August 24, 2026</p>
        </div>
      </header>

      <section className="legal-section">
        <div className="legal-inner">
          <div className="legal-disclaimer">
            Plain-language terms, not yet attorney-reviewed. We will have them reviewed
            before any paid plan exists. Questions: support@optyply.com.
          </div>

          <h2>What this service is</h2>
          <p>
            Optyply shows job postings that do not explicitly refuse visa sponsorship,
            and helps you tailor your resume to them using AI. By creating an account
            you agree to these terms.
          </p>

          <h2>What we do not promise</h2>
          <ul>
            <li>
              We filter out postings that explicitly require citizenship or a security
              clearance, or that state they won't sponsor. We <strong>cannot confirm that
              any employer will sponsor you</strong>. Always verify sponsorship with the
              employer before investing time in an application.
            </li>
            <li>
              We do not guarantee interviews, offers, or employment outcomes.
            </li>
            <li>
              Nothing on this site is legal or immigration advice. For questions about
              your visa status, talk to your DSO or an immigration attorney.
            </li>
          </ul>

          <h2>Price</h2>
          <p>
            The service is currently free. There is no billing, no subscription, and no
            payment collected. If a paid plan is introduced later, these terms will be
            updated first and you will never be charged without explicitly signing up
            for it.
          </p>

          <h2>Your resume, your responsibility</h2>
          <p>
            The optimizer rewrites what you actually did; it is built not to invent
            experience. You are responsible for reviewing every optimized resume before
            sending it and for making sure everything in it is true. Submitting false
            information to employers can have serious consequences, including for your
            visa status.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>Don't use the service to create misleading or fraudulent application
              materials.</li>
            <li>Don't attempt to disrupt, scrape, reverse-engineer, or gain unauthorized
              access to the service.</li>
            <li>Don't upload content that is unlawful or infringes on others' rights.</li>
          </ul>

          <h2>Your content</h2>
          <p>
            You own your resume and everything you upload. You give us permission to
            process and store it solely to provide the service to you. We claim no other
            rights to it.
          </p>

          <h2>Job postings</h2>
          <p>
            Postings are collected from employers' public applicant-tracking systems.
            They belong to the employers who posted them, and they can change or close
            at any time without notice.
          </p>

          <h2>Disclaimers and liability</h2>
          <p>
            The service is provided "as is," without warranties of any kind. To the
            fullest extent permitted by law, Optyply is not liable for indirect,
            incidental, or consequential damages arising from your use of the service.
          </p>

          <h2>Termination</h2>
          <p>
            We may suspend or terminate accounts that violate these terms. You can stop
            using the service, and request deletion of your data, at any time.
          </p>

          <h2>Changes</h2>
          <p>
            If these terms change, we will update this page and the date above.
            Continued use after changes means you accept them.
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
