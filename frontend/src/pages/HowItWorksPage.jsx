import { Link } from 'react-router-dom'
import './HowItWorksPage.css'

const steps = [
  {
    number: '01',
    title: 'Upload your resume',
    text: 'Drop in your current resume as a PDF or Word doc. We read the content, not just the formatting.',
  },
  {
    number: '02',
    title: 'Paste the job description',
    text: 'Add the listing you\u2019re applying to. This is what we compare your resume against.',
  },
  {
    number: '03',
    title: 'Get instant analysis',
    text: 'See your match score, missing keywords, and specific lines an ATS or recruiter would flag.',
  },
  {
    number: '04',
    title: 'Download, optimized',
    text: 'Apply the suggested changes and export a clean, recruiter-ready resume in seconds.',
  },
]

const checks = [
  { icon: '\uD83D\uDD11', title: 'Keyword match', text: 'Flags the skills and terms from the job description that are missing from your resume.' },
  { icon: '\uD83D\uDCD0', title: 'ATS formatting', text: 'Checks for layout issues that cause tracking systems to misread or reject your resume.' },
  { icon: '\uD83D\uDCAA', title: 'Impact language', text: 'Points out weak, passive phrasing and suggests results-driven alternatives.' },
  { icon: '\uD83C\uDFAF', title: 'Role relevance', text: 'Highlights experience that matters most for this specific role \u2014 and what to cut.' },
]

export default function HowItWorksPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Simple process</span>
          <h1 className="page-hero-title">
            From resume to<br />
            <span className="page-hero-title-accent">interview, in minutes</span>
          </h1>
          <p className="page-hero-sub">
            No guesswork. Four steps between you and a resume built to get past the
            filter and in front of a person.
          </p>
        </div>
      </header>

      <section className="hiw-section">
        <div className="hiw-inner">
          <div className="hiw-grid">
            {steps.map((step) => (
              <div className="hiw-card" key={step.number}>
                <div className="hiw-number">{step.number}</div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hiw-section hiw-section-alt">
        <div className="hiw-inner">
          <p className="section-label">What we check</p>
          <h2 className="section-title">Four things recruiters and ATS software both care about</h2>
          <p className="section-sub hiw-section-sub">
            Every optimization runs through the same checks a hiring system would apply.
          </p>

          <div className="checks-grid">
            {checks.map((item) => (
              <div className="check-card" key={item.title}>
                <div className="check-icon">{item.icon}</div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-title">See it work on your own resume</h2>
          <p className="cta-sub">It takes about two minutes, start to finish.</p>
          <Link to="/signup" className="btn-primary-lg">Get started free</Link>
          <p className="cta-note">No credit card required</p>
        </div>
      </section>
    </div>
  )
}