import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'
import { useHasResume } from './hooks/useHasResume'
import ToolPage from './pages/ToolPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import AboutPage from './pages/AboutPage'
import HowItWorksPage from './pages/HowItWorksPage'
import PricingPage from './pages/PricingPage'
import FaqPage from './pages/FaqPage'
import ContactPage from './pages/ContactPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import JobBoard from './pages/JobBoard'
import ProfilePage from './pages/ProfilePage'
import OnboardingResume from './pages/OnboardingResume'
import SharedJobPage from './pages/SharedJobPage'

/** Signed in, or bounced to sign-in. No resume check. */
function ProtectedRoute({ children }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><RedirectToSignIn /></SignedOut>
    </>
  )
}

/**
 * Shown while the resume check is in flight. Deliberately a real screen rather than
 * null: Render's free tier sleeps, so the first request of the day can take close to
 * a minute, and a blank page for that long reads as a crash.
 */
function Waiting() {
  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      fontFamily: "'Space Grotesk', -apple-system, sans-serif", color: '#6B7280', fontSize: 14,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 30, height: 30, border: '3px solid #E5E7EB', borderTopColor: '#2563EB',
          borderRadius: '50%', margin: '0 auto 14px', animation: 'spin .7s linear infinite',
        }} />
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
        Loading…
      </div>
    </div>
  )
}

/**
 * Requires a saved resume on top of being signed in.
 *
 * THE LOOP THIS AVOIDS
 * Three states matter: not signed in, signed in without a resume, signed in with one.
 * If "still checking" is treated as "no resume", a user who HAS one is sent to
 * onboarding, saves again, returns, and is sent back — forever. So this renders
 * Waiting until the server answers, and never decides on missing information.
 *
 * On error it lets the user through. Showing the board to someone without a resume is
 * a small problem; locking out someone who has one is a large one.
 */
function RequireResume({ children }) {
  const { loading, hasResume, error } = useHasResume()
  if (loading) return <Waiting />
  if (error) return children
  if (!hasResume) return <Navigate to="/onboarding/resume" replace />
  return children
}

/**
 * The board, with one exception carved out.
 *
 * A shared link (/jobs?job=<id>) opened by someone with no account shows that single
 * job in full, Apply included, with a sign-up prompt underneath — see SharedJobPage
 * for why. Every other path into the board needs an account and a resume.
 */
function JobsRoute() {
  const [params] = useSearchParams()
  const sharedJobId = params.get('job')

  return (
    <>
      <SignedOut>
        {sharedJobId
          ? <SharedJobPage jobId={sharedJobId} />
          : <RedirectToSignIn />}
      </SignedOut>
      <SignedIn>
        <RequireResume><JobBoard /></RequireResume>
      </SignedIn>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login/*" element={<LoginPage />} />
        <Route path="/signup/*" element={<SignupPage />} />

        {/* Signed in but no resume yet. Must NOT require a resume, or it cannot be
            reached to add one. */}
        <Route path="/onboarding/resume" element={<ProtectedRoute><OnboardingResume /></ProtectedRoute>} />

        {/* Needs a resume: both of these are useless without one. */}
        <Route path="/jobs" element={<JobsRoute />} />
        <Route path="/app" element={<ProtectedRoute><RequireResume><ToolPage /></RequireResume></ProtectedRoute>} />

        {/* Reachable without a resume — this is where a wrong or missing one gets fixed. */}
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

        <Route path="/about" element={<AboutPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
