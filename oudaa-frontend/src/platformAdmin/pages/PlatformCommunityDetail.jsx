import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Building2,
  ArrowLeft,
  Users,
  UserCircle,
  Wallet,
  FolderKanban,
  Receipt,
  Activity,
  ScrollText,
  Settings,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Ban,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { PLATFORM_PERMISSIONS, roleHasPermission } from '../lib/platformPermissions'

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  ACTIVE:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  SUSPENDED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-ink-700 text-ink-400 border-ink-600'}`}>
      {status}
    </span>
  )
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatRelative(d) {
  if (!d) return 'Never'
  const ms = Date.now() - new Date(d).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/60 px-5 py-4">
      <p className="text-xs text-ink-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1">{value ?? '—'}</p>
      {sub && <p className="text-xs text-ink-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function DiagRow({ label, value, status }) {
  const colour = status === 'warn' ? 'text-amber-400' : status === 'ok' ? 'text-emerald-400' : 'text-ink-300'
  return (
    <div className="flex items-start justify-between py-2 border-b border-ink-800 last:border-0">
      <span className="text-sm text-ink-400">{label}</span>
      <span className={`text-sm font-medium ${colour}`}>{value}</span>
    </div>
  )
}

// ─── tabs definition ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',     label: 'Overview',      icon: Building2 },
  { id: 'users',        label: 'Users',          icon: Users },
  { id: 'admins',       label: 'Admins',         icon: UserCircle },
  { id: 'payments',     label: 'Payments',       icon: Wallet },
  { id: 'projects',     label: 'Projects',       icon: FolderKanban },
  { id: 'activity',     label: 'Activity',       icon: Activity },
  { id: 'audit',        label: 'Audit',          icon: ScrollText },
  { id: 'configuration',label: 'Configuration',  icon: Settings },
  { id: 'security',     label: 'Security',       icon: ShieldCheck },
]

// ─── main component ───────────────────────────────────────────────────────────

