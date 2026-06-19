import { Link, useNavigate } from 'react-router-dom'
import './Navbar.css'

export default function Navbar() {
  const navigate = useNavigate()

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <span className="nav-logo-mark">R</span>
          <span className="nav-logo-text">ResumeAI</span>
        </Link>

        <div className="nav-links">
          <Link to="/how-it-works" className="nav-link">How it works</Link>
          <Link to="/pricing" className="nav-link">Pricing</Link>
          <Link to="/about" className="nav-link">About</Link>
        </div>

        <div className="nav-actions">
          <Link to="/login" className="nav-btn-ghost">Log in</Link>
          <Link to="/signup" className="nav-btn-primary">Get started</Link>
        </div>
      </div>
    </nav>
  )
}