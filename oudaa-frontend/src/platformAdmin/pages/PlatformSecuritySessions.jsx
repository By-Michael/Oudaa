import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertTriangle, MonitorSmartphone, XCircle } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { fmtDateTime } from '../lib/securityDisplay'
import ConfirmActionModal from '../components/ConfirmActionModal'

const STATUS_STYLES = {
  active: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  revoked: 'bg-ink-700/60 text-ink-400 border-ink-600',
  expired: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
}

export default function PlatformSecuritySessions() {
  const [status, setStatus] = useState('active')
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await platformApi.get(platformEndpoints.securitySessions(), { params: { status: status === 'all' ? undefined : status, pageSize: 100 } })
      setSessions(data.data)
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status])

  async function handleRevoke(reason) {
    await platformApi.delete(platformEndpoints.securitySessionRevoke(revokeTarget.id), { data: { reason: reason || undefined, confirm: true } })
    setRevokeTarget(null)
    load()
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <Link to="/platform-admin/security" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200 mb-2">
          <ArrowLeft className="w-4 h-4" /> Security Center
        </Link>
        <h1 className="text-xl font-display font-semibold text-white flex items-center gap-2">
          <MonitorSmartphone className="w-5 h-5 text-teal-400" /> Sessions
        </h1>
        <p className="text-sm text-ink-400 mt-1">Every platform-admin session. Revoking invalidates it server-side immediately.</p>
      </div>

      <div className="flex gap-2">
        {['active', 'revoked', 'expired', 'all'].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition ${
              status === s ? 'bg-teal-600/20 border-teal-500/50 text-teal-300' : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-xl border border-ink-700 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-800/60">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Admin</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Device / Browser</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">IP</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Created</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Last active</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-ink-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            )}
            {!loading && sessions.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-ink-500">No sessions found</td></tr>
            )}
            {!loading && sessions.map((s) => (
              <tr key={s.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/40">
                <td className="px-4 py-2.5">
                  <div className="text-ink-200">{s.admin?.fullName}</div>
                  <div className="text-xs text-ink-500">{s.admin?.email}</div>
                </td>
                <td className="px-4 py-2.5 text-ink-400 text-xs max-w-xs truncate">{s.userAgent || '—'}</td>
                <td className="px-4 py-2.5 text-ink-400 text-xs">{s.ipAddress || '—'}</td>
                <td className="px-4 py-2.5 text-ink-500 text-xs whitespace-nowrap">{fmtDateTime(s.createdAt)}</td>
                <td className="px-4 py-2.5 text-ink-500 text-xs whitespace-nowrap">{fmtDateTime(s.lastUsedAt)}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${STATUS_STYLES[s.status]}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {s.status === 'active' && (
                    <button
                      onClick={() => setRevokeTarget(s)}
                      className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {revokeTarget && (
        <ConfirmActionModal
          title="Revoke this session?"
          description={`This immediately signs out ${revokeTarget.admin?.email} on this device. They can log in again normally.`}
          confirmLabel="Revoke session"
          danger
          requireReason={false}
          onConfirm={handleRevoke}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  )
}