export default function PlatformCommunityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { admin } = usePlatformAuth()
  const canManage = roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.COMMUNITIES_MANAGE)

  const [activeTab, setActiveTab] = useState('overview')
  const [community, setCommunity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [opsMessage, setOpsMessage] = useState('')

  // Users sub-tab state
  const [users, setUsers] = useState([])
  const [usersPage, setUsersPage] = useState(1)
  const [usersPagination, setUsersPagination] = useState(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersRoleFilter, setUsersRoleFilter] = useState('all')

  const fetchCommunity = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await platformApi.get(platformEndpoints.communityDetail(id))
      setCommunity(data.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load community')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchCommunity() }, [fetchCommunity])

  useEffect(() => {
    platformApi.get(platformEndpoints.communityWarnings(id)).then(({ data }) => setWarnings(data.data || [])).catch(() => setWarnings([]))
  }, [id])

  const fetchUsers = useCallback(async () => {
    if (activeTab !== 'users' && activeTab !== 'admins') return
    setUsersLoading(true)
    try {
      const role = activeTab === 'admins' ? 'ADMIN' : usersRoleFilter
      const params = new URLSearchParams({ page: usersPage, pageSize: 25, ...(role !== 'all' && { role }) })
      const { data } = await platformApi.get(`${platformEndpoints.communityUsers(id)}?${params}`)
      setUsers(data.data)
      setUsersPagination(data.pagination)
    } catch { /* shown via community error */ }
    finally { setUsersLoading(false) }
  }, [id, activeTab, usersPage, usersRoleFilter])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleSetStatus(newStatus) {
    if (!window.confirm(`${newStatus === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} this community?`)) return
    const reason = window.prompt('Reason (required):')
    if (!reason || reason.trim().length < 3) return
    setStatusLoading(true)
    setStatusError('')
    try {
      await platformApi.patch(platformEndpoints.communityStatus(id), { status: newStatus, reason: reason.trim() })
      await fetchCommunity()
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Status update failed')
    } finally {
      setStatusLoading(false)
    }
  }

  async function revokeAdminSessions() {
    if (!window.confirm("Revoke all active sessions belonging to this community's administrators?")) return
    const reason = window.prompt('Reason (required):')
    if (!reason || reason.trim().length < 3) return
    try {
      const { data } = await platformApi.post(platformEndpoints.communityRevokeAdminSessions(id), { reason: reason.trim() })
      setOpsMessage(`${data.data.revokedSessions} session(s) revoked across ${data.data.affectedUsers} community admin(s).`)
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Session revocation failed')
    }
  }

  // ── loading / error shells ──────────────────────────────────────────────

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-ink-500">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      Loading community…
    </div>
  )

  if (error) return (
    <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 max-w-xl">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      {error}
    </div>
  )

  const c = community

  // ── page layout ────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Breadcrumb / header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => navigate('/platform-admin/communities')}
          className="flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Communities
        </button>
        <span className="text-ink-700">/</span>
        <h1 className="text-lg font-semibold text-white">{c.name}</h1>
        <StatusBadge status={c.status} />

        {/* Status actions */}
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {statusError && <span className="text-xs text-red-400">{statusError}</span>}
            {c.status === 'ACTIVE' ? (
              <button
                onClick={() => handleSetStatus('SUSPENDED')}
                disabled={statusLoading}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />
                Suspend
              </button>
            ) : (
              <button
                onClick={() => handleSetStatus('ACTIVE')}
                disabled={statusLoading}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reactivate
              </button>
            )}
            <button
              onClick={revokeAdminSessions}
              disabled={statusLoading}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 transition disabled:opacity-50"
            >
              Revoke admin sessions
            </button>
          </div>
        )}
      </div>

      {opsMessage && <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-4 py-3 text-sm text-teal-200">{opsMessage}</div>}

      {warnings.length > 0 && <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-white"><AlertTriangle className="w-4 h-4 text-amber-300"/>Operational warnings</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{warnings.map(w => <div key={w.code} className="rounded-lg border border-ink-700 bg-ink-900/50 p-3"><div className="text-xs font-semibold text-amber-200">{w.code}</div><div className="text-xs text-ink-400 mt-1">{w.message}</div></div>)}</div></div>}

      {c.status === 'SUSPENDED' && c.suspendedReason && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span><strong>Suspended:</strong> {c.suspendedReason}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-ink-700 overflow-x-auto">
        <nav className="flex gap-1 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-teal-500 text-white'
                  : 'border-transparent text-ink-400 hover:text-ink-200'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab: Overview ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Identity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-3">
              <h2 className="text-sm font-medium text-ink-300">Identity</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <dt className="text-ink-500">Name</dt><dd className="text-white">{c.name}</dd>
                <dt className="text-ink-500">Slug</dt><dd className="font-mono text-ink-300">{c.slug}</dd>
                <dt className="text-ink-500">ID</dt><dd className="font-mono text-xs text-ink-400 break-all">{c.id}</dd>
                <dt className="text-ink-500">Created</dt><dd className="text-ink-300">{formatDate(c.createdAt)}</dd>
                {c.address && <><dt className="text-ink-500">Address</dt><dd className="text-ink-300">{c.address}</dd></>}
                {c.contactInfo && <><dt className="text-ink-500">Contact</dt><dd className="text-ink-300">{c.contactInfo}</dd></>}
              </dl>
            </div>

            {/* Diagnostics */}
            <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-1">
              <h2 className="text-sm font-medium text-ink-300 mb-3">Diagnostics</h2>
              <DiagRow
                label="Pending payments"
                value={`${c.diagnostics.pendingPayments} pending`}
                status={c.diagnostics.pendingPayments > 0 ? 'warn' : 'ok'}
              />
              <DiagRow
                label="Pending review"
                value={`${c.diagnostics.pendingReviewPayments} flagged`}
                status={c.diagnostics.pendingReviewPayments > 0 ? 'warn' : 'ok'}
              />
              <DiagRow
                label="Active projects"
                value={`${c.diagnostics.activeProjects} ongoing`}
              />
              <DiagRow
                label="Payment method"
                value={c.diagnostics.paymentMethodConfigured ? 'Configured' : 'Not set'}
                status={c.diagnostics.paymentMethodConfigured ? 'ok' : 'warn'}
              />
              <DiagRow
                label="Last activity"
                value={formatRelative(c.diagnostics.lastActivity)}
              />
            </div>
          </div>

          {/* Metric grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <StatCard label="Users"     value={c.counts.users} />
            <StatCard label="Residents" value={c.counts.residents} />
            <StatCard label="Admins"    value={c.counts.admins} />
            <StatCard label="Payments"  value={c.counts.payments} />
            <StatCard label="Projects"  value={c.counts.projects} />
            <StatCard label="Expenses"  value={c.counts.expenses} />
            <StatCard label="Funds"     value={c.counts.funds} />
            <StatCard label="Support"   value={c.counts.supportMessages} sub="messages" />
            <StatCard label="Audit entries" value={c.counts.auditLogs} />
          </div>

          {/* Recent activity */}
          {c.recentActivity?.length > 0 && (
            <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5">
              <h2 className="text-sm font-medium text-ink-300 mb-3">Recent Activity</h2>
              <ul className="space-y-2">
                {c.recentActivity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    <span className="text-ink-600 text-xs mt-0.5 w-32 shrink-0">{formatDate(a.createdAt)}</span>
                    <span className="text-ink-400">{a.actorName}</span>
                    <span className="text-ink-300">{a.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Users / Admins ── */}
      {(activeTab === 'users' || activeTab === 'admins') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink-300">
              {activeTab === 'admins' ? 'Community Administrators' : 'All Users'}
            </h2>
            {activeTab === 'users' && (
              <select
                value={usersRoleFilter}
                onChange={(e) => { setUsersRoleFilter(e.target.value); setUsersPage(1) }}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 focus:outline-none"
              >
                <option value="all">All roles</option>
                <option value="ADMIN">Admins</option>
                <option value="RESIDENT">Residents</option>
              </select>
            )}
          </div>

          <UserTable
            users={users}
            loading={usersLoading}
            onViewUser={(userId) => navigate(`/platform-admin/users/${userId}`)}
          />

          {usersPagination && usersPagination.totalPages > 1 && (
            <PaginationBar
              pagination={usersPagination}
              onPage={setUsersPage}
            />
          )}
        </div>
      )}

      {/* ── Tab: Payments ── */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Payment Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(c.paymentBreakdown || {}).map(([status, count]) => (
              <StatCard key={status} label={status.replace('_', ' ')} value={count} />
            ))}
          </div>
          <p className="text-xs text-ink-500">
            Full payment records are managed in the community's own admin portal.
            Platform operators can view aggregate counts here.
          </p>
        </div>
      )}

      {/* ── Tab: Projects ── */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Project Breakdown</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(c.projectBreakdown || {}).map(([status, count]) => (
              <StatCard key={status} label={status} value={count} />
            ))}
          </div>
          <p className="text-xs text-ink-500">
            Individual project records are managed in the community's admin portal.
          </p>
        </div>
      )}

      {/* ── Tab: Activity ── */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Recent Community Activity</h2>
          {c.recentActivity?.length === 0 ? (
            <p className="text-sm text-ink-500">No activity recorded yet.</p>
          ) : (
            <div className="rounded-xl border border-ink-700 overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-ink-800/60 border-b border-ink-700">
                  <tr>
                    {['Time', 'Actor', 'Action', 'Entity', 'Description'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.recentActivity.map((a) => (
                    <tr key={a.id} className="border-b border-ink-800">
                      <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{formatDate(a.createdAt)}</td>
                      <td className="px-4 py-3 text-ink-300">{a.actorName}</td>
                      <td className="px-4 py-3"><code className="text-xs bg-ink-700 px-1.5 py-0.5 rounded">{a.action}</code></td>
                      <td className="px-4 py-3 text-xs text-ink-400">{a.entityType}</td>
                      <td className="px-4 py-3 text-xs text-ink-400 max-w-xs truncate">{a.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Audit ── */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Platform Audit</h2>
          <p className="text-xs text-ink-500">
            Shows platform-admin actions concerning this community (views, status changes, etc.).
            Community-internal audit logs are accessible in the Activity tab.
          </p>
          <PlatformAuditSection communityId={id} />
        </div>
      )}

      {/* ── Tab: Configuration ── */}
      {activeTab === 'configuration' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Payment Configuration</h2>
          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-3 text-sm">
            {c.paymentConfig.methods.length === 0 ? (
              <p className="text-ink-500">No payment methods configured.</p>
            ) : (
              c.paymentConfig.methods.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded border border-ink-600 px-2 py-0.5 text-xs text-ink-400">{m.provider}</span>
                  <span className="text-ink-300">{m.label}</span>
                </div>
              ))
            )}
            {c.paymentConfig.bankName && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-3 border-t border-ink-700 pt-3">
                <dt className="text-ink-500">Bank</dt><dd className="text-ink-300">{c.paymentConfig.bankName}</dd>
                <dt className="text-ink-500">Account name</dt><dd className="text-ink-300">{c.paymentConfig.accountName}</dd>
                <dt className="text-ink-500">Account number</dt><dd className="font-mono text-ink-300">{c.paymentConfig.accountNumber}</dd>
                {c.paymentConfig.autoVerifyMaxAmount && (
                  <><dt className="text-ink-500">Auto-verify limit</dt><dd className="text-ink-300">{Number(c.paymentConfig.autoVerifyMaxAmount).toLocaleString()}</dd></>
                )}
              </dl>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Security ── */}
      {activeTab === 'security' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Security Overview</h2>
          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-3">
            <DiagRow label="Community status" value={c.status} status={c.status === 'ACTIVE' ? 'ok' : 'warn'} />
            <DiagRow label="Suspended at" value={c.suspendedAt ? formatDate(c.suspendedAt) : 'N/A'} />
            <DiagRow label="Suspension reason" value={c.suspendedReason ?? 'N/A'} />
            <DiagRow label="Total audit entries" value={c.counts.auditLogs.toLocaleString()} />
            <DiagRow label="Last platform-admin view" value="See Audit tab" />
          </div>
          <p className="text-xs text-ink-500">
            Session revocation and user security actions are available on individual user detail pages.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function UserTable({ users, loading, onViewUser }) {
  if (loading) return (
    <div className="flex items-center justify-center py-16 text-ink-500">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      Loading…
    </div>
  )
  if (users.length === 0) return (
    <p className="py-12 text-center text-sm text-ink-500">No users found.</p>
  )
  return (
    <div className="rounded-xl border border-ink-700 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-ink-800/60 border-b border-ink-700">
          <tr>
            {['Name', 'Email', 'Role', 'Resident status', 'Unit', 'Last activity', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-ink-800 hover:bg-ink-800/30 transition-colors">
              <td className="px-4 py-3 text-white">{u.fullName}</td>
              <td className="px-4 py-3 text-ink-400">{u.email}</td>
              <td className="px-4 py-3">
                <span className={`text-xs font-medium ${u.role === 'ADMIN' ? 'text-teal-400' : 'text-ink-400'}`}>{u.role}</span>
              </td>
              <td className="px-4 py-3 text-ink-400 text-xs">{u.residentStatus ?? '—'}</td>
              <td className="px-4 py-3 text-ink-400 text-xs">{u.unitNumber ?? '—'}</td>
              <td className="px-4 py-3 text-ink-500 text-xs">
                {u.lastActivity ? new Date(u.lastActivity).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </td>
              <td className="px-4 py-3">
                <button onClick={() => onViewUser(u.id)} className="text-xs text-teal-400 hover:text-teal-300 transition">
                  View →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaginationBar({ pagination, onPage }) {
  const { page, totalPages, total } = pagination
  return (
    <div className="flex items-center justify-between text-sm text-ink-400">
      <span>Page {page} of {totalPages} — {total.toLocaleString()} total</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage((p) => Math.max(1, p - 1))} disabled={page === 1}
          className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30 transition">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button onClick={() => onPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
          className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30 transition">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function PlatformAuditSection({ communityId }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    platformApi.get(platformEndpoints.audit(), { params: { communityId, page: 1, pageSize: 50 } })
      .then(({ data }) => setLogs(data.data ?? []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [communityId])

  if (loading) return <div className="flex items-center gap-2 text-ink-500 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
  if (logs.length === 0) return <p className="text-sm text-ink-500">No platform audit entries for this community yet.</p>

  return (
    <div className="rounded-xl border border-ink-700 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-ink-800/60 border-b border-ink-700">
          <tr>
            {['Time', 'Operator', 'Action', 'Description'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-b border-ink-800">
              <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">
                {new Date(l.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td className="px-4 py-3 text-ink-400 text-xs">{l.actorEmail ?? '—'}</td>
              <td className="px-4 py-3"><code className="text-xs bg-ink-700 px-1.5 py-0.5 rounded">{l.action}</code></td>
              <td className="px-4 py-3 text-xs text-ink-400 max-w-sm truncate">{l.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
