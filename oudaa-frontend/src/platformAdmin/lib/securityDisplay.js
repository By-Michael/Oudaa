// Shared, presentation-only helpers for the Security Center pages. Kept
// deliberately understated per the spec ("clear severity without
// excessive visual drama") — three flat tiers, no pulsing icons, no
// escalating red-alert styling.

export const SECURITY_EVENT_CATEGORIES = [
  { value: 'LOGIN_FAILURE', label: 'Login failure' },
  { value: 'UNUSUAL_LOGIN', label: 'Unusual login' },
  { value: 'PRIVILEGE_CHANGE', label: 'Privilege change' },
  { value: 'PERMISSION_CHANGE', label: 'Permission change' },
  { value: 'SESSION_REVOCATION', label: 'Session revocation' },
  { value: 'IMPERSONATION', label: 'Impersonation' },
  { value: 'SENSITIVE_CONFIG_CHANGE', label: 'Sensitive configuration change' },
  { value: 'FAILED_PRIVILEGED_OPERATION', label: 'Failed privileged operation' },
]

// action -> { label, severity }. severity is one of 'low' | 'medium' | 'high'.
const ACTION_META = {
  LOGIN_SUCCESS: { label: 'Login succeeded', severity: 'low' },
  LOGIN_FAILED: { label: 'Login failed', severity: 'medium' },
  LOGOUT: { label: 'Signed out', severity: 'low' },
  SESSION_REVOKED: { label: 'Sessions revoked (self)', severity: 'medium' },
  PASSWORD_CHANGED: { label: 'Password changed', severity: 'low' },
  MFA_ENABLED: { label: 'MFA enabled', severity: 'low' },
  MFA_DISABLED: { label: 'MFA disabled', severity: 'high' },
  USER_VIEWED: { label: 'Community user viewed', severity: 'low' },
  USER_SESSIONS_REVOKED: { label: 'User sessions revoked', severity: 'medium' },
  SUPPORT_VIEW_STARTED: { label: 'Support view started', severity: 'medium' },
  SUPPORT_VIEW_ENDED: { label: 'Support view ended', severity: 'low' },
  ADMIN_CREATED: { label: 'Admin created', severity: 'medium' },
  ADMIN_ENABLED: { label: 'Admin enabled', severity: 'medium' },
  ADMIN_DISABLED: { label: 'Admin disabled', severity: 'high' },
  ADMIN_ROLE_CHANGED: { label: 'Admin role changed', severity: 'high' },
  ADMIN_ROLE_CHANGE_DENIED: { label: 'Role change denied', severity: 'high' },
  ADMIN_PASSWORD_RESET_REQUIRED: { label: 'Password reset required', severity: 'medium' },
  ADMIN_MFA_REENROLLMENT_REQUIRED: { label: 'MFA re-enrollment required', severity: 'medium' },
  ADMIN_SESSION_REVOKED: { label: 'Session revoked', severity: 'medium' },
  ADMIN_SESSIONS_REVOKED: { label: 'Sessions revoked', severity: 'medium' },
  ADMIN_ACTIVITY_VIEWED: { label: 'Admin activity viewed', severity: 'low' },
  SECURITY_SETTINGS_UPDATED: { label: 'Security settings updated', severity: 'high' },
}

export function actionLabel(action) {
  return ACTION_META[action]?.label || action
}

export function actionSeverity(action, success = true) {
  if (success === false) return 'high'
  return ACTION_META[action]?.severity || 'low'
}

const SEVERITY_STYLES = {
  low: 'bg-ink-700/60 text-ink-300 border-ink-600',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  high: 'bg-red-500/10 text-red-400 border-red-500/30',
}

export function severityBadgeClass(severity) {
  return `inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.low}`
}

export function fmtDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export const ASSIGNABLE_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_AGENT', 'OPERATIONS', 'SECURITY_AUDITOR', 'FINANCE_OPERATOR']
