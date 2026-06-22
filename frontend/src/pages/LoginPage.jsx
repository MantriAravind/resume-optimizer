import { SignIn } from '@clerk/clerk-react'
import './AuthPages.css'

export default function LoginPage() {
  return (
    <div className="auth-page">
      <SignIn routing="path" path="/login" afterSignInUrl="/app" />
    </div>
  )
}