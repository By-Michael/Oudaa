import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Loader2, AlertTriangle, ShieldCheck, ShieldOff, KeyRound,
  RefreshCcw, MonitorX, UserCog, Activity,
} from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { roleHasPermission, PLATFORM_PERMISSIONS } from '../lib/platformPermissions'
import { ASSIGNABLE_ROLES, actionLabel, fmtDateTime } from '../lib/securityDisplay'
import ConfirmActionModal from '../components/ConfirmActionModal'

function StatusBadge({ isActive }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-teal-500/30 bg-teal-500/10 text-teal-400">
      <ShieldCheck className="w-3 h-3" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-red-500/30 bg-red-500/10 text-red-400">
      <ShieldOff className="w-3 h-3" /> Disabled
    </span>
  )
}

// Which confirmation dialog is currently open, if any. Kept as a single
// piece of state (rather than one boolean per action) so only one modal
// can ever be open at a time.
const ACTIONS = {
  DISABLE: 'disable',
  ENABLE: 'enable',
  ROLE: 'role',
  PASSWORD_RESET: 'password_reset',
  MFA_REENROLL: 'mfa_reenroll',
  REVOKE_SESSIONS: 'revoke_sessions',
}

export default function PlatformAdminDetail() {
  const { id } = useParams()
  const { admin: me } = usePlatformAuth()
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const [pendingRole, setPendingRole] = useState('')

  const canManage = roleHasPermission(me?.role, PLATFORM_PERMISSIONS.ADMINS_MANAGE)
  const isSelf = me?.id === id

  function load() {
    setLoading(true)
    setError('')
    platformApi
      .get(platformEndpoints.platformAdminDetail(id))
      .then(({ data }) => setAdmin(data.data))
      .catch((err) => setError(err?.response?.data?.message || 'Failed to load this admin'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [id])

  function flash(message) {
    setNotice(message)
    setTimeout(() => setNotice(''), 5000)
  }

  async function runAction(reason) {
    switch (activeAction) {
      case ACTIONS.DISABLE:
        await platformApi.post(platformEndpoints.platformAdminDisable(id), { reason, confirm: true })
        flash('Admin disabled. All active sessions were revoked.')
        break
      case ACTIONS.ENABLE:
        await platformApi.post(platformEndpoints.platformAdminEnable(id), { reason, confirm: true })
        flash('Admin re-enabled.')
        break
      case ACTIONS.ROLE:
        await platformApi.patch(platformEndpoints.platformAdminRole(id), { role: pendingRole, reason, confirm: true })
        flash(`Role changed to ${pendingRole}.`)
        break
      case ACTIONS.PASSWORD_RESET:
        await platformApi.post(platformEndpoints.platformAdminRequirePasswordReset(id), { reason: reason || undefined, confirm: true })
        flash('Password reset required. Active sessions were revoked.')
        break
      case ACTIONS.MFA_REENROLL:
        await platformApi.post(platformEndpoints.platformAdminRequireMfaReenrollment(id), { reason: reason || undefined, confirm: true })
        flash('MFA re-enrollment required. The previous authenticator was revoked.')
        break
      case ACTIONS.REVOKE_SESSIONS:
        await platformApi.post(platformEndpoints.platformAdminRevokeSessions(id), { reason: reason || undefined, confirm: true })
        flash('All active sessions for this admin were revoked.')
        break
      default:
        break
    }
    setActiveAction(null)
    load()
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-ink-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  if (error || !admin) {
    return (
      <div className="max-w-2xl space-y-4">
        <Link to="/platform-admin/platform-admins" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200">
          <ArrowLeft className="w-4 h-4" /> Platform Admins
        </Link>
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error || 'Admin not found'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/platform-admin/platform-admins" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200 mb-2">
          <ArrowLeft className="w-4 h-4" /> Platform Admins
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-display font-semibold text-white flex items-center gap-2">
              <UserCog className="w-5 h-5 text-teal-400" /> {admin.fullName}
            </h1>
            <p className="text-sm text-ink-400 mt-1">{admin.email}</p>
          </div>
          <StatusBadge isActive={admin.isActive} />
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">{notice}</div>
      )}

      {isSelf && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          This is your own account. To prevent privilege self-escalation, you can't change your own role, status, password-reset flag, or MFA re-enrollment flag from here — ask another Super Admin, or use your own account settings.
        </div>
      )}

      {/* Identity summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="text-xs text-ink-400 uppercase tracking-wide mb-1">Role</div>
          <div className="text-white font-medium">{admin.role}</div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="text-xs text-ink-400 uppercase tracking-wide mb-1">MFA</div>
          <div className="text-white font-medium">{admin.mfaEnabled ? 'Enrolled' : 'Not enrolled'}</div>
          {admin.mfaReenrollmentRequired && <div className="text-xs text-amber-400 mt-1">Re-enrollment required</div>}
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="text-xs text-ink-400 uppercase tracking-wide mb-1">Active sessions</div>
          <div className="text-white font-medium">{admin.activeSessionCount}</div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="text-xs text-ink-400 uppercase tracking-wide mb-1">Password reset</div>
          <div className="text-white font-medium">{admin.mustChangePassword ? 'Required' : 'Not required'}</div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="text-xs text-ink-400 uppercase tracking-wide mb-1">Last login</div>
          <div className="text-white font-medium text-sm">{fmtDateTime(admin.lastLoginAt)}</div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="text-xs text-ink-400 uppercase tracking-wide mb-1">Last failed login</div>
          <div className="text-white font-medium text-sm">{fmtDateTime(admin.lastFailedLoginAt)}</div>
        </div>
      </div>

      {/* Management actions */}
      {canManage && !isSelf && (
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-ink-300">Manage this admin</h2>

          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={pendingRole || admin.role}
              onChange={(e) => setPendingRole(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              disabled={(pendingRole || admin.role) === admin.role}
              onClick={() => setActiveAction(ACTIONS.ROLE)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition disabled:opacity-40"
            >
              Change role
            </button>
            <span className="text-xs text-ink-500">You can only assign a role that carries permissions you already have.</span>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-ink-700">
            {admin.isActive ? (
              <button onClick={() => setActiveAction(ACTIONS.DISABLE)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-400 border border-red-500/30 hover:bg-red-500/10 transition">
                <ShieldOff className="w-4 h-4" /> Disable admin
              </button>
            ) : (
              <button onClick={() => setActiveAction(ACTIONS.ENABLE)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-teal-400 border border-teal-500/30 hover:bg-teal-500/10 transition">
                <ShieldCheck className="w-4 h-4" /> Re-enable admin
              </button>
            )}
            <button onClick={() => setActiveAction(ACTIONS.PASSWORD_RESET)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-ink-200 border border-ink-600 hover:bg-ink-700 transition">
              <KeyRound className="w-4 h-4" /> Require password reset
            </button>
            <button onClick={() => setActiveAction(ACTIONS.MFA_REENROLL)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-ink-200 border border-ink-600 hover:bg-ink-700 transition">
              <RefreshCcw className="w-4 h-4" /> Require MFA re-enrollment
            </button>
            <button onClick={() => setActiveAction(ACTIONS.REVOKE_SESSIONS)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-ink-200 border border-ink-600 hover:bg-ink-700 transition">
              <MonitorX className="w-4 h-4" /> Revoke all sessions
            </button>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div>
        <h2 className="text-sm font-semibold text-ink-300 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" /> Recent activity
        </h2>
        <div className="rounded-xl border border-ink-700 overflow-hidden">
          {admin.recentActivity.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-500">No recorded activity yet.</div>
          ) : (
            <table className="min-w-full text-sm">
              <tbody>
                {admin.recentActivity.map((a) => (
                  <tr key={a.id} className="border-b border-ink-800 last:border-0">
                    <td className="px-4 py-2.5 text-ink-200">{actionLabel(a.action)}</td>
                    <td className="px-4 py-2.5 text-ink-500 text-xs">{a.description}</td>
                    <td className="px-4 py-2.5 text-ink-500 text-xs text-right whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {activeAction === ACTIONS.DISABLE && (
        <ConfirmActionModal title="Disable this admin?" danger
          description={`${admin.fullName} will be signed out of every active session immediately and will not be able to log in until re-enabled.`}
          confirmLabel="Disable admin" onConfirm={runAction} onClose={() => setActiveAction(null)} />
      )}
      {activeAction === ACTIONS.ENABLE && (
        <ConfirmActionModal title="Re-enable this admin?"
          description={`${admin.fullName} will be able to log in again.`}
          confirmLabel="Re-enable admin" onConfirm={runAction} onClose={() => setActiveAction(null)} />
      )}
      {activeAction === ACTIONS.ROLE && (
        <ConfirmActionModal title={`Change role to ${pendingRole}?`} danger
          description={`${admin.fullName}'s role will change from ${admin.role} to ${pendingRole}. This takes effect immediately.`}
          confirmLabel="Change role" onConfirm={runAction} onClose={() => setActiveAction(null)} />
      )}
      {activeAction === ACTIONS.PASSWORD_RESET && (
        <ConfirmActionModal title="Require a password reset?" requireReason={false}
          description={`${admin.fullName} will be forced to set a new password before doing anything else, and their active sessions will be revoked immediately.`}
          confirmLabel="Require reset" onConfirm={runAction} onClose={() => setActiveAction(null)} />
      )}
      {activeAction === ACTIONS.MFA_REENROLL && (
        <ConfirmActionModal title="Require MFA re-enrollment?" danger requireReason={false}
          description={`${admin.fullName}'s current authenticator and recovery codes will be revoked. They must enroll a new authenticator before doing anything else.`}
          confirmLabel="Require re-enrollment" onConfirm={runAction} onClose={() => setActiveAction(null)} />
      )}
      {activeAction === ACTIONS.REVOKE_SESSIONS && (
        <ConfirmActionModal title="Revoke all sessions?" requireReason={false}
          description={`Every active session for ${admin.fullName} will be invalidated immediately. They can log in again normally.`}
          confirmLabel="Revoke sessions" onConfirm={runAction} onClose={() => setActiveAction(null)} />
      )}
    </div>
  )
}
