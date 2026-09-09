import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Receipt, Wallet, FolderKanban, FileText,
  BarChart3, LogOut, Menu, X, Bell, Search, Landmark, ChevronDown,
  PanelLeftClose, PanelLeftOpen, UserCog, AlertCircle, CheckCircle2, Clock, ShieldCheck,
  Sun, Moon, Settings, HelpCircle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useTheme } from '../context/ThemeContext'
import api, { endpoints, fileUrl } from '../lib/api'
import { currency, formatDate, Modal, PageSkeleton, notify } from '../components/ui'
import { getNotificationPrefs, onNotificationPrefsChanged } from '../lib/notificationPrefs'
import HelpSupportPanel from '../components/HelpSupportPanel'

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/residents', label: 'Residents', icon: Users },
  { to: '/admin/fees', label: 'Fees', icon: Receipt },
  { to: '/admin/payments', label: 'Payments', icon: Wallet },
  { to: '/admin/funds', label: 'Funds', icon: Landmark },
  { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { to: '/admin/expenses', label: 'Expenses', icon: FileText },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/audit-log', label: 'Audit Log', icon: ShieldCheck },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

const residentNav = [
  { to: '/resident', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/resident/payments', label: 'My Payments', icon: Wallet },
  { to: '/resident/funds', label: 'Community Funds', icon: Landmark },
  { to: '/resident/projects', label: 'Projects', icon: FolderKanban },
  { to: '/resident/expenses', label: 'Expenses', icon: FileText },
  { to: '/resident/reports', label: 'Reports', icon: BarChart3 },
  { to: '/resident/profile', label: 'Profile', icon: UserCog },
]

const CHANGE_TYPE_LABELS = {
  COMMUNITY_PAYMENT_DETAILS: 'community payment account details',
  PAYMENT_METHOD_CREATE: 'a new payment method',
  PAYMENT_METHOD_UPDATE: 'a payment method',
  PAYMENT_METHOD_DELETE: 'removing a payment method',
}
const DIFF_FIELD_LABELS = {
  paymentBankName: 'Bank name', paymentAccountName: 'Account holder', paymentAccountNumber: 'Account number',
  provider: 'Provider', label: 'Label', bankName: 'Bank', accountName: 'Account name', accountNumber: 'Account number',
  fullName: 'Full name', phoneNumber: 'Phone number', isActive: 'Active', removed: 'Removed',
}

function describePendingChangeDiff(diff) {
  return Object.entries(diff || {})
    .map(([field, { from, to }]) => `${DIFF_FIELD_LABELS[field] || field}: "${from || '(empty)'}" → "${to || '(empty)'}"`)
    .join('; ')
}

export default function AppLayout({ role }) {
  const nav = role === 'admin' ? adminNav : residentNav
  const base = role === 'admin' ? '/admin' : '/resident'
  const [open, setOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const { user, logout, patchUser } = useAuth()
  const [collapsed, setCollapsedState] = useState(() => user?.preferences?.sidebarCollapsed === true)
  const [navCollapsed, setNavCollapsed] = useState(collapsed)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const data = useData()
  const { residents, payments, projects, fees, expenses, funds, fetchMyTransferItems, respondAsCommitteeMember, respondAsTransferRecipient, respondToPendingChange, pendingChanges, loading, hasLoadedOnce } = data
  const navigate = useNavigate()

  // ---- notification mute preferences (Settings > Notifications) ----
  const [notifPrefs, setNotifPrefs] = useState(() => getNotificationPrefs(user?.preferences))
  useEffect(() => {
    setNotifPrefs(getNotificationPrefs(user?.preferences))
    return onNotificationPrefsChanged((e) => {
      if (e.detail?.userId === user?.id) setNotifPrefs(e.detail.prefs)
    })
  }, [user?.id])
  const menuRef = useRef(null)
  const notifRef = useRef(null)
  const searchRef = useRef(null)
  const [transferItems, setTransferItems] = useState({ asApprover: [], asRecipient: [] })
  const [confirmAction, setConfirmAction] = useState(null) // { kind: 'approver'|'recipient'|'pendingChange', request, decision }
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)

  const loadTransferItems = useCallback(() => {
    if (!user) return
    fetchMyTransferItems()
      .then((r) => setTransferItems({ asApprover: r.asApprover || [], asRecipient: r.asRecipient || [] }))
      .catch(() => {})
  }, [user, fetchMyTransferItems])

  useEffect(() => {
    loadTransferItems()
    const t = setInterval(loadTransferItems, 30000)
    return () => clearInterval(t)
  }, [loadTransferItems])

  async function runConfirm() {
    if (!confirmAction) return
    setConfirmSubmitting(true)
    try {
      if (confirmAction.kind === 'approver') {
        await respondAsCommitteeMember(confirmAction.request.id, confirmAction.decision)
      } else if (confirmAction.kind === 'pendingChange') {
        await respondToPendingChange(confirmAction.request.id, confirmAction.decision)
      } else {
        await respondAsTransferRecipient(confirmAction.request.id, confirmAction.decision)
      }
      loadTransferItems()
      setConfirmAction(null)
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Could not submit your response.')
    } finally {
      setConfirmSubmitting(false)
    }
  }

  useEffect(() => {
    if (collapsed) {
      const t = setTimeout(() => setNavCollapsed(true), 300)
      return () => clearTimeout(t)
    }
    setNavCollapsed(false)
  }, [collapsed])

  // Persists to the database (see PATCH /users/me/preferences) instead of
  // localStorage, so the collapsed/expanded choice follows the user to
  // other devices/browsers.
  function setCollapsed(updater) {
    setCollapsedState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (user) {
        patchUser({ preferences: { ...(user.preferences || {}), sidebarCollapsed: next } })
        api.patch(endpoints.myPreferences(), { sidebarCollapsed: next }).catch(() => {})
      }
      return next
    })
  }

  // Close dropdowns on outside click.
  useEffect(() => {
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  // ---- Notifications: derived from real data, not decorative ----
  const notifications = useMemo(() => {
    const items = []

    transferItems.asApprover.forEach((req) => {
      items.push({
        id: `xfer-appr-${req.id}`,
        icon: Users,
        tone: 'amber',
        title: 'Committee transfer needs your approval',
        detail: `${req.fromUser?.fullName} wants to hand their seat to ${req.toResident?.user?.fullName}`,
        date: req.createdAt,
        transfer: { kind: 'approver', request: req },
        category: 'transfers',
      })
    })
    transferItems.asRecipient.forEach((req) => {
      items.push({
        id: `xfer-recip-${req.id}`,
        icon: Users,
        tone: 'amber',
        title: 'You\u2019ve been chosen as a committee member',
        detail: `${req.fromUser?.fullName} wants to transfer their seat to you`,
        date: req.createdAt,
        transfer: { kind: 'recipient', request: req },
        category: 'transfers',
      })
    })

    if (role === 'admin') {
      (pendingChanges?.asApprover || []).forEach((pc) => {
        items.push({
          id: `pc-${pc.id}`,
          icon: ShieldCheck,
          tone: 'amber',
          title: `Approval needed: ${CHANGE_TYPE_LABELS[pc.changeType] || pc.changeType}`,
          detail: `${pc.proposedBy?.fullName || 'A committee member'} proposed: ${describePendingChangeDiff(pc.diff)}`,
          date: pc.createdAt,
          pendingChange: { request: pc },
          category: 'approvals',
        })
      })
    }

    if (role === 'admin') {
      const pending = payments.filter((p) => p.status === 'pending')
      pending.slice(0, 5).forEach((p) => {
        const r = residents.find((x) => x.id === p.residentId)
        items.push({
          id: `pay-${p.id}`,
          icon: Clock,
          tone: 'amber',
          title: `Payment awaiting verification`,
          detail: `${r?.name || 'A resident'} · ${currency(p.amount)}`,
          date: p.date,
          to: `${base}/payments`,
          category: 'payments',
        })
      })
      const noReceipt = expenses.filter((e) => !e.receiptId)
      noReceipt.slice(0, 5).forEach((e) => {
        items.push({
          id: `exp-${e.id}`,
          icon: AlertCircle,
          tone: 'rose',
          title: `Expense missing a receipt`,
          detail: `${e.description} · ${currency(e.amount)}`,
          date: e.date,
          to: `${base}/expenses`,
          category: 'expenses',
        })
      })
    } else {
      const me = residents.find((r) => r.id === user?.residentId) || residents[0]
      const myPayments = payments.filter((p) => p.residentId === me?.id)
      const paidFeeIds = new Set(myPayments.filter((p) => p.status !== 'rejected').map((p) => p.feeId))
      fees.filter((f) => !paidFeeIds.has(f.id)).slice(0, 5).forEach((f) => {
        items.push({
          id: `fee-${f.id}`,
          icon: AlertCircle,
          tone: 'amber',
          title: `${f.name} is unpaid`,
          detail: `${currency(f.amount)} · ${f.frequency}`,
          date: null,
          to: `${base}/payments`,
          category: 'fees',
        })
      })
      myPayments.filter((p) => p.status === 'paid').slice(0, 3).forEach((p) => {
        items.push({
          id: `mp-${p.id}`,
          icon: CheckCircle2,
          tone: 'emerald',
          title: `Payment verified`,
          detail: `${currency(p.amount)} on ${formatDate(p.date)}`,
          date: p.date,
          to: `${base}/payments`,
          category: 'payments',
        })
      })
    }
    // Respect per-category mute preferences set in Settings > Notifications
    // (see lib/notificationPrefs.js) before returning the final list.
    return items.filter((item) => notifPrefs[item.category] !== false)
  }, [role, payments, residents, expenses, fees, user, base, transferItems, pendingChanges, notifPrefs])

  // ---- Global search across residents / payments / projects / expenses / funds ----
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const results = []
    if (role === 'admin') {
      residents.forEach((r) => {
        if ([r.name, r.unit, r.phone, r.email].join(' ').toLowerCase().includes(q)) {
          results.push({ id: `r-${r.id}`, group: 'Residents', label: r.name, sub: r.unit, to: `${base}/residents` })
        }
      })
    }
    payments.forEach((p) => {
      const r = residents.find((x) => x.id === p.residentId)
      if ([r?.name, p.reference].join(' ').toLowerCase().includes(q)) {
        results.push({ id: `p-${p.id}`, group: 'Payments', label: `${r?.name || 'Payment'} · ${currency(p.amount)}`, sub: p.reference, to: `${base}/payments` })
      }
    })
    projects.forEach((pr) => {
      if (pr.name.toLowerCase().includes(q)) {
        results.push({ id: `pr-${pr.id}`, group: 'Projects', label: pr.name, sub: currency(pr.budget), to: `${base}/projects` })
      }
    })
    expenses.forEach((e) => {
      if ([e.description, e.vendor].join(' ').toLowerCase().includes(q)) {
        results.push({ id: `e-${e.id}`, group: 'Expenses', label: e.description, sub: e.vendor, to: `${base}/expenses` })
      }
    })
    funds.forEach((f) => {
      if (f.name.toLowerCase().includes(q)) {
        results.push({ id: `f-${f.id}`, group: 'Funds', label: f.name, sub: f.category, to: `${base}/funds` })
      }
    })
    return results.slice(0, 8)
  }, [query, role, residents, payments, projects, expenses, funds, base])

  function goToResult(r) {
    setSearchOpen(false)
    setQuery('')
    navigate(r.to)
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar - spans full width, logo/brand and search live in one unbroken strip */}
      <header className="sticky top-0 z-30 h-16 shrink-0 flex items-center gap-3 border-b border-ink-100 bg-white/80 backdrop-blur-xl px-4 sm:px-6">
        <button onClick={() => setOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-ink-100 text-ink-600">
          <Menu className="h-5 w-5" />
        </button>
        <div className={`hidden lg:flex items-center shrink-0 transition-[width,margin,padding] duration-300 ease-in-out ${collapsed ? '-ml-4 sm:-ml-6 w-20 px-2' : 'w-64'}`}>
          <Brand collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        </div>
        <div className="hidden sm:block flex-1" />
        {typeof document !== 'undefined' && createPortal(
          <div className="hidden sm:flex items-center gap-2 w-full max-w-md fixed top-3 left-1/2 -translate-x-[calc(50%+48px)] z-30" ref={searchRef}>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true) }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search residents, payments, projects…"
                className="input pl-9 py-2.5 rounded-full bg-ink-50/70 border-transparent focus:bg-white dark:bg-[#232323] dark:focus:bg-[#232323]"
              />
            </div>
            {searchOpen && query.trim() && (
              <div className="absolute left-0 right-0 top-full mt-2 card p-1.5 max-h-80 overflow-y-auto z-40">
                {searchResults.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-ink-400 text-center">No matches for "{query}"</p>
                ) : (
                  searchResults.map((r) => (
                    <button key={r.id} onClick={() => goToResult(r)} className="w-full text-left flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-brand-50 transition">
                      <div>
                        <p className="text-sm font-medium text-ink-800">{r.label}</p>
                        <p className="text-xs text-ink-400">{r.sub}</p>
                      </div>
                      <span className="badge bg-ink-100 text-ink-500 shrink-0">{r.group}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>,
          document.body
        )}
        <div className="flex-1 sm:hidden" />

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="relative h-9 w-9 rounded-full flex items-center justify-center overflow-hidden bg-ink-100 hover:bg-ink-200 dark:bg-ink-800 dark:hover:bg-ink-700 transition-colors duration-300"
          >
            <Sun
              className={`absolute h-[18px] w-[18px] text-amber-500 transition-all duration-500 ease-out ${theme === 'dark' ? '-translate-y-8 opacity-0 rotate-90' : 'translate-y-0 opacity-100 rotate-0'}`}
            />
            <Moon
              className={`absolute h-[18px] w-[18px] text-brand-300 transition-all duration-500 ease-out ${theme === 'dark' ? 'translate-y-0 opacity-100 rotate-0' : 'translate-y-8 opacity-0 -rotate-90'}`}
            />
          </button>
          <div className="relative" ref={notifRef}>
            <button onClick={() => setNotifOpen((v) => !v)} className="relative p-2 rounded-lg hover:bg-ink-100 text-ink-500">
              <Bell className="h-5 w-5" />
              {notifications.length > 0 && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" />
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 card p-1.5 z-40 max-h-96 overflow-y-auto select-none">
                <div className="px-3 py-2 border-b border-ink-50 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-800">Notifications</p>
                  <span className="text-xs text-ink-400">{notifications.length}</span>
                </div>
                {notifications.length === 0 ? (
                  <p className="px-3 py-6 text-sm text-ink-400 text-center">You're all caught up.</p>
                ) : (
                  notifications.map((n) => {
                    const toneMap = { amber: 'text-amber-600 bg-amber-50', rose: 'text-rose-600 bg-rose-50', emerald: 'text-emerald-600 bg-emerald-50' }
                    if (n.pendingChange) {
                      return (
                        <div key={n.id} className="w-full text-left flex items-start gap-2.5 rounded-lg px-3 py-2.5">
                          <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${toneMap[n.tone]}`}>
                            <n.icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink-800">{n.title}</p>
                            <p className="text-xs text-ink-400">{n.detail}</p>
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={() => { setNotifOpen(false); setConfirmAction({ kind: 'pendingChange', request: n.pendingChange.request, decision: 'APPROVED' }) }}
                                className="btn-primary !py-1 !px-2.5 text-xs"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => { setNotifOpen(false); setConfirmAction({ kind: 'pendingChange', request: n.pendingChange.request, decision: 'REJECTED' }) }}
                                className="btn-secondary !py-1 !px-2.5 text-xs"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    }
                    if (n.transfer) {
                      return (
                        <div key={n.id} className="w-full text-left flex items-start gap-2.5 rounded-lg px-3 py-2.5">
                          <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${toneMap[n.tone]}`}>
                            <n.icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink-800">{n.title}</p>
                            <p className="text-xs text-ink-400">{n.detail}</p>
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={() => { setNotifOpen(false); setConfirmAction({ kind: n.transfer.kind, request: n.transfer.request, decision: 'APPROVED' }) }}
                                className="btn-primary !py-1 !px-2.5 text-xs"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => { setNotifOpen(false); setConfirmAction({ kind: n.transfer.kind, request: n.transfer.request, decision: 'REJECTED' }) }}
                                className="btn-secondary !py-1 !px-2.5 text-xs"
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <button
                        key={n.id}
                        onClick={() => { setNotifOpen(false); navigate(n.to) }}
                        className="w-full text-left flex items-start gap-2.5 rounded-lg px-3 py-2.5 hover:bg-ink-50 transition"
                      >
                        <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${toneMap[n.tone]}`}>
                          <n.icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-800 truncate">{n.title}</p>
                          <p className="text-xs text-ink-400 truncate">{n.detail}</p>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2.5 pl-2 pr-1 py-1 rounded-xl hover:bg-ink-100 transition select-none">
              <Avatar user={user} />
              <div className="hidden sm:block text-left">
                <p className="text-sm font-semibold text-ink-800 leading-tight">{user?.name}</p>
                <p className="text-xs text-ink-400 capitalize leading-tight">{user?.role === 'admin' ? 'Committee member' : user?.role}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-ink-400 hidden sm:block" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-64 card p-1.5 z-40 select-none">
                <div className="px-3 py-2 border-b border-ink-50">
                  <p className="text-sm font-medium text-ink-800 truncate">{user?.name}</p>
                  <p className="text-xs text-ink-400 truncate">{user?.community}</p>
                </div>
                <button
                  onClick={() => { setMenuOpen(false); navigate(`${base}/profile`) }}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-brand-50 hover:text-brand-700 mt-1 whitespace-nowrap"
                >
                  <UserCog className="h-4 w-4 shrink-0" /> Profile settings
                </button>
                {/* Admins are also a resident of their own community, so give
                    them a one-click way to see the app as a resident would —
                    and back again — instead of forcing a full log-out/in. */}
                {user?.role === 'admin' && (
                  role === 'admin' ? (
                    <button
                      onClick={() => { setMenuOpen(false); navigate('/resident') }}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-brand-50 hover:text-brand-700 mt-1 whitespace-nowrap"
                    >
                      <Users className="h-4 w-4 shrink-0" /> Switch to resident view
                    </button>
                  ) : (
                    <button
                      onClick={() => { setMenuOpen(false); navigate('/admin') }}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-brand-50 hover:text-brand-700 mt-1 whitespace-nowrap"
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0" /> Switch to admin view
                    </button>
                  )
                )}
                <button onClick={handleLogout} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-500 hover:bg-rose-50 mt-1 whitespace-nowrap">
                  <LogOut className="h-4 w-4 shrink-0" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
      {/* Sidebar - desktop */}
      <aside className={`hidden lg:flex lg:flex-col shrink-0 border-r border-ink-100 bg-white/80 backdrop-blur-xl py-4 sticky top-16 h-[calc(100vh-4rem)] transition-[width,padding] duration-300 ease-in-out ${collapsed ? 'w-20 px-2' : 'w-72 px-4'}`}>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) => `sidebar-link ${navCollapsed ? 'collapsed' : ''} ${isActive ? 'active' : ''}`}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" strokeWidth={2} />
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'}`}>
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>
        <SidebarFooter
          user={user}
          collapsed={collapsed}
          navCollapsed={navCollapsed}
          onLogout={handleLogout}
          onOpenHelp={() => setHelpOpen(true)}
        />
      </aside>

      {/* Sidebar - mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white px-4 py-6 flex flex-col animate-fade-up">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="p-1.5 text-ink-400"><X className="h-5 w-5" /></button>
            </div>
            <nav className="mt-8 flex-1 space-y-1 overflow-y-auto">
              {nav.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                  <item.icon className="h-4.5 w-4.5" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <SidebarFooter
              user={user}
              collapsed={false}
              navCollapsed={false}
              onLogout={handleLogout}
              onOpenHelp={() => { setOpen(false); setHelpOpen(true) }}
            />
          </aside>
        </div>
      )}

      <HelpSupportPanel open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8 max-w-[1400px] w-full mx-auto">
          {/* Show a skeleton only for the very first load after login —
              not for background/action-triggered refreshes — so the page
              never flashes empty tables/zeroed stats and then suddenly
              pops to real data (see DataContext.hasLoadedOnce). */}
          {loading && !hasLoadedOnce ? <PageSkeleton /> : <Outlet />}
        </main>
      </div>
      </div>

      {/* Transfer response confirmation */}
      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction?.kind === 'pendingChange'
            ? (confirmAction.decision === 'REJECTED' ? 'Reject this change?' : 'Confirm this change?')
            : (confirmAction?.decision === 'REJECTED' ? 'Decline transfer' : 'Confirm your decision')
        }
      >
        {confirmAction && (
          <div className="space-y-4">
            {confirmAction.kind === 'pendingChange' ? (
              <p className="text-sm text-ink-500">
                {confirmAction.decision === 'APPROVED' ? (
                  <>
                    Are you sure you want to <strong className="text-ink-800">confirm</strong> this change to{' '}
                    <strong className="text-ink-800">{CHANGE_TYPE_LABELS[confirmAction.request.changeType] || confirmAction.request.changeType}</strong>
                    {' '}proposed by <strong className="text-ink-800">{confirmAction.request.proposedBy?.fullName}</strong>?
                    <br /><br />
                    {describePendingChangeDiff(confirmAction.request.diff)}
                    <br /><br />
                    If every other committee member also confirms, this takes effect immediately.
                  </>
                ) : (
                  <>
                    Are you sure you want to <strong className="text-ink-800">reject</strong> this change to{' '}
                    <strong className="text-ink-800">{CHANGE_TYPE_LABELS[confirmAction.request.changeType] || confirmAction.request.changeType}</strong>?
                    A single rejection cancels the request immediately for everyone.
                  </>
                )}
              </p>
            ) : confirmAction.kind === 'approver' ? (
              <p className="text-sm text-ink-500">
                {confirmAction.decision === 'APPROVED' ? (
                  <>You\u2019re approving <strong className="text-ink-800">{confirmAction.request.fromUser?.fullName}</strong>{'\u2019s'} request to transfer their committee seat to <strong className="text-ink-800">{confirmAction.request.toResident?.user?.fullName}</strong>. If every committee member approves, the resident will be asked to accept next.</>
                ) : (
                  <>You\u2019re declining <strong className="text-ink-800">{confirmAction.request.fromUser?.fullName}</strong>{'\u2019s'} transfer request. This will cancel it immediately.</>
                )}
              </p>
            ) : (
              <p className="text-sm text-ink-500">
                {confirmAction.decision === 'APPROVED' ? (
                  <>You\u2019re accepting the committee seat offered by <strong className="text-ink-800">{confirmAction.request.fromUser?.fullName}</strong>. Once confirmed, you\u2019ll become a committee member immediately and they\u2019ll return to resident status.</>
                ) : (
                  <>You\u2019re declining the committee seat offered by <strong className="text-ink-800">{confirmAction.request.fromUser?.fullName}</strong>.</>
                )}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary flex-1">Go back</button>
              <button type="button" disabled={confirmSubmitting} onClick={runConfirm} className="btn-primary flex-1">
                {confirmSubmitting ? 'Submitting…' : confirmAction.kind === 'pendingChange' ? (confirmAction.decision === 'REJECTED' ? 'Yes, reject' : 'Yes, confirm') : 'Yes, confirm'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Avatar({ user }) {
  const pic = user?.avatarUrl ? fileUrl(user.avatarUrl) : null
  if (pic) {
    return <img src={pic} alt="" className="h-9 w-9 rounded-full object-cover shrink-0 ring-1 ring-ink-100" />
  }
  return (
    <div
      className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold font-display shrink-0"
      style={{ background: user?.avatarColor || '#2570f5' }}
    >
      {user?.name?.split(' ').map((n) => n[0]).slice(0, 2).join('')}
    </div>
  )
}

function SidebarFooter({ user, collapsed, navCollapsed, onLogout, onOpenHelp }) {
  // Sidebar footer: account summary + help + sign out. Kept as three
  // distinct, individually-clickable rows (not one big card) so each
  // affordance has its own hit target and hover state, same pattern as
  // the nav links above it. Collapses down to icon-only, centered
  // buttons when the sidebar itself is collapsed.
  return (
    <div className="shrink-0 pt-3 mt-2 border-t border-ink-100 dark:border-[#2e2e2e] space-y-2.5" style={{ marginTop: '5px' }}>
      <p className={`text-xs text-ink-400 dark:text-ink-500 whitespace-nowrap transition-all duration-300 ease-in-out ${collapsed ? 'hidden' : 'px-2.5'}`}>
        Signed in as <span className="font-semibold text-ink-700 dark:text-ink-200">{user?.name}</span>
      </p>

      <button
        type="button"
        onClick={onOpenHelp}
        title={collapsed ? 'Help and support' : undefined}
        className={`sidebar-link w-full ${navCollapsed ? 'collapsed' : ''}`}
      >
        <HelpCircle className="h-4.5 w-4.5 shrink-0" />
        <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'}`}>
          Help and support
        </span>
      </button>

      <button
        type="button"
        onClick={onLogout}
        title={collapsed ? 'Log out' : undefined}
        className={`inline-flex items-center justify-center gap-2 rounded-full border border-ink-200 dark:border-[#3a3a3a] px-4 py-1.5 text-sm font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors ${navCollapsed ? 'w-9 h-9 !p-0' : 'w-full'}`}
      >
        <LogOut className="h-4 w-4 shrink-0" />
        {!collapsed && 'Log out'}
      </button>
    </div>
  )
}

function Brand({ collapsed = false, onToggle }) {
  // Logo + name live in the top bar. The icon's left padding animates
  // continuously between states (rather than toggling justify-content,
  // which can't be transitioned and causes a visible jump) so it glides
  // smoothly into line with the icons below it.
  //
  // Collapsed: just the round icon mark (the same artwork used inside
  // oudaa-logo-full.png below, cropped to a square PNG) — hovering it
  // crossfades into the expand icon in place, and clicking it (in either
  // state) toggles the sidebar.
  //
  // Expanded: the exact same full wordmark image used on the Login and
  // Landing pages (oudaa-logo-full.png) — previously this was a
  // hand-rebuilt icon + plain-text "udaa" using the UI's own gradient/
  // font, which drifted from the actual brand artwork (different font,
  // no 3D/glossy styling, missing the "O"). Using the real asset here
  // guarantees the sidebar always matches the login/landing pages
  // pixel-for-pixel, with zero risk of the two drifting apart again.
  const LogoMark = (
    <span className="brand-mark relative h-11 w-11 shrink-0 grid place-items-center">
      <img
        src="/oudaa-h-mark.png"
        alt="Oudaa"
        className={`h-9 w-9 object-contain transition-opacity duration-200 ease-in-out ${collapsed && onToggle ? 'group-hover:opacity-0' : ''}`}
      />
      {collapsed && onToggle && (
        <PanelLeftOpen className="h-[19px] w-[19px] text-ink-400 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-in-out" />
      )}
    </span>
  )

  const FullLogo = (
    <img src="/oudaa-logo-full.png" alt="Oudaa" className="h-8 w-auto object-contain" />
  )

  return (
    <div className={`flex items-center w-full transition-[padding] duration-300 ease-in-out ${collapsed ? 'pl-3' : 'pl-1'}`}>
      {collapsed ? (
        onToggle ? (
          <button type="button" onClick={onToggle} title="Expand sidebar" className="group rounded-xl shrink-0">
            {LogoMark}
          </button>
        ) : (
          LogoMark
        )
      ) : onToggle ? (
        <button type="button" onClick={onToggle} title={undefined} className="shrink-0">
          {FullLogo}
        </button>
      ) : (
        FullLogo
      )}
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          title="Collapse sidebar"
          className={`ml-auto p-2.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-600 shrink-0 transition-all duration-300 ease-in-out ${collapsed ? 'opacity-0 max-w-0 pointer-events-none overflow-hidden p-0' : 'opacity-100 max-w-[44px]'}`}
        >
          <PanelLeftClose className="h-6 w-6" />
        </button>
      )}
    </div>
  )
}
