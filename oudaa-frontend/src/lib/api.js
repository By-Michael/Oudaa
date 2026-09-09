import axios from 'axios'

// Point this at your Express backend. In dev, Vite proxies /api -> http://localhost:4000
// (see vite.config.js), and the backend mounts every route under /api/v1.
// In prod, set VITE_API_URL to your deployed API base, e.g. https://api.example.com/api/v1.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('oudaa_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// The backend issues short-lived (15m) access tokens plus a long-lived (7d)
// httpOnly refresh cookie (see oudaa-backend auth controller). Previously the
// frontend never called /auth/refresh, so every request made ~15 minutes
// into a session (or after a laptop sleep, tab left open overnight, etc.)
// failed with "Authentication required" even though the user never logged
// out. This interceptor transparently refreshes the access token on a 401
// and retries the original request, so the session really does last until
// the refresh cookie expires (7 days) or the user explicitly logs out.
let refreshPromise = null

function doRefresh() {
  if (!refreshPromise) {
    refreshPromise = api
      .post(endpoints.refresh())
      .then(({ data }) => {
        const newToken = data.data.accessToken
        localStorage.setItem('oudaa_token', newToken)
        return newToken
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function clearSession() {
  localStorage.removeItem('oudaa_token')
  localStorage.removeItem('oudaa_user')
  // Let AuthContext (and anything else listening) know the session is
  // really gone, so it can update UI state / redirect to login.
  window.dispatchEvent(new Event('oudaa:session-expired'))
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { response, config } = err
    const isAuthRoute = config?.url === endpoints.login() || config?.url === endpoints.refresh()

    if (response?.status === 401 && !isAuthRoute && !config._retried) {
      config._retried = true
      try {
        const newToken = await doRefresh()
        config.headers.Authorization = `Bearer ${newToken}`
        return api(config)
      } catch {
        clearSession()
        return Promise.reject(err)
      }
    }

    if (response?.status === 401 && (isAuthRoute ? config.url === endpoints.refresh() : true)) {
      clearSession()
    }

    return Promise.reject(err)
  }
)

// REST endpoint map — matches the Core Modules from the Oudaa spec.
export const endpoints = {
  login: () => '/auth/login',
  // Note: login body uses { identifier, password } — identifier can be an
  // email address or a phone number.
  register: () => '/auth/register-community',
  me: () => '/auth/me',
  logout: () => '/auth/logout',
  refresh: () => '/auth/refresh',
  changePassword: () => '/auth/change-password',
  forgotPassword: () => '/auth/forgot-password',
  resetPassword: () => '/auth/reset-password',

  myPreferences: () => '/users/me/preferences',
  myAvatar: () => '/users/me/avatar',

  residents: () => '/residents',
  resident: (id) => `/residents/${id}`,
  residentSummary: (id) => `/residents/${id}/summary`,
  residentExport: (id) => `/residents/${id}/export`,
  residentDeactivate: (id) => `/residents/${id}/deactivate`,
  residentReactivate: (id) => `/residents/${id}/reactivate`,
  myResidentProfile: () => '/residents/me',

  auditLogs: () => '/audit-logs',

  communityMe: () => '/communities/me/current',
  communityBySlug: (slug) => `/communities/by-slug/${slug}`,

  fees: () => '/fees',
  fee: (id) => `/fees/${id}`,

  payments: () => '/payments',
  payment: (id) => `/payments/${id}`,
  paymentReceipt: (id) => `/payments/${id}/receipt`,
  paymentSelfVerify: () => '/payments/self-verify',
  paymentSelfVerifyReceipt: () => '/payments/self-verify/receipt',
  paymentParseScreenshot: () => '/payments/parse-screenshot',
  paymentRetract: (id) => `/payments/${id}/retract`,

  // A community can register several ways to receive money (CBE, Telebirr,
  // other banks, ...) — residents pick one when self-verifying a payment;
  // only ADMIN can write.
  paymentMethods: () => '/payment-methods',
  paymentMethod: (id) => `/payment-methods/${id}`,

  funds: () => '/funds',
  fund: (id) => `/funds/${id}`,
  fundSummaries: () => '/funds/summaries',

  projects: () => '/projects',
  project: (id) => `/projects/${id}`,
  projectCancel: (id) => `/projects/${id}/cancel`,

  committeeAutoApprovals: () => '/committee-auto-approvals',

  expenses: () => '/expenses',
  expense: (id) => `/expenses/${id}`,
  // No general edit endpoint — corrections go through reversal instead.
  reverseExpense: (id) => `/expenses/${id}/reverse`,

  receipts: () => '/receipts',
  receipt: (id) => `/receipts/${id}`,
  receiptVerify: (id) => `/receipts/${id}/verify`,

  committeeTransfers: () => '/committee-transfers',
  committeeTransferMine: () => '/committee-transfers/mine',
  committeeTransfer: (id) => `/committee-transfers/${id}`,
  committeeTransferCommitteeResponse: (id) => `/committee-transfers/${id}/committee-response`,
  committeeTransferRecipientResponse: (id) => `/committee-transfers/${id}/recipient-response`,

  pendingChangesMine: () => '/pending-changes/mine',
  pendingChangeRespond: (id) => `/pending-changes/${id}/respond`,
  pendingChange: (id) => `/pending-changes/${id}`,

  reports: {
    summary: () => '/reports/summary',
    collections: () => '/reports/collections',
    expenses: () => '/reports/expenses',
    // Pre-aggregated totals/by-fee/by-category/monthly-trend for the
    // Dashboard and Reports pages — computed as DB aggregates instead of
    // the client downloading every payment/expense row and summing them.
    dashboardSummary: () => '/reports/dashboard-summary',
  },

  // Fast, DB-aggregate headline numbers (counts/sums, not full row lists)
  // for the very first thing an admin/resident sees after login.
  dashboardAdmin: () => '/dashboard/admin',
  dashboardResident: () => '/dashboard/resident',

  // Help & Support panel — role-filtered FAQ list, whether the AI
  // assistant is configured on this server, one chat turn, and saved
  // conversation management (a session is only ever created once the
  // user explicitly opts in to saving — see SupportPanel.jsx).
  supportFaqs: () => '/support/faqs',
  supportAiStatus: () => '/support/ai-status',
  supportChat: () => '/support/chat',
  supportChatSessions: () => '/support/chat/sessions',
  supportChatSession: (id) => `/support/chat/sessions/${id}`,
}

// Uploaded files (receipts) are served from the API host's root
// (e.g. /uploads/...), not under /api/v1 — this builds the correct
// absolute URL for viewing/downloading them regardless of environment.
const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/api\/v1\/?$/, '')
export function fileUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_ROOT}${path.startsWith('/') ? '' : '/'}${path}`
}

// A plain `<a href={url} download>` only forces a download when the URL is
// same-origin — browsers silently ignore the `download` attribute for
// cross-origin links, which is exactly what receipt/avatar URLs are once
// they're served from Supabase Storage instead of this app's own origin.
// Clicking "Download" then just opens/shows the file instead of saving it.
// Fetching the bytes ourselves and downloading from a local blob: URL
// works regardless of where the file is actually hosted.
export async function downloadFile(url, suggestedName) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const blob = await response.blob()
  const blobUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = suggestedName || url.split('/').pop() || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(blobUrl)
}

export default api
