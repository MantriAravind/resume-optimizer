import { useState } from 'react'
import { Link } from 'react-router-dom'
import './ContactPage.css'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', topic: 'General question', message: '' })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | sending | sent

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Enter your name.'
    if (!form.email.trim()) {
      next.email = 'Enter your email.'
    } else if (!emailPattern.test(form.email.trim())) {
      next.email = 'Enter a valid email address.'
    }
    if (!form.message.trim()) next.message = 'Enter a message.'
    else if (form.message.trim().length < 10) next.message = 'Message should be at least 10 characters.'
    return next
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setStatus('sending')
    // Demo only — no backend wired up yet. Swap this for a real API call later.
    setTimeout(() => {
      setStatus('sent')
    }, 900)
  }

  const handleReset = () => {
    setForm({ name: '', email: '', topic: 'General question', message: '' })
    setErrors({})
    setStatus('idle')
  }

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
            Questions about your account, billing, or how ResumeAI works — send us a message.
          </p>
        </div>
      </header>

      <section className="contact-section">
        <div className="contact-inner">
          <div className="contact-grid">
            <div className="contact-info">
              <div className="info-card">
                <h3>Email</h3>
                <p>support@resumeai.app</p>
              </div>
              <div className="info-card">
                <h3>Response time</h3>
                <p>Within 1 business day. Pro and Team plans get priority support.</p>
              </div>
              <div className="info-card">
                <h3>Before you write</h3>
                <p>Common questions are answered on the <Link to="/faq">FAQ page</Link> — worth a quick look first.</p>
              </div>
            </div>

            <div className="contact-form-wrap">
              {status === 'sent' ? (
                <div className="contact-success">
                  <div className="contact-success-icon">{'\u2713'}</div>
                  <h3>Message sent</h3>
                  <p>Thanks for reaching out — we&apos;ll get back to you within 1 business day.</p>
                  <button type="button" className="btn-ghost-dark" onClick={handleReset}>
                    Send another message
                  </button>
                </div>
              ) : (
                <form className="contact-form" onSubmit={handleSubmit} noValidate>
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="name">Name</label>
                      <input
                        id="name"
                        name="name"
                        type="text"
                        value={form.name}
                        onChange={handleChange}
                        className={errors.name ? 'input-error' : ''}
                        placeholder="Jane Doe"
                      />
                      {errors.name && <span className="form-error">{errors.name}</span>}
                    </div>

                    <div className="form-group">
                      <label htmlFor="email">Email</label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        value={form.email}
                        onChange={handleChange}
                        className={errors.email ? 'input-error' : ''}
                        placeholder="jane@example.com"
                      />
                      {errors.email && <span className="form-error">{errors.email}</span>}
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="topic">Topic</label>
                    <select id="topic" name="topic" value={form.topic} onChange={handleChange}>
                      <option>General question</option>
                      <option>Technical support</option>
                      <option>Billing</option>
                      <option>Partnership</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="message">Message</label>
                    <textarea
                      id="message"
                      name="message"
                      rows={5}
                      value={form.message}
                      onChange={handleChange}
                      className={errors.message ? 'input-error' : ''}
                      placeholder="How can we help?"
                    />
                    {errors.message && <span className="form-error">{errors.message}</span>}
                  </div>

                  <button type="submit" className="btn-primary-lg contact-submit" disabled={status === 'sending'}>
                    {status === 'sending' ? 'Sending…' : 'Send message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}