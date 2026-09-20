import { Navigate, useLocation } from 'react-router-dom'
import { usePlatformAuth } from './context/PlatformAuthContext'

/**
 * Route guard for the platform-admin shell. This is a UX convenience ONLY
 * — redirecting an unauthenticated browser to the login screen — and must
 * never be treated as the security boundary. The actual boundary is
 * server-side: every /api/platform/v1/* route independently requires
 * authenticatePlatformAdmin + requirePlatformPermission (see backend
 * middleware/platformAdmin). Hiding a route here does not protect the
 * data it would fetch; only the API's own checks do that.
 */
export default function PlatformProtectedRoute({ children }) {
  const { isAuthenticated, loading } = usePlatformAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center text-ink-400 text-sm">
        Loading…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/platform-admin/login" state={{ from: location }} replace />
  }

  return children
}
