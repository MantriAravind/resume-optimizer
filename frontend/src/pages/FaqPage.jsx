import { useState } from 'react'
import { Link } from 'react-router-dom'
import './FaqPage.css'

const faqs = [
  {
    q: 'Is ResumeAI free to use?',
    a: 'Yes. The Free plan includes 3 resume optimizations a month at no cost, no credit card required. Upgrade to Pro any time you need more.',
  },
  {
    q: 'How does the AI analyze my resume?',
    a: 'It compares your resume against the job description you provide, checking for keyword overlap, formatting issues that trip up ATS software, and weak or passive phrasing.',
  },
  {
    q: 'Is my resume data kept private?',
    a: 'Yes. Your resume and any job descriptions you upload are never sold or shared with third parties. You can delete your data at any time from your account.',
  },
  {
    q: 'What file formats are supported?',
    a: 'You can upload PDF or Word (.docx) files, and export your optimized resume as a PDF.',
  },
  {
    q: 'Will this guarantee me an interview?',
    a: 'No tool can guarantee an interview \u2014 hiring decisions depend on many factors. What we can do is meaningfully improve your odds of getting past automated filters and in front of a human reviewer.',
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. Pro and Team plans are billed monthly with no long-term contract, and you can cancel from your account settings at any time.',
  },
  {
    q: 'Do you offer support if I get stuck?',
    a: 'Yes. Reach out through the contact page and we\u2019ll get back to you \u2014 Pro and Team plans get priority response times.',
  },
  {
    q: 'How is this different from a generic resume template?',
    a: 'A template gives you a static layout. ResumeAI reads your actual resume against a specific job description and tells you exactly what to change for that role \u2014 it adapts every time, a template never does.',
  },
]

export default function FaqPage() {
  const [openIndex, setOpenIndex] = useState(null)

  const toggle = (index) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">FAQ</span>
          <h1 className="page-hero-title">
            Frequently asked<br />
            <span className="page-hero-title-accent">questions</span>
          </h1>
          <p className="page-hero-sub">
            Can&apos;t find what you&apos;re looking for? Reach out and we&apos;ll help directly.
          </p>
        </div>
      </header>

      <section className="faq-section">
        <div className="faq-inner">
          <div className="faq-list">
            {faqs.map((item, index) => {
              const isOpen = openIndex === index
              return (
                <div className={isOpen ? 'faq-item faq-item-open' : 'faq-item'} key={item.q}>
                  <button
                    type="button"
                    className="faq-question"
                    onClick={() => toggle(index)}
                    aria-expanded={isOpen}
                  >
                    <span>{item.q}</span>
                    <span className="faq-chevron" aria-hidden="true">{'\u2304'}</span>
                  </button>
                  {isOpen && <p className="faq-answer">{item.a}</p>}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-title">Still have questions?</h2>
          <p className="cta-sub">We&apos;re happy to help — reach out and we&apos;ll get back to you quickly.</p>
          <Link to="/contact" className="btn-primary-lg">Contact us</Link>
        </div>
      </section>
    </div>
  )
}