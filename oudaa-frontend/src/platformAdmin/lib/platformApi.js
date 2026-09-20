import axios from 'axios'

// A completely separate axios instance from ../lib/api.js — different
// base URL, different token storage keys, and its own refresh/401
// handling. Deliberately does not import or share anything from the
// community-side api client so a bug there (or here) can't cross the
// auth boundary. In production this should eventually point at the
// platform console's own deployed backend origin (see Phase 1's "Admin
// domain" — e.g. https://api.admin.example.com/api/platform/v1); for now
// it defaults to the same backend host, just a different path prefix.
export const platformApi = axios.create({
  baseURL: import.meta.env.VITE_PLATFORM_API_URL || '/api/platform/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// High-privilege access tokens are kept in memory only. The long-lived refresh
// session remains in an HttpOnly cookie managed by the backend, so an XSS bug
// cannot simply read the platform access token from localStorage. A page reload
// rehydrates the short-lived access token through /auth/refresh.
let inMemoryPlatformToken = null
let inMemoryPlatformAdmin = null

export function getStoredPlatformToken() {
  return inMemoryPlatformToken
}
export function setStoredPlatformToken(token) {
  inMemoryPlatformToken = token || null
}
export function getStoredPlatformAdmin() {
  return inMemoryPlatformAdmin
}
export function setStoredPlatformAdmin(admin) {
  inMemoryPlatformAdmin = admin || null
}

export function getPlatformErrorDetails(error) {
  const payload = error?.response?.data || {}
  return {
    message: payload.message || error?.message || 'Something went wrong.',
    requestId: payload.requestId || null,
    statusCode: error?.response?.status || null,
  }
}

platformApi.interceptors.request.use((config) => {
  const token = getStoredPlatformToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshPromise = null
function doRefresh() {
  if (!refreshPromise) {
    refreshPromise = platformApi
      .post(platformEndpoints.refresh())
      .then(({ data }) => {
        setStoredPlatformToken(data.data.accessToken)
        setStoredPlatformAdmin(data.data.admin)
        return data.data.accessToken
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function clearPlatformSession() {
  setStoredPlatformToken(null)
  setStoredPlatformAdmin(null)
  window.dispatchEvent(new Event('oudaa:platform-session-expired'))
}

platformApi.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { response, config } = err
    const isAuthRoute = config?.url === platformEndpoints.login() || config?.url === platformEndpoints.refresh()

    if (response?.status === 401 && !isAuthRoute && !config._retried) {
      config._retried = true
      try {
        const newToken = await doRefresh()
        config.headers.Authorization = `Bearer ${newToken}`
        return platformApi(config)
      } catch {
        clearPlatformSession()
        return Promise.reject(err)
      }
    }

    if (response?.status === 401 && (isAuthRoute ? config.url === platformEndpoints.refresh() : true)) {
      clearPlatformSession()
    }

    const errorDetails = getPlatformErrorDetails(err)
    err.requestId = errorDetails.requestId
    err.friendlyMessage = errorDetails.message
    window.dispatchEvent(new CustomEvent('oudaa:platform-api-error', { detail: errorDetails }))
    return Promise.reject(err)
  }
)

export const platformEndpoints = {
  login: () => '/auth/login',
  refresh: () => '/auth/refresh',
  logout: () => '/auth/logout',
  logoutAll: () => '/auth/logout-all',
  me: () => '/auth/me',
  changePassword: () => '/auth/change-password',
  mfaEnrollStart: () => '/auth/mfa/enroll/start',
  mfaEnrollVerify: () => '/auth/mfa/enroll/verify',
  mfaDisable: () => '/auth/mfa/disable',

  dashboardSummary: () => '/dashboard/summary',
  dashboardGrowthChart: () => '/dashboard/charts/growth',
  dashboardFinancialActivityChart: () => '/dashboard/charts/financial-activity',
  dashboardAlerts: () => '/dashboard/alerts',
  dashboardRecentActivity: () => '/dashboard/recent-activity',
  search: () => '/search',

  // Phase 3 — Community directory
  communities: () => '/communities',
  communityDetail: (id) => `/communities/${id}`,
  communityUsers: (id) => `/communities/${id}/users`,
  communityStatus: (id) => `/communities/${id}/status`,
  communityWarnings: (id) => `/communities/${id}/warnings`,
  communityRevokeAdminSessions: (id) => `/communities/${id}/revoke-admin-sessions`,

  // Phase 3 — Global user directory
  users: () => '/users',
  userDetail: (id) => `/users/${id}`,
  userRevokeSessions: (id) => `/users/${id}/revoke-sessions`,
  userStartSupportView: (id) => `/users/${id}/support-view`,
  supportViewSession: (sessionId) => `/users/support-view/${sessionId}`,

  supportTickets: () => '/support/tickets',
  supportTicketDetail: (id) => `/support/tickets/${id}`,
  supportTicketMessages: (id) => `/support/tickets/${id}/messages`,
  supportTicketMessage: (id, messageId) => `/support/tickets/${id}/messages/${messageId}`,
  supportTicketAssign: (id) => `/support/tickets/${id}/assign`,
  supportTicketUnassign: (id) => `/support/tickets/${id}/unassign`,
  supportTicketStatus: (id) => `/support/tickets/${id}/status`,
  supportTicketEscalate: (id) => `/support/tickets/${id}/escalate`,
  supportTicketPriority: (id) => `/support/tickets/${id}/priority`,
  supportTicketCategory: (id) => `/support/tickets/${id}/category`,
  supportAiConfig: () => '/support/ai/config',
  supportAiMetrics: () => '/support/ai/metrics',
  supportAiConversations: () => '/support/ai/conversations',
  supportAnalyticsOverview: () => '/support/analytics/overview',
  supportAnalyticsVolume: () => '/support/analytics/volume',

  // Phase 6 — Security Center
  securityOverview: () => '/security/overview',
  securityEvents: () => '/security/events',
  securitySessions: () => '/security/sessions',
  securitySessionRevoke: (sessionId) => `/security/sessions/${sessionId}`,
  securitySettings: () => '/security/settings',

  // Phase 6 — Platform admin identity management
  platformAdmins: () => '/platform-admins',
  platformAdminDetail: (id) => `/platform-admins/${id}`,
  platformAdminEnable: (id) => `/platform-admins/${id}/enable`,
  platformAdminDisable: (id) => `/platform-admins/${id}/disable`,
  platformAdminRole: (id) => `/platform-admins/${id}/role`,
  platformAdminRequirePasswordReset: (id) => `/platform-admins/${id}/require-password-reset`,
  platformAdminRequireMfaReenrollment: (id) => `/platform-admins/${id}/require-mfa-reenrollment`,
  platformAdminRevokeSessions: (id) => `/platform-admins/${id}/revoke-sessions`,

  // Phase 7 — Platform Operations & Control Center
  featureFlags: () => '/feature-flags',
  featureFlag: (id) => `/feature-flags/${id}`,
  featureFlagHistory: (id) => `/feature-flags/${id}/history`,
  featureFlagEvaluate: (key) => `/feature-flags/evaluate/${encodeURIComponent(key)}`,
  maintenance: () => '/maintenance',
  announcements: () => '/announcements',
  announcement: (id) => `/announcements/${id}`,
  announcementPublish: (id) => `/announcements/${id}/publish`,
  announcementSchedule: (id) => `/announcements/${id}/schedule`,
  announcementArchive: (id) => `/announcements/${id}/archive`,
  notifications: () => '/notifications',
  notificationRead: (id) => `/notifications/${id}/read`,
  notificationsReadAll: () => '/notifications/read-all',
  exports: () => '/exports',
  exportDownload: (id) => `/exports/${id}/download`,
  platformSettings: () => '/settings',
  platformSetting: (id) => `/settings/${id}`,
  audit: () => '/audit',
  auditDetail: (id) => `/audit/${id}`,
  integrations: () => '/integrations',
  performanceOverview: () => '/performance/overview',
  performanceProcess: () => '/performance/process',
  performanceApi: (window) => `/performance/api${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  performanceApiSeries: (window) => `/performance/api/series${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  performanceApiEndpoints: (window) => `/performance/api/endpoints${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  performanceDatabase: () => '/performance/database',
  performanceStorage: () => '/performance/storage',
  performanceIntegrations: () => '/performance/integrations',
  performanceErrors: (window) => `/performance/errors${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  performanceErrorGroups: (window) => `/performance/errors/groups${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  performanceErrorSummary: (window) => `/performance/errors/summary${window ? `?window=${encodeURIComponent(window)}` : ''}`,
  performanceSnapshots: (window) => `/performance/snapshots${window ? `?window=${encodeURIComponent(window)}` : ''}`,
}

export default platformApi
