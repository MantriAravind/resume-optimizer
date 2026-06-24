import { Link, useLocation, useNavigate } from 'react-router-dom'
import { SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import './Navbar.css'

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()

  function handleScroll(sectionId) {
    if (location.pathname === '/') {
      const el = document.getElementById(sectionId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      navigate('/')
      setTimeout(() => {
        const el = document.getElementById(sectionId)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 300)
    }
  }

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <span className="nav-logo-mark">R</span>
          <span className="nav-logo-text">ResumeAI</span>
        </Link>

        <div className="nav-links">
          <button className="nav-link" onClick={() => handleScroll('how-it-works')}>How it works</button>
          <button className="nav-link" onClick={() => handleScroll('pricing')}>Pricing</button>
          <button className="nav-link" onClick={() => handleScroll('about')}>About</button>
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