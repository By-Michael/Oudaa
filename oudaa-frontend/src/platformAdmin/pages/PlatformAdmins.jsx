import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserCog, Search, Loader2, AlertTriangle, Plus, X, ShieldCheck, ShieldOff } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { roleHasPermission, PLATFORM_PERMISSIONS } from '../lib/platformPermissions'
import { ASSIGNABLE_ROLES, fmtDateTime } from '../lib/securityDisplay'

function RoleBadge({ role }) {
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border border-ink-600 bg-ink-700/60 text-ink-300">{role}</span>
}

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

function CreateAdminModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'SUPPORT_AGENT' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await platformApi.post(platformEndpoints.platformAdmins(), { ...form, confirm: true })
      onCreated()
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not create this admin')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 shadow-card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
          <h3 className="font-semibold text-white">New platform admin</h3>
          <button type="button" onClick={onClose} className="text-ink-500 hover:text-ink-200"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1">Full name</label>
            <input required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1">Email</label>
            <input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1">Temporary password</label>
            <input required type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1">Role</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-teal-500">
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-xs text-ink-500 mt-1">You can only grant a role that carries permissions you already have.</p>
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ink-700">
          <button type="button" onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm text-ink-300 hover:bg-ink-700 transition">Cancel</button>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition disabled:opacity-60">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create admin
          </button>
        </div>
      </form>
    </div>
  )
}

export default function PlatformAdmins() {
  const navigate = useNavigate()
  const { admin: me } = usePlatformAuth()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [admins, setAdmins] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const canManage = roleHasPermission(me?.role, PLATFORM_PERMISSIONS.ADMINS_MANAGE)

  function load() {
    setLoading(true)
    platformApi
      .get(platformEndpoints.platformAdmins(), { params: { search: search || undefined, role: role === 'all' ? undefined : role, status: status === 'all' ? undefined : status, pageSize: 50 } })
      .then(({ data }) => { setAdmins(data.data); setPagination(data.pagination) })
      .catch((err) => setError(err?.response?.data?.message || 'Failed to load platform admins'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, role, status])

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-semibold text-white flex items-center gap-2">
            <UserCog className="w-5 h-5 text-teal-400" /> Platform Admins
          </h1>
          <p className="text-sm text-ink-400 mt-1">Operators with access to the platform console itself.</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white px-3 py-2 text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" /> New admin
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-800/60 pl-9 pr-3 py-2 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
          <option value="all">All roles</option>
          {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-800/60">
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">MFA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Last login</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Last failed login</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-ink-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            )}
            {!loading && admins.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-ink-500">No platform admins found</td></tr>
            )}
            {!loading && admins.map((a) => (
              <tr key={a.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/40 cursor-pointer" onClick={() => navigate(`/platform-admin/platform-admins/${a.id}`)}>
                <td className="px-4 py-3 font-medium text-white">{a.fullName}</td>
                <td className="px-4 py-3 text-ink-400 text-xs">{a.email}</td>
                <td className="px-4 py-3"><RoleBadge role={a.role} /></td>
                <td className="px-4 py-3"><StatusBadge isActive={a.isActive} /></td>
                <td className="px-4 py-3 text-xs">{a.mfaEnabled ? <span className="text-teal-400">Enrolled</span> : <span className="text-ink-500">Not enrolled</span>}</td>
                <td className="px-4 py-3 text-ink-500 text-xs whitespace-nowrap">{fmtDateTime(a.lastLoginAt)}</td>
                <td className="px-4 py-3 text-ink-500 text-xs whitespace-nowrap">{fmtDateTime(a.lastFailedLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="text-xs text-ink-500">{pagination.total} platform admin{pagination.total === 1 ? '' : 's'}</div>
      )}

      {showCreate && (
        <CreateAdminModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load() }} />
      )}
    </div>
  )
}
