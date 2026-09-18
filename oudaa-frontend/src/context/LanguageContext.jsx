import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import api, { endpoints } from '../lib/api'
import en from '../localization/en.json'
import am from '../localization/am.json'
import { initializeRuntimeLocalization, setRuntimeLanguage } from '../localization/runtimeTranslator'

export const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English' },
  { id: 'am', label: 'አማርኛ' },
]

const SUPPORTED = new Set(LANGUAGE_OPTIONS.map((item) => item.id))
const STORAGE_KEY = 'oudaa-language'
const CATALOGS = { en, am }
const LanguageContext = createContext(null)

function resolveInitialLanguage(user) {
  const preferred = user?.preferences?.language
  if (SUPPORTED.has(preferred)) return preferred
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (SUPPORTED.has(stored)) return stored
  } catch {
    // Storage is optional; English remains the safe fallback.
  }
  return 'en'
}

export function LanguageProvider({ children }) {
  const { user, patchUser } = useAuth()
  const [language, setLanguageState] = useState(() => resolveInitialLanguage(user))

  useEffect(() => {
    const preferred = user?.preferences?.language
    if (SUPPORTED.has(preferred)) setLanguageState(preferred)
  }, [user?.id, user?.preferences?.language])

  useEffect(() => {
    initializeRuntimeLocalization(en, am)
    return () => {}
  }, [])

  useEffect(() => {
    setRuntimeLanguage(language)
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Ignore private browsing/storage-disabled environments.
    }
    document.documentElement.lang = language
    document.documentElement.dir = 'ltr'
  }, [language])

  async function setLanguage(next) {
    if (!SUPPORTED.has(next) || next === language) return
    setLanguageState(next)

    if (user?.id) {
      const nextPreferences = { ...(user.preferences || {}), language: next }
      patchUser({ preferences: nextPreferences })
      try {
        await api.patch(endpoints.myPreferences(), { language: next })
      } catch {
        // The local preference still applies if persistence is unavailable.
      }
    }
  }

  const value = useMemo(() => ({
    language,
    setLanguage,
    options: LANGUAGE_OPTIONS,
    t: (key, fallback = key) => CATALOGS[language]?.[key] || CATALOGS.en?.[key] || fallback,
  }), [language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
