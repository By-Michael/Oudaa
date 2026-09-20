import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import platformApi, {
  platformEndpoints,
  getStoredPlatformToken,
  setStoredPlatformToken,
  getStoredPlatformAdmin,
  setStoredPlatformAdmin,
} from '../lib/platformApi'

// A completely separate context/provider from ../../context/AuthContext —
// intentionally not composed with it, so platform-admin identity can never
// leak into (or be confused with) the community user session, and so this
// provider can be lifted verbatim into a standalone admin app later without
// dragging the community AuthProvider along.
const PlatformAuthContext = createContext(null)

export function PlatformAuthProvider({ children }) {
  const [admin, setAdmin] = useState(() => getStoredPlatformAdmin())
  const [loading, setLoading] = useState(true)
  const [mfaChallenge, setMfaChallenge] = useState(null) // { email, password } while awaiting MFA code

  const loadMe = useCallback(async () => {
    try {
      // On a fresh page load there is intentionally no access token in web
      // storage. Rehydrate it from the HttpOnly refresh cookie first.
      if (!getStoredPlatformToken()) {
        const { data } = await platformApi.post(platformEndpoints.refresh())
        setStoredPlatformToken(data.data.accessToken)
        setStoredPlatformAdmin(data.data.admin)
      }
      const { data } = await platformApi.get(platformEndpoints.me())
      setAdmin(data.data)
      setStoredPlatformAdmin(data.data)
    } catch {
      setStoredPlatformToken(null)
      setStoredPlatformAdmin(null)
      setAdmin(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMe()
    const onExpire = () => setAdmin(null)
    window.addEventListener('hivee:platform-session-expired', onExpire)
    return () => window.removeEventListener('hivee:platform-session-expired', onExpire)
  }, [loadMe])

  const login = useCallback(async ({ email, password, mfaCode, recoveryCode }) => {
    const { data } = await platformApi.post(platformEndpoints.login(), { email, password, mfaCode, recoveryCode })
    if (data.mfaRequired) {
      setMfaChallenge({ email, password })
      return { mfaRequired: true }
    }
    setStoredPlatformToken(data.data.accessToken)
    setStoredPlatformAdmin(data.data.admin)
    setAdmin(data.data.admin)
    setMfaChallenge(null)
    return { mfaRequired: false }
  }, [])

  const submitMfaCode = useCallback(
    async (mfaCode) => {
      if (!mfaChallenge) throw new Error('No MFA challenge in progress')
      return login({ ...mfaChallenge, mfaCode })
    },
    [mfaChallenge, login]
  )

  const logout = useCallback(async () => {
    try {
      await platformApi.post(platformEndpoints.logout())
    } catch {
      // best-effort; clear local state regardless
    }
    setStoredPlatformToken(null)
    setStoredPlatformAdmin(null)
    setAdmin(null)
  }, [])

  const value = {
    admin,
    loading,
    isAuthenticated: !!admin,
    mfaChallenge,
    login,
    submitMfaCode,
    logout,
    refreshMe: loadMe,
  }

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>
}

export function usePlatformAuth() {
  const ctx = useContext(PlatformAuthContext)
  if (!ctx) throw new Error('usePlatformAuth must be used within a PlatformAuthProvider')
  return ctx
}
