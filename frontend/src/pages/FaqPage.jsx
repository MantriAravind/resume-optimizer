import { useState } from 'react'
import { Link } from 'react-router-dom'
import './FaqPage.css'

const faqs = [
  {
    q: 'Is Optyply free to use?',
    a: 'Yes \u2014 everything on the site is free right now, no credit card, no limits. A paid plan is planned for the future; when it exists, the free features you use today will stay free or you will be told clearly before anything changes.',
  },
  {
    q: 'Does every job on the board sponsor visas?',
    a: 'No, and we won\u2019t pretend otherwise. We remove postings that explicitly require US citizenship or a security clearance, or that state they won\u2019t sponsor. What remains are jobs that don\u2019t rule you out in the posting \u2014 but only the employer can confirm whether they\u2019ll actually sponsor. Always verify before investing serious time.',
  },
  {
    q: 'A job on the board turned out to require citizenship. What do I do?',
    a: 'Email the link to support@optyply.com. Some postings phrase requirements in ways our filter hasn\u2019t seen yet, and every report makes it better. This genuinely helps.',
  },
  {
    q: 'How does the resume optimizer work?',
    a: 'It reads your resume against the specific job description, then rewrites your bullet points to match the role\u2019s language and requirements \u2014 using only experience you actually have. It is built not to invent anything. Still, always read the result before sending it: you are responsible for everything in your resume.',
  },
  {
    q: 'Is my resume kept private?',
    a: 'Yes. Your resume text is stored so the tool works for you, and it is never sold, never shared with employers or third parties, and never used to train AI models. Details are in our privacy policy.',
  },
  {
    q: 'How do I delete my account and data?',
    a: 'Email support@optyply.com from your account email and ask. Your account and stored resume text will be deleted within 30 days, with a confirmation reply. An in-app delete button is on the roadmap.',
  },
  {
    q: 'What file formats are supported?',
    a: 'Upload PDF or Word (.docx). Export your optimized resume as PDF or Word.',
  },
  {
    q: 'Will this guarantee me an interview?',
    a: 'No, and be suspicious of any tool that claims it can. Hiring depends on many factors we don\u2019t control. What Optyply does is stop you wasting applications on jobs that would reject you for your visa status, and make each remaining application better targeted.',
  },
  {
    q: 'Where do the job postings come from?',
    a: 'Directly from employers\u2019 public applicant-tracking systems (Greenhouse, SmartRecruiters, and Ashby), refreshed several times a day. Postings can close or change at any time \u2014 that\u2019s in the employer\u2019s hands, not ours.',
  },
  {
    q: 'Is this immigration advice?',
    a: 'No. Nothing here is legal or immigration advice. For anything about your F1/CPT/OPT status, talk to your DSO or an immigration attorney.',
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
          <p className="cta-sub">We&apos;re happy to help &mdash; reach out and we&apos;ll get back to you quickly.</p>
          <Link to="/contact" className="btn-primary-lg">Contact us</Link>
        </div>
      </section>
    </div>
  )
}
