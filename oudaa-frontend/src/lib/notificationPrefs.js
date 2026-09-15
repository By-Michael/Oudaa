import api, { endpoints } from './api'

// Notification categories a person can mute individually. Preferences live
// in the `notifications` key of the user's database-backed preferences
// (see PATCH /users/me/preferences), so mutes follow the user to any
// device/browser instead of resetting per-browser.
//
// `roles` controls which tab sees the toggle: committee members get the
// admin-flavoured categories (approvals, verification queue, receipts),
// residents get the resident-flavoured ones (fee reminders, payment
// results). `transfers` applies to both since anyone can be offered a
// committee seat.
export const NOTIFICATION_CATEGORIES = [
  {
    id: 'transfers',
    label: 'Committee transfers',
    description: 'Someone proposing to hand you their seat, or asking you to approve a transfer.',
    roles: ['admin', 'resident'],
  },
  {
    id: 'approvals',
    label: 'Approval requests',
    description: 'Community changes (like updated payment account details) that need your sign-off.',
    roles: ['admin'],
  },
  {
    id: 'payments',
    label: 'Payment activity',
    description: 'Admin: payments waiting on verification. Resident: your payments being verified or rejected.',
    roles: ['admin', 'resident'],
  },
  {
    id: 'expenses',
    label: 'Expense receipts',
    description: 'Logged expenses that are still missing a receipt.',
    roles: ['admin'],
  },
  {
    id: 'fees',
    label: 'Fee reminders',
    description: 'Fees you haven’t paid yet.',
    roles: ['resident'],
  },
]

const DEFAULTS = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, true]))
const EVENT_NAME = 'oudaa:notif-prefs-changed'

// `userPreferences` is the user object's `preferences` field (from
// AuthContext / /auth/me) — the caller already has it in hand, so this
// stays a pure function rather than fetching on its own.
export function getNotificationPrefs(userPreferences) {
  return { ...DEFAULTS, ...(userPreferences?.notifications || {}) }
}

// Persists the change to the database (via the shared preferences PATCH,
// merged under the `notifications` key) and updates the caller's cached
// user via `patchUser` so the UI reflects it immediately.
export function setNotificationPref(user, patchUser, categoryId, enabled) {
  if (!user) return
  const next = { ...getNotificationPrefs(user.preferences), [categoryId]: enabled }
  const nextPreferences = { ...(user.preferences || {}), notifications: next }
  patchUser({ preferences: nextPreferences })
  api.patch(endpoints.myPreferences(), { notifications: next }).catch(() => {})
  // Same-tab listeners (the bell in AppLayout) don't get a native `storage`
  // event since that only fires in *other* tabs — dispatch our own so the
  // bell updates instantly after a toggle without a page reload.
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId: user.id, prefs: next } }))
  return next
}

export function onNotificationPrefsChanged(callback) {
  window.addEventListener(EVENT_NAME, callback)
  return () => window.removeEventListener(EVENT_NAME, callback)
}
