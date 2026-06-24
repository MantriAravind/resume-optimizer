import { Link } from 'react-router-dom'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="footer-logo">
            <span className="footer-logo-mark">R</span>
            <span className="footer-logo-text">ResumeAI</span>
          </div>
          <p className="footer-tagline">Land more interviews with AI-optimized resumes.</p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <h4>Product</h4>
            <Link to="/how-it-works">How it works</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/app">Try it now</Link>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <Link to="/about">About</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/faq">FAQ</Link>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© 2026 ResumeAI. All rights reserved.</p>
        <p>Resume optimization, reimagined.</p>
      </div>
    </footer>
  )
}