import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldAlert, AlertTriangle, Loader2, KeyRound, Lock, Users,
  MonitorSmartphone, MonitorX, ShieldCheck, ArrowRight,
} from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { actionLabel, actionSeverity, severityBadgeClass, fmtDateTime } from '../lib/securityDisplay'

function StatCard({ icon: Icon, label, value, hint, tone = 'default' }) {
  const toneClass = tone === 'warn' ? 'text-amber-400' : tone === 'danger' ? 'text-red-400' : 'text-teal-400'
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-ink-400 uppercase tracking-wide">{label}</span>
        <Icon className={`w-4 h-4 ${toneClass}`} />
      </div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      {hint && <div className="text-xs text-ink-500 mt-1">{hint}</div>}
    </div>
  )
}

export default function PlatformSecurityDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [windowHours, setWindowHours] = useState(24)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    platformApi
      .get(platformEndpoints.securityOverview(), { params: { windowHours } })
      .then(({ data }) => { if (!cancelled) setData(data.data) })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.message || 'Failed to load security overview') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [windowHours])

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-semibold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-teal-400" />
            Security Center
          </h1>
          <p className="text-sm text-ink-400 mt-1">Authentication activity, sessions, and privileged operations across the platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
          <Link
            to="/platform-admin/security/sessions"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 transition"
          >
            <MonitorSmartphone className="w-4 h-4" /> Sessions
          </Link>
          <Link
            to="/platform-admin/security/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 transition"
          >
            <KeyRound className="w-4 h-4" /> Settings
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24 text-ink-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Authentication security */}
          <div>
            <h2 className="text-sm font-semibold text-ink-300 mb-3">Authentication security</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard icon={KeyRound} label="Failed logins" value={data.authentication.failedLogins} />
              <StatCard icon={ShieldCheck} label="Successful logins" value={data.authentication.successfulLogins} />
              <StatCard icon={AlertTriangle} label="Suspicious events" value={data.authentication.suspiciousLoginEvents} tone={data.authentication.suspiciousLoginEvents > 0 ? 'warn' : 'default'} />
              <StatCard icon={Lock} label="Locked accounts" value={data.authentication.lockedAccounts} tone={data.authentication.lockedAccounts > 0 ? 'warn' : 'default'} />
              <StatCard icon={MonitorSmartphone} label="Active sessions" value={data.authentication.activeSessions} />
              <StatCard icon={MonitorX} label="Revoked sessions" value={data.authentication.revokedSessions} />
            </div>
          </div>

          {/* MFA adoption */}
          <div>
            <h2 className="text-sm font-semibold text-ink-300 mb-3">MFA adoption</h2>
            <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl font-semibold text-white">{data.mfa.adoptionPercent}%</span>
                <span className="text-xs text-ink-400">{data.mfa.mfaEnabledCount} of {data.mfa.totalAdmins} admins enrolled</span>
              </div>
              <div className="w-full h-2 rounded-full bg-ink-700 overflow-hidden mb-4">
                <div className="h-full bg-teal-500" style={{ width: `${data.mfa.adoptionPercent}%` }} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {data.mfa.byRole.map((r) => (
                  <div key={r.role} className="flex items-center justify-between rounded-lg bg-ink-900/40 px-3 py-2 text-xs">
                    <span className="text-ink-300">{r.role}</span>
                    <span className="text-ink-400">{r.mfaEnabled}/{r.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Suspicious events */}
          <div>
            <h2 className="text-sm font-semibold text-ink-300 mb-3">Suspicious login events</h2>
            <div className="rounded-xl border border-ink-700 overflow-hidden">
              {data.suspiciousEvents.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-500">No suspicious login activity in this window.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <tbody>
                    {data.suspiciousEvents.map((e) => (
                      <tr key={e.id} className="border-b border-ink-800 last:border-0">
                        <td className="px-4 py-2.5 text-ink-300">{e.description}</td>
                        <td className="px-4 py-2.5 text-ink-500 text-xs whitespace-nowrap">{e.ipAddress || '—'}</td>
                        <td className="px-4 py-2.5 text-ink-500 text-xs whitespace-nowrap text-right">{fmtDateTime(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent privileged operations */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-ink-300">Recent privileged operations</h2>
              <Link to="/platform-admin/security/events" className="text-xs text-teal-400 hover:text-teal-300 inline-flex items-center gap-1">
                View all events <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="rounded-xl border border-ink-700 overflow-hidden">
              {data.recentPrivilegedOperations.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-500">No privileged operations recorded yet.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 bg-ink-800/60">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Action</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Actor</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Severity</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-ink-400 uppercase tracking-wide">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentPrivilegedOperations.map((op) => (
                      <tr key={op.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/40">
                        <td className="px-4 py-2.5 text-ink-200">{actionLabel(op.action)}</td>
                        <td className="px-4 py-2.5 text-ink-400 text-xs">{op.actorEmail || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={severityBadgeClass(actionSeverity(op.action, op.success))}>
                            {actionSeverity(op.action, op.success)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-ink-500 text-xs text-right whitespace-nowrap">{fmtDateTime(op.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <Link to="/platform-admin/platform-admins" className="inline-flex items-center gap-1.5 text-sm text-teal-400 hover:text-teal-300">
              <Users className="w-4 h-4" /> Manage platform admins
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
