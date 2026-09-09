import { useEffect, Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AppLayout from './layouts/AppLayout'
import Login from './pages/Login'
import { RESERVED_PATH_SLUGS } from './lib/subdomain'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Landing from './pages/Landing'
import Signup from './pages/Signup'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import { Toaster } from './components/ui'

// Everything behind auth (admin/resident panels) is code-split so the
// public landing/login pages don't have to download recharts, jspdf,
// html2canvas etc. on first load. These only fetch once a user actually
// signs in and navigates into the app shell.
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
const AdminResidents = lazy(() => import('./pages/admin/Residents'))
const AdminFees = lazy(() => import('./pages/admin/Fees'))
const AdminPayments = lazy(() => import('./pages/admin/Payments'))
const AdminFunds = lazy(() => import('./pages/admin/Funds'))
const AdminProjects = lazy(() => import('./pages/admin/Projects'))
const AdminExpenses = lazy(() => import('./pages/admin/Expenses'))
const AdminReports = lazy(() => import('./pages/admin/Reports'))
const AdminAuditLog = lazy(() => import('./pages/admin/AuditLog'))

const ResidentDashboard = lazy(() => import('./pages/resident/Dashboard'))
const ResidentPayments = lazy(() => import('./pages/resident/Payments'))
const ResidentFunds = lazy(() => import('./pages/resident/Funds'))
const ResidentProjects = lazy(() => import('./pages/resident/Projects'))
const ResidentExpenses = lazy(() => import('./pages/resident/Expenses'))
const ResidentReports = lazy(() => import('./pages/resident/Reports'))

const Profile = lazy(() => import('./pages/shared/Profile'))

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-ink-400 text-sm">
      Loading…
    </div>
  )
}

// Without this, the browser's default scroll restoration carries whatever
// scroll position a previous page was left at (e.g. half-scrolled down a
// long table) onto the next panel navigated to, so it opens already
// scrolled instead of at the top.
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// Route element for "/:communitySlug" — every community's own permanent
// login link (see lib/subdomain.js#communityUrl and the welcome email sent
// from registerCommunity). Guards against a single path segment that
// collides with a real platform route (e.g. someone hitting "/admin" with
// no further path) ever reaching here — React Router's static-route
// priority already prevents that in practice, since every one of those
// literal paths is registered as its own <Route>, but this is a cheap,
// explicit belt-and-suspenders check rather than relying solely on route
// ranking.
function CommunityLogin() {
  const { communitySlug } = useParams()
  if (RESERVED_PATH_SLUGS.has(communitySlug)) return <Navigate to="/" replace />
  return <Login communitySlug={communitySlug} />
}

function Protected({ role, children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  // Admins are always also a resident of their own community (see
  // AuthContext#normalizeUser -> residentId), so they're allowed into the
  // resident-side pages too — the top-right account menu lets them switch
  // between the two views. Residents still can't cross into /admin.
  const allowed = user.role === role || (user.role === 'admin' && role === 'resident')
  if (role && !allowed) return <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace />
  return children
}

export default function App() {
  const { user, bootstrapped } = useAuth()

  if (!bootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-400 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <>
      <Toaster />
      <ScrollToTop />
      <Routes>
      <Route path="/" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace /> : <Landing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace /> : <Signup />} />
      <Route path="/forgot-password" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace /> : <ResetPassword />} />

      {/* Every community's own login page: https://<host>/<slug>. Must
          come after every literal path above (so /login, /signup, etc.
          keep matching those exact pages, not this dynamic segment) and
          before the catch-all below. */}
      <Route path="/:communitySlug" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/resident'} replace /> : <CommunityLogin />} />

      <Route path="/admin" element={<Protected role="admin"><AppLayout role="admin" /></Protected>}>
        <Route index element={<Suspense fallback={<RouteFallback />}><AdminDashboard /></Suspense>} />
        <Route path="residents" element={<Suspense fallback={<RouteFallback />}><AdminResidents /></Suspense>} />
        <Route path="fees" element={<Suspense fallback={<RouteFallback />}><AdminFees /></Suspense>} />
        <Route path="payments" element={<Suspense fallback={<RouteFallback />}><AdminPayments /></Suspense>} />
        <Route path="funds" element={<Suspense fallback={<RouteFallback />}><AdminFunds /></Suspense>} />
        <Route path="projects" element={<Suspense fallback={<RouteFallback />}><AdminProjects /></Suspense>} />
        <Route path="expenses" element={<Suspense fallback={<RouteFallback />}><AdminExpenses /></Suspense>} />
        <Route path="reports" element={<Suspense fallback={<RouteFallback />}><AdminReports /></Suspense>} />
        <Route path="audit-log" element={<Suspense fallback={<RouteFallback />}><AdminAuditLog /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<RouteFallback />}><Profile /></Suspense>} />
        <Route path="profile" element={<Suspense fallback={<RouteFallback />}><Profile /></Suspense>} />
      </Route>

      <Route path="/resident" element={<Protected role="resident"><AppLayout role="resident" /></Protected>}>
        <Route index element={<Suspense fallback={<RouteFallback />}><ResidentDashboard /></Suspense>} />
        <Route path="payments" element={<Suspense fallback={<RouteFallback />}><ResidentPayments /></Suspense>} />
        <Route path="funds" element={<Suspense fallback={<RouteFallback />}><ResidentFunds /></Suspense>} />
        <Route path="projects" element={<Suspense fallback={<RouteFallback />}><ResidentProjects /></Suspense>} />
        <Route path="expenses" element={<Suspense fallback={<RouteFallback />}><ResidentExpenses /></Suspense>} />
        <Route path="reports" element={<Suspense fallback={<RouteFallback />}><ResidentReports /></Suspense>} />
        <Route path="profile" element={<Suspense fallback={<RouteFallback />}><Profile /></Suspense>} />
      </Route>

      <Route path="*" element={<Navigate to={user ? (user.role === 'admin' ? '/admin' : '/resident') : '/'} replace />} />
      </Routes>
    </>
  )
}
