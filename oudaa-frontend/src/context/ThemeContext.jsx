import { createContext, useContext, useEffect, useState } from 'react'
import api, { endpoints } from '../lib/api'
import { AuthContext } from './AuthContext'

const ThemeContext = createContext(null)

// Device-level fallback so the theme survives logout, page reload, and
// the login screen itself — none of which have a signed-in user to read
// a saved preference from. The database preference (below) is still the
// source of truth once someone's signed in, and always wins over this
// when the two disagree; this is just what's shown before/without that.
const STORAGE_KEY = 'oudaa-theme'

function readStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

function writeStoredTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private browsing / storage disabled — theme just won't survive a
    // reload in that case, which is a reasonable degradation.
  }
}

function applyTheme(theme) {
  const root = document.documentElement

  // Kill every transition on the page for one frame so the class flip
  // below is instant (no color/background fade), then restore normal
  // transitions (hover states, sidebar collapse, etc.) right after.
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after { transition: none !important; }'
  document.head.appendChild(style)

  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')

  // Force a reflow so the class change is applied under "no transition",
  // then remove the override on the next frame.
  window.getComputedStyle(style).opacity
  requestAnimationFrame(() => {
    document.head.removeChild(style)
  })
}

export function ThemeProvider({ children }) {
  // Read the context directly (not via the throwing useAuth() hook):
  // the platform-admin build intentionally mounts ThemeProvider without
  // an AuthProvider above it (see main.jsx), since that origin has no
  // community user session at all. In that case ctx is null and we just
  // fall back to the device-level theme below, same as a logged-out user.
  const authCtx = useContext(AuthContext)
  const user = authCtx?.user ?? null
  const patchUser = authCtx?.patchUser ?? null
  // Initial theme, in priority order: (1) a signed-in user's saved
  // preference if we already have one on first render, (2) whatever this
  // device last had active (localStorage — this is what makes the login
  // screen and logged-out state match your last choice instead of always
  // starting bright), (3) the OS/browser's own color-scheme preference,
  // (4) light, as the final fallback.
  const [theme, setTheme] = useState(() => {
    if (user?.preferences?.theme) return user.preferences.theme === 'dark' ? 'dark' : 'light'
    const stored = readStoredTheme()
    if (stored) return stored
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  // Only an explicit DB-backed preference should override the current
  // theme here — on login (or /auth/me resolving with a saved value).
  // Logging OUT must NOT force this back to light: `user` becomes null,
  // but the device should just keep showing whatever theme was already
  // active (see the localStorage fallback above), not snap back to the
  // bright default in the middle of someone's session.
  useEffect(() => {
    if (user?.preferences?.theme) {
      setTheme(user.preferences.theme === 'dark' ? 'dark' : 'light')
    }
  }, [user?.id, user?.preferences?.theme])

  useEffect(() => {
    applyTheme(theme)
    writeStoredTheme(theme)
  }, [theme])

  function persistTheme(next) {
    setTheme(next)
    if (!user) return
    patchUser({ preferences: { ...(user.preferences || {}), theme: next } })
    api.patch(endpoints.myPreferences(), { theme: next }).catch(() => {})
  }

  function toggleTheme() {
    persistTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: persistTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

