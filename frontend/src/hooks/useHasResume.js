import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://resume-optimizer-cuii.onrender.com'

/**
 * Reports whether the signed-in user has a saved resume, and returns their profile.
 *
 * The profile rides along on the same request because the board needs profile.field to
 * decide which jobs to show. Fetching it separately would render the board unfiltered
 * and then visibly jump once the field arrived.
 *
 * Returns { loading, hasResume, error }.
 *
 * WHY `loading` MATTERS MORE THAN THE ANSWER
 * The board redirects to onboarding when hasResume is false. If a caller treats
 * "not loaded yet" as "no resume", a user who HAS one gets bounced to onboarding,
 * saves again, lands on the board, gets bounced again — a loop that locks people out
 * of the product entirely, including whoever is testing it.
 *
 * So hasResume stays null until the server actually answers, and callers must render
 * a waiting state rather than deciding. On Render's free tier a cold start can take
 * close to a minute, which makes this a real wait, not a theoretical one.
 *
 * ON FAILURE, FAIL OPEN
 * A network error sets error and leaves hasResume null. Callers should let the user
 * through rather than trap them in onboarding: showing the board to someone without a
 * resume is a small problem, locking out someone who has one is a large one.
 */
export function useHasResume() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const [state, setState] = useState({ loading: true, hasResume: null, profile: null, error: null })

  useEffect(() => {
    let cancelled = false

    // Clerk has not resolved yet — there is no token to send.
    if (!isLoaded) return

    if (!isSignedIn) {
      setState({ loading: false, hasResume: false, profile: null, error: null })
      return
    }

    async function check() {
      try {
        const token = await getToken()
        const res = await fetch(`${BACKEND}/me/resume`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setState({ loading: false, hasResume: Boolean(data.hasResume), profile: data.profile || {}, error: null })
      } catch (err) {
        if (cancelled) return
        setState({ loading: false, hasResume: null, profile: null, error: err.message || 'check failed' })
      }
    }

    check()
    return () => { cancelled = true }
  }, [getToken, isLoaded, isSignedIn])

  return state
}
