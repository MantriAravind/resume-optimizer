import { Link } from 'react-router-dom'
import './PricingPage.css'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    desc: 'Try it out before you commit.',
    features: [
      '3 resume optimizations / month',
      'Basic ATS compatibility check',
      'PDF export',
    ],
    cta: 'Get started',
    to: '/signup',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$12',
    period: 'per month',
    desc: 'For an active job search.',
    features: [
      'Unlimited resume optimizations',
      'Advanced keyword matching',
      'AI cover letter generator',
      'Priority support',
    ],
    cta: 'Start free trial',
    to: '/signup',
    featured: true,
  },
  {
    name: 'Team',
    price: '$39',
    period: 'per month',
    desc: 'For career centers and recruiting teams.',
    features: [
      'Everything in Pro',
      'Up to 5 seats',
      'Team usage analytics',
      'Dedicated onboarding',
    ],
    cta: 'Contact sales',
    to: '/contact',
    featured: false,
  },
]

export default function PricingPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Pricing</span>
          <h1 className="page-hero-title">
            Simple plans for<br />
            <span className="page-hero-title-accent">every job search</span>
          </h1>
          <p className="page-hero-sub">
            Start free. Upgrade when you need more. Cancel anytime.
          </p>
        </div>
      </header>

      <section className="pricing-section">
        <div className="pricing-inner">
          <div className="pricing-grid">
            {tiers.map((tier) => (
              <div
                className={tier.featured ? 'pricing-card pricing-card-featured' : 'pricing-card'}
                key={tier.name}
              >
                {tier.featured && <span className="pricing-badge">Most popular</span>}
                <h3 className="pricing-tier">{tier.name}</h3>
                <div className="pricing-price-row">
                  <span className="pricing-price">{tier.price}</span>
                  <span className="pricing-period">/ {tier.period}</span>
                </div>
                <p className="pricing-desc">{tier.desc}</p>
                <ul className="pricing-features">
                  {tier.features.map((f) => (
                    <li key={f}><span className="pricing-check">{'\u2713'}</span>{f}</li>
                  ))}
                </ul>
                <Link
                  to={tier.to}
                  className={tier.featured ? 'btn-primary-lg pricing-cta' : 'btn-ghost-dark pricing-cta'}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="pricing-footnote">
            No credit card required for Free &middot; Prices shown in USD &middot;{' '}
            <Link to="/faq">Have questions? Check the FAQ</Link>
          </p>
        </div>
      </section>
    </div>
  )
}