import { createContext, useContext, useEffect, useState } from 'react'
import api, { endpoints } from '../lib/api'
import { notify } from '../components/ui'

const AuthContext = createContext(null)

const AVATAR_COLORS = ['#1554d6', '#2570f5', '#5aa4ff', '#a9caff', '#0c1c44']
function avatarColorFor(id) {
  if (!id) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

// Normalizes the backend's User (+ optional resident/community includes)
// into the flat shape every page in this app already expects.
function normalizeUser(u) {
  if (!u) return null
  const role = (u.role || 'RESIDENT').toLowerCase()
  return {
    id: u.id,
    name: u.fullName,
    email: u.email,
    role,
    rawRole: u.role,
    community: u.community?.name || '',
    communityId: u.communityId,
    // Drives every /<slug>/admin or /<slug>/resident URL in the app (see
    // lib/paths.js#portalBase) — comes from the community relation the
    // backend already includes on both /auth/login and /auth/me.
    communitySlug: u.community?.slug || null,
    residentId: u.resident?.id,
    unitNumber: u.resident?.unitNumber,
    avatarColor: avatarColorFor(u.id),
    // Real database fields now — profile picture and cross-device
    // preferences (theme, sidebar state, notification mutes, default
    // export format) instead of per-browser localStorage.
    avatarUrl: u.avatarUrl || null,
    preferences: u.preferences || {},
  }
}

// Credentials for the accounts created by `npm run seed` in oudaa-backend —
// used only to prefill the login form's "Try the demo" buttons. Clicking
// one still authenticates against the real API, same as typing them in by
// hand; nothing here is a stand-in for real data.
const DEMO_LOGINS = [
  { role: 'admin', email: 'admin@greenwood.example', phone: '', password: 'Password123!' },
  { role: 'resident', email: 'bob@greenwood.example', phone: '', password: 'Password123!' },
]

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('oudaa_user')
    return raw ? JSON.parse(raw) : null
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    if (user) localStorage.setItem('oudaa_user', JSON.stringify(user))
    else localStorage.removeItem('oudaa_user')
  }, [user])

  // Fired by the api client when a 401 survives a refresh attempt (refresh
  // cookie missing/expired/revoked) — the session is genuinely over, so
  // reflect that in state instead of leaving stale user data around while
  // every subsequent request silently 401s. Only shown when there *was* a
  // logged-in user, so it never fires spuriously on the login page itself.
  useEffect(() => {
    function handleExpired() {
      setUser((prev) => {
        if (prev) notify('Your session expired. Please sign in again.', 'info')
        return null
      })
    }
    window.addEventListener('oudaa:session-expired', handleExpired)
    return () => window.removeEventListener('oudaa:session-expired', handleExpired)
  }, [])

  // On first load, if we already have an access token, re-validate it
  // against /auth/me instead of trusting the cached profile forever.
  useEffect(() => {
    const token = localStorage.getItem('oudaa_token')
    if (!token) {
      setBootstrapped(true)
      return
    }
    api
      .get(endpoints.me())
      .then(({ data }) => setUser(normalizeUser(data.data)))
      .catch((err) => {
        // Only treat this as "the session is really gone" on a definitive
        // 401 that survived the api client's own refresh-and-retry (see
        // lib/api.js) — that's the one case where clearing the cached user
        // is correct. Anything else (a dropped connection, a slow backend
        // waking up, a one-off 500) is a transient failure, not proof the
        // token is invalid, and was previously logging people out of an
        // otherwise-live session just because /auth/me hiccuped once on
        // page load. Leave the cached user in place so the UI keeps
        // working off it; the next successful request will refresh it.
        if (err?.response?.status === 401) {
          localStorage.removeItem('oudaa_token')
          localStorage.removeItem('oudaa_user')
          setUser(null)
        }
      })
      .finally(() => setBootstrapped(true))
  }, [])

  async function login(identifier, password, communitySlug) {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post(endpoints.login(), { identifier, password, communitySlug })
      localStorage.setItem('oudaa_token', data.data.accessToken)
      // The login response already includes resident/community relations
      // (see authController.login), so no follow-up /auth/me round trip
      // is needed before the data-loading batch can start.
      const safe = normalizeUser(data.data.user)
      setUser(safe)
      return safe
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Login failed.'
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }

  // Used by the setup wizard (Signup.jsx) once /auth/register-community
  // has already created the community + admin user and returned a session
  // token — this just adopts that session the same way `login` does, so
  // the new admin lands in the app already signed in instead of being
  // bounced back to a login form right after finishing signup.
  function adoptSession(accessToken, rawUser) {
    localStorage.setItem('oudaa_token', accessToken)
    const safe = normalizeUser(rawUser)
    setUser(safe)
    return safe
  }

  function logout() {
    // Clear local state immediately so the UI updates instantly — don't
    // wait on the network round trip. The server call is best-effort
    // (revokes the refresh cookie) and its result is ignored either way,
    // so there's nothing gained by blocking the sign-out on it.
    localStorage.removeItem('oudaa_token')
    localStorage.removeItem('oudaa_user')
    setUser(null)
    api.post(endpoints.logout()).catch(() => {})
  }

  // Merges a partial patch (e.g. { avatarUrl } or { preferences }) into the
  // cached user after a successful API call, so the UI reflects the change
  // immediately without a full /auth/me round trip. The database row is
  // always the source of truth — this just keeps the in-memory/localStorage
  // copy of it in sync.
  function patchUser(patch) {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, error, bootstrapped, demoLogins: DEMO_LOGINS, patchUser, adoptSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
