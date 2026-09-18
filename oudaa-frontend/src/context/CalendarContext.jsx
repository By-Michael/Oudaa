import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import api, { endpoints } from '../lib/api'
import { CALENDAR_OPTIONS, getCalendarPreference, setCalendarPreference } from '../lib/ethiopianCalendar'

const STORAGE_KEY = 'oudaa-calendar'
const SUPPORTED = new Set(CALENDAR_OPTIONS.map((item) => item.id))
const CalendarContext = createContext(null)

function resolveInitialCalendar(user) {
  const preferred = user?.preferences?.calendar
  if (SUPPORTED.has(preferred)) return preferred
  return getCalendarPreference()
}

export function CalendarProvider({ children }) {
  const { user, patchUser } = useAuth()
  const [calendar, setCalendarState] = useState(() => resolveInitialCalendar(user))

  useEffect(() => {
    const preferred = user?.preferences?.calendar
    if (SUPPORTED.has(preferred)) setCalendarState(preferred)
  }, [user?.id, user?.preferences?.calendar])

  useEffect(() => {
    setCalendarPreference(calendar)
    document.documentElement.dataset.calendar = calendar
  }, [calendar])

  async function setCalendar(next) {
    if (!SUPPORTED.has(next) || next === calendar) return
    setCalendarState(next)
    setCalendarPreference(next)

    if (user?.id) {
      const nextPreferences = { ...(user.preferences || {}), calendar: next }
      patchUser({ preferences: nextPreferences })
      try {
        await api.patch(endpoints.myPreferences(), { calendar: next })
      } catch {
        // Local preference remains active when persistence is unavailable.
      }
    }
  }

  const value = useMemo(() => ({ calendar, setCalendar, options: CALENDAR_OPTIONS }), [calendar])
  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>
}

export function useCalendar() {
  const ctx = useContext(CalendarContext)
  if (!ctx) throw new Error('useCalendar must be used within CalendarProvider')
  return ctx
}

export const CALENDAR_STORAGE_KEY = STORAGE_KEY
