import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  UserCircle,
  ArrowLeft,
  ShieldAlert,
  LogOut,
  AlertTriangle,
  Loader2,
  Clock,
  Activity,
  ScrollText,
  Building2,
  Home,
  LifeBuoy,
} from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { PLATFORM_PERMISSIONS, roleHasPermission } from '../lib/platformPermissions'
import SupportViewBanner from '../components/SupportViewBanner'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtShort(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

function Badge({ children, colour = 'default' }) {
  const cls = {
    default: 'bg-ink-700/60 text-ink-400 border-ink-600',
    teal:    'bg-teal-500/15 text-teal-400 border-teal-500/30',
    amber:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
    red:     'bg-red-500/15 text-red-400 border-red-500/30',
    green:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  }[colour]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  )
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-ink-800 last:border-0 gap-4">
      <span className="text-sm text-ink-500 shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? 'font-mono text-xs text-ink-400' : 'text-ink-200'}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

const TABS = [
  { id: 'identity',  label: 'Identity',       icon: UserCircle },
  { id: 'sessions',  label: 'Sessions',        icon: Clock },
  { id: 'activity',  label: 'Activity',        icon: Activity },
  { id: 'audit',     label: 'Audit History',   icon: ScrollText },
]

// ─── main component ───────────────────────────────────────────────────────────

export default function PlatformUserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { admin } = usePlatformAuth()

  const canManage  = roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.USERS_MANAGE)
  const canViewAs  = roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.IMPERSONATION_USE)

  const [activeTab, setActiveTab]         = useState('identity')
  const [user, setUser]                   = useState(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [revokeLoading, setRevokeLoading] = useState(false)
  const [revokeMsg, setRevokeMsg]         = useState('')
  const [viewSession, setViewSession]     = useState(null) // active support-view session
  const [viewLoading, setViewLoading]     = useState(false)

  const fetchUser = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await platformApi.get(platformEndpoints.userDetail(id))
      setUser(data.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load user')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchUser() }, [fetchUser])

  async function handleRevokeSessions() {
    if (!window.confirm('Revoke all active sessions for this user? They will be signed out immediately.')) return
    setRevokeLoading(true)
    setRevokeMsg('')
    try {
      await platformApi.post(platformEndpoints.userRevokeSessions(id))
      setRevokeMsg('All sessions revoked.')
      await fetchUser()
    } catch (err) {
      setRevokeMsg(err.response?.data?.message || 'Revoke failed')
    } finally {
      setRevokeLoading(false)
    }
  }

  async function handleStartSupportView() {
    setViewLoading(true)
    try {
      const { data } = await platformApi.post(platformEndpoints.userStartSupportView(id))
      setViewSession(data.data)
    } catch (err) {
      alert(err.response?.data?.message || 'Could not start support view session')
    } finally {
      setViewLoading(false)
    }
  }

  function handleEndSupportView() {
    setViewSession(null)
  }

  // ── Loading / error ────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-ink-500">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      Loading user…
    </div>
  )

  if (error) return (
    <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 max-w-xl">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      {error}
    </div>
  )

  const u = user

  // ── page ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Support view banner — always visible if session active */}
      {viewSession && (
        <SupportViewBanner
          session={{
            id: viewSession.sessionId,
            expiresAt: viewSession.expiresAt,
            operatorEmail: admin?.email,
            targetEmail: u.email,
          }}
          onEnd={handleEndSupportView}
        />
      )}

      {/* Breadcrumb / header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/platform-admin/users')}
          className="flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Users
        </button>
        <span className="text-ink-700">/</span>
        <h1 className="text-lg font-semibold text-white">{u.fullName}</h1>
        <Badge colour={u.role === 'ADMIN' ? 'teal' : 'default'}>{u.role}</Badge>
        {u.community && (
          <button
            onClick={() => navigate(`/platform-admin/communities/${u.community.id}`)}
            className="flex items-center gap-1 text-xs text-ink-400 hover:text-teal-400 transition"
          >
            <Building2 className="w-3.5 h-3.5" />
            {u.community.name}
          </button>
        )}

        {/* Action buttons */}
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <button
              onClick={handleRevokeSessions}
              disabled={revokeLoading || u.sessions?.active === 0}
              title={u.sessions?.active === 0 ? 'No active sessions' : 'Revoke all sessions'}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogOut className="w-3.5 h-3.5" />
              Revoke sessions {u.sessions?.active > 0 && `(${u.sessions.active})`}
            </button>
          )}

          {canViewAs && !viewSession && (
            <button
              onClick={handleStartSupportView}
              disabled={viewLoading}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition disabled:opacity-50"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {viewLoading ? 'Starting…' : 'View as user'}
            </button>
          )}
        </div>
      </div>

      {revokeMsg && (
        <div className="text-xs text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-lg px-3 py-2">
          {revokeMsg}
        </div>
      )}

      {/* Active sessions badge */}
      {u.sessions?.active > 0 && (
        <div className="flex items-center gap-2 text-xs text-ink-400">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          {u.sessions.active} active session{u.sessions.active !== 1 ? 's' : ''}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-ink-700">
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
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

      {/* ── Identity ── */}
      {activeTab === 'identity' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Account */}
          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5">
            <h2 className="text-sm font-medium text-ink-300 mb-3">Account</h2>
            <InfoRow label="ID"          value={u.id}          mono />
            <InfoRow label="Full name"   value={u.fullName} />
            <InfoRow label="Email"       value={u.email} />
            <InfoRow label="Role"        value={u.role} />
            <InfoRow label="Created"     value={fmt(u.createdAt)} />
            <InfoRow label="Updated"     value={fmt(u.updatedAt)} />
            <InfoRow label="Last activity" value={fmt(u.lastActivity)} />
          </div>

          {/* Community */}
          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5">
            <h2 className="text-sm font-medium text-ink-300 mb-3">Community</h2>
            {u.community ? (
              <>
                <InfoRow label="Name"   value={u.community.name} />
                <InfoRow label="Slug"   value={u.community.slug}   mono />
                <InfoRow label="ID"     value={u.community.id}     mono />
                <InfoRow label="Status" value={u.community.status} />
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    onClick={() => navigate(`/platform-admin/communities/${u.community.id}`)}
                    className="text-xs text-teal-400 hover:text-teal-300 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
                  >
                    View community →
                  </button>
                  <button
                    onClick={() => navigate(`/platform-admin/support?userId=${encodeURIComponent(u.id)}`)}
                    className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-teal-400 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
                  >
                    <LifeBuoy className="w-3.5 h-3.5" /> Support tickets →
                  </button>
                </div>
              </>
            ) : <p className="text-sm text-ink-500">Not associated with a community.</p>}
          </div>

          {/* Resident profile */}
          {u.residentProfile && (
            <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5">
              <h2 className="text-sm font-medium text-ink-300 mb-3 flex items-center gap-2">
                <Home className="w-3.5 h-3.5" />
                Resident Profile
              </h2>
              <InfoRow label="Resident ID"  value={u.residentProfile.id}          mono />
              <InfoRow label="Status"       value={u.residentProfile.status} />
              <InfoRow label="Unit"         value={u.residentProfile.unitNumber} />
              {u.residentProfile.inactiveReason && (
                <InfoRow label="Inactive reason" value={u.residentProfile.inactiveReason} />
              )}
            </div>
          )}

          {/* Security note */}
          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5">
            <h2 className="text-sm font-medium text-ink-300 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              Masked fields
            </h2>
            <p className="text-xs text-ink-500 leading-relaxed">
              The following fields are intentionally never shown to platform operators:
              password hash, MFA secret, raw refresh tokens, and API keys.
              All other fields displayed on this page are safe to inspect.
            </p>
          </div>
        </div>
      )}

      {/* ── Sessions ── */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-300">
              Sessions — {u.sessions?.active ?? 0} active / {u.sessions?.total ?? 0} total
            </h2>
          </div>

          {u.sessions?.list?.length === 0 ? (
            <p className="text-sm text-ink-500 py-8 text-center">No session records.</p>
          ) : (
            <div className="rounded-xl border border-ink-700 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-ink-800/60 border-b border-ink-700">
                  <tr>
                    {['Token ID', 'Created', 'Last used', 'Expires', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {u.sessions.list.map((s) => (
                    <tr key={s.id} className="border-b border-ink-800">
                      <td className="px-4 py-3 font-mono text-xs text-ink-500">{s.id.slice(0, 12)}…</td>
                      <td className="px-4 py-3 text-xs text-ink-400 whitespace-nowrap">{fmtShort(s.createdAt)}</td>
                      <td className="px-4 py-3 text-xs text-ink-400 whitespace-nowrap">{fmtShort(s.lastUsedAt)}</td>
                      <td className="px-4 py-3 text-xs text-ink-400 whitespace-nowrap">{fmtShort(s.expiresAt)}</td>
                      <td className="px-4 py-3">
                        {s.active
                          ? <Badge colour="green">Active</Badge>
                          : s.revoked
                          ? <Badge colour="red">Revoked</Badge>
                          : <Badge>Expired</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Activity ── */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Recent Activity</h2>
          {u.auditHistory?.length === 0 ? (
            <p className="text-sm text-ink-500 py-8 text-center">No activity recorded.</p>
          ) : (
            <div className="rounded-xl border border-ink-700 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-ink-800/60 border-b border-ink-700">
                  <tr>
                    {['Time', 'Action', 'Entity', 'Description'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {u.auditHistory.map((a) => (
                    <tr key={a.id} className="border-b border-ink-800">
                      <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{fmtShort(a.createdAt)}</td>
                      <td className="px-4 py-3"><code className="text-xs bg-ink-700 px-1.5 py-0.5 rounded">{a.action}</code></td>
                      <td className="px-4 py-3 text-xs text-ink-400">{a.entityType}</td>
                      <td className="px-4 py-3 text-xs text-ink-400 max-w-sm truncate">{a.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Audit History (platform-side) ── */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-ink-300">Platform Audit — Actions on this user</h2>
          <PlatformUserAuditSection userId={id} />
        </div>
      )}
    </div>
  )
}

// ─── platform audit for user ─────────────────────────────────────────────────

function PlatformUserAuditSection({ userId }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    platformApi.get(platformEndpoints.audit(), { params: { entityId: userId, page: 1, pageSize: 50 } })
      .then(({ data }) => setLogs(data.data ?? []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return (
    <div className="flex items-center gap-2 text-ink-500 text-sm py-8">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )

  if (logs.length === 0) return (
    <p className="text-sm text-ink-500">No platform audit entries for this user yet.</p>
  )

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
              <td className="px-4 py-3 text-xs text-ink-400">{l.actorEmail ?? '—'}</td>
              <td className="px-4 py-3"><code className="text-xs bg-ink-700 px-1.5 py-0.5 rounded">{l.action}</code></td>
              <td className="px-4 py-3 text-xs text-ink-400 max-w-sm truncate">{l.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
