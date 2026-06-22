import { Link } from 'react-router-dom'
import { SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import './Navbar.css'

export default function Navbar() {
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
          <SignedOut>
            <Link to="/login" className="nav-btn-ghost">Log in</Link>
            <Link to="/signup" className="nav-btn-primary">Get started</Link>
          </SignedOut>
          <SignedIn>
            <Link to="/app" className="nav-btn-ghost">My dashboard</Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </div>
    </nav>
  )
}