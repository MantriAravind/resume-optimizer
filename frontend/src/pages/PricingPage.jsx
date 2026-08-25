import { Link } from 'react-router-dom'
import './PricingPage.css'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'today',
    desc: 'Everything currently on the site, at no cost.',
    features: [
      'Visa-filtered job board',
      'Resume optimization against any posting',
      'ATS compatibility score',
      'PDF and Word export',
      'Application tracker',
    ],
    cta: 'Get started',
    to: '/signup',
    featured: false,
    available: true,
  },
  {
    name: 'Pro',
    price: 'Coming soon',
    period: null,
    desc: 'Planned. Not available yet, and nothing to pay for today.',
    features: [
      'Unlimited resume optimizations',
      'Cover letter generator',
      'Sponsorship history for each company',
      'Saved jobs and alerts',
    ],
    cta: 'Join the waitlist',
    to: '/signup',
    featured: true,
    available: false,
  },
]

export default function PricingPage() {
  return (
    <div className="page">
      <header className="page-hero">
        <div className="page-hero-inner">
          <span className="page-hero-badge">Pricing</span>
          <h1 className="page-hero-title">
            Free while we<br />
            <span className="page-hero-title-accent">build with you</span>
          </h1>
          <p className="page-hero-sub">
            Everything on the site is free right now. A paid plan is planned;
            we will say what it costs when it exists.
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
                {tier.featured && <span className="pricing-badge">Planned</span>}
                <h3 className="pricing-tier">{tier.name}</h3>
                <div className="pricing-price-row">
                  <span className="pricing-price">{tier.price}</span>
                  {tier.period && <span className="pricing-period">/ {tier.period}</span>}
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
            No credit card, no payment collected &middot; Pro features listed are plans, not promises
          </p>
        </div>
      </section>
    </div>
  )
}
