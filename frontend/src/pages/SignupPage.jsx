import { SignUp } from '@clerk/clerk-react'
import './AuthPages.css'

export default function SignupPage() {
  return (
    <div className="auth-page">
      <SignUp routing="path" path="/signup" afterSignUpUrl="/jobs" />
    </div>
  )
}