import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Building2,
  Users,
  LifeBuoy,
  Gauge,
  ShieldAlert,
  ScrollText,
  Plug,
  Flag,
  Wrench,
  Settings,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Search,
  UserCog,
  AlertCircle,
  Download,
  Bell,
} from 'lucide-react'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { PLATFORM_PERMISSIONS, roleHasPermission } from '../lib/platformPermissions'
import PlatformGlobalSearch from '../components/PlatformGlobalSearch'
import PlatformNotificationCenter from '../components/PlatformNotificationCenter'

// Full Phase 2 navigation shape. `enabled` marks which modules actually
// have a built page yet (only Overview, this phase) — everything else is
// shown as "Soon" so the shell's information architecture matches the
// eventual product, per the spec's nav list. `permission` decides
// whether the item is shown AT ALL for this operator's role ("Only
// display items for which the platform admin has permission" — see
// Phase 2 spec). This client-side check is a UX nicety only; the API
// itself independently enforces the same permission server-side (see
// backend middleware/platformAdmin/requirePlatformPermission), which is
// the actual security boundary regardless of what this sidebar shows.
const NAV_ITEMS = [
  { to: '/platform-admin/dashboard', label: 'Overview', icon: LayoutDashboard, enabled: true, permission: PLATFORM_PERMISSIONS.DASHBOARD_VIEW },
  { to: '/platform-admin/communities', label: 'Communities', icon: Building2, enabled: true, permission: PLATFORM_PERMISSIONS.COMMUNITIES_VIEW },
  { to: '/platform-admin/users', label: 'Users', icon: Users, enabled: true, permission: PLATFORM_PERMISSIONS.USERS_VIEW },
  { to: '/platform-admin/support', label: 'Support', icon: LifeBuoy, enabled: true, permission: PLATFORM_PERMISSIONS.SUPPORT_VIEW },
  { to: '/platform-admin/performance', label: 'Performance', icon: Gauge, enabled: true, permission: PLATFORM_PERMISSIONS.PERFORMANCE_VIEW },
  { to: '/platform-admin/security', label: 'Security', icon: ShieldAlert, enabled: true, permission: PLATFORM_PERMISSIONS.SECURITY_VIEW },
  { to: '/platform-admin/platform-admins', label: 'Platform Admins', icon: UserCog, enabled: true, permission: PLATFORM_PERMISSIONS.ADMINS_VIEW },
  { to: '/platform-admin/audit', label: 'Audit', icon: ScrollText, enabled: true, permission: PLATFORM_PERMISSIONS.AUDIT_VIEW },
  { to: '/platform-admin/integrations', label: 'Integrations', icon: Plug, enabled: true, permission: PLATFORM_PERMISSIONS.SETTINGS_VIEW },
  { to: '/platform-admin/feature-flags', label: 'Feature Flags', icon: Flag, enabled: true, permission: PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE },
  { to: '/platform-admin/maintenance', label: 'Maintenance', icon: Wrench, enabled: true, permission: PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE },
  { to: '/platform-admin/announcements', label: 'Announcements', icon: Bell, enabled: true, permission: PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE },
  { to: '/platform-admin/notifications', label: 'Notifications', icon: AlertCircle, enabled: true, permission: PLATFORM_PERMISSIONS.NOTIFICATIONS_VIEW },
  { to: '/platform-admin/exports', label: 'Data Export', icon: Download, enabled: true, permission: PLATFORM_PERMISSIONS.DATA_EXPORT_USE },
  { to: '/platform-admin/settings', label: 'Settings', icon: Settings, enabled: true, permission: PLATFORM_PERMISSIONS.SETTINGS_VIEW },
]

export default function PlatformAppLayout() {
  const { admin, logout } = usePlatformAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [apiError, setApiError] = useState(null)

  useEffect(() => {
    function onKeyDown(e) {
      const isK = e.key === 'k' || e.key === 'K'
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail || {}
      if (!detail.message) return
      setApiError(detail)
      window.clearTimeout(window.__hiveePlatformErrorTimer)
      window.__hiveePlatformErrorTimer = window.setTimeout(() => setApiError(null), 7000)
    }
    window.addEventListener('hivee:platform-api-error', handler)
    return () => {
      window.removeEventListener('hivee:platform-api-error', handler)
      window.clearTimeout(window.__hiveePlatformErrorTimer)
    }
  }, [])

  async function handleLogout() {
    await logout()
    navigate('/platform-admin/login', { replace: true })
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => roleHasPermission(admin?.role, item.permission))

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100 flex">
      <PlatformGlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {apiError && (
        <div className="fixed right-4 top-20 z-[70] w-[min(92vw,420px)] rounded-xl border border-red-500/30 bg-ink-900 shadow-card px-4 py-3" role="alert">
          <div className="text-sm font-medium text-red-100">{apiError.message}</div>
          {apiError.requestId && <div className="mt-1 text-[11px] text-red-200/70 font-mono">Request ID: {apiError.requestId}</div>}
          <button onClick={() => setApiError(null)} className="mt-2 text-[11px] text-ink-500 hover:text-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded">Dismiss</button>
        </div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-ink-700 bg-ink-800/80 backdrop-blur transform transition-transform lg:translate-x-0 lg:static ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 flex items-center gap-2 px-5 border-b border-ink-700">
          <div className="w-8 h-8 rounded-lg bg-brand-gradient" />
          <span className="font-display font-semibold tracking-tight">Hivee Platform</span>
          <button className="ml-auto lg:hidden text-ink-400" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.enabled ? item.to : '#'}
              onClick={(e) => !item.enabled && e.preventDefault()}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  !item.enabled
                    ? 'text-ink-500 cursor-not-allowed'
                    : isActive
                    ? 'bg-ink-700 text-white'
                    : 'text-ink-300 hover:bg-ink-700/60 hover:text-white'
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
              {!item.enabled && <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-600">Soon</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 border-b border-ink-700 bg-ink-900/80 backdrop-blur flex items-center gap-3 px-4 lg:px-6">
          <button className="lg:hidden text-ink-300" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-1.5 text-sm text-ink-400 hover:text-ink-200 hover:border-ink-600 transition w-full max-w-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="hidden sm:inline text-[10px] border border-ink-600 rounded px-1.5 py-0.5 text-ink-500">
              Ctrl K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            {roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.NOTIFICATIONS_VIEW) && <PlatformNotificationCenter />}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-800 transition"
            >
              <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-xs font-semibold text-white">
                {admin?.fullName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-sm leading-tight">{admin?.fullName}</div>
                <div className="text-[11px] text-ink-400 leading-tight">{admin?.role}</div>
              </div>
              <ChevronDown className="w-4 h-4 text-ink-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-lg border border-ink-700 bg-ink-800 shadow-card py-1">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink-200 hover:bg-ink-700"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
