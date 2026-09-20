import { useEffect, useState } from 'react'
import { Edit3, Plus, Trash2, History, RefreshCw } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { PLATFORM_PERMISSIONS, roleHasPermission } from '../lib/platformPermissions'

const empty = { key: '', description: '', environment: 'production', enabled: false, rolloutPercentage: 100, communityIds: [] }

export default function PlatformFeatureFlags() {
  const { admin } = usePlatformAuth()
  const [flags, setFlags] = useState([])
  const [communities, setCommunities] = useState([])
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(true)
  const canManage = roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE)

  async function load() {
    setLoading(true)
    try {
      const [f, c] = await Promise.all([
        platformApi.get(platformEndpoints.featureFlags()),
        platformApi.get(platformEndpoints.communities(), { params: { page: 1, pageSize: 100, sortBy: 'name', sortDir: 'asc' } }),
      ])
      setFlags(f.data.data || [])
      setCommunities(c.data.data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setForm(empty); setShowForm(true) }
  function openEdit(flag) { setEditing(flag); setForm({ key: flag.key, description: flag.description || '', environment: flag.environment, enabled: flag.enabled, rolloutPercentage: flag.rolloutPercentage, communityIds: flag.targets.map((x) => x.communityId) }); setShowForm(true) }

  async function save(e) {
    e.preventDefault()
    const payload = { ...form, rolloutPercentage: Number(form.rolloutPercentage), communityIds: form.communityIds }
    if (editing) await platformApi.patch(platformEndpoints.featureFlag(editing.id), payload)
    else await platformApi.post(platformEndpoints.featureFlags(), payload)
    setShowForm(false); await load()
  }

  async function remove(flag) {
    if (!window.confirm(`Delete feature flag ${flag.key}? This is a configuration change; the audit trail will remain.`)) return
    await platformApi.delete(platformEndpoints.featureFlag(flag.id)); await load()
  }

  async function showHistory(flag) {
    const { data } = await platformApi.get(platformEndpoints.featureFlagHistory(flag.id))
    setHistory({ flag, rows: data.data || [] })
  }

  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-white">Feature Flags</h1><p className="text-sm text-ink-400 mt-1">Controlled rollouts. Flags never act as security authorization.</p></div><div className="flex gap-2"><button onClick={load} className="btn-secondary inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>{canManage && <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2"><Plus className="w-4 h-4" />Create flag</button>}</div></div>
    <div className="rounded-xl border border-ink-700 bg-ink-900 overflow-hidden">
      {loading ? <div className="p-8 text-ink-500">Loading…</div> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-ink-800/70 text-ink-400 text-left"><tr><th className="p-3">Flag</th><th className="p-3">Environment</th><th className="p-3">State</th><th className="p-3">Rollout</th><th className="p-3">Targets</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{flags.map((flag) => <tr key={flag.id} className="border-t border-ink-800"><td className="p-3"><div className="font-mono text-white">{flag.key}</div><div className="text-xs text-ink-500 mt-1 max-w-md">{flag.description || 'No description'}</div></td><td className="p-3 text-ink-300">{flag.environment}</td><td className="p-3"><span className={`badge ${flag.enabled ? 'badge-success' : 'badge-neutral'}`}>{flag.enabled ? 'Enabled' : 'Disabled'}</span></td><td className="p-3 text-ink-300">{flag.rolloutPercentage}%</td><td className="p-3 text-ink-300">{flag.targetCount ? `${flag.targetCount} communities` : 'All communities'}</td><td className="p-3"><div className="flex justify-end gap-1"><button onClick={() => showHistory(flag)} className="icon-btn" title="Audit history"><History className="w-4 h-4" /></button>{canManage && <button onClick={() => openEdit(flag)} className="icon-btn" title="Edit"><Edit3 className="w-4 h-4" /></button>}{canManage && <button onClick={() => remove(flag)} className="icon-btn text-red-300" title="Delete"><Trash2 className="w-4 h-4" /></button>}</div></td></tr>)}{!flags.length && <tr><td colSpan="6" className="p-8 text-center text-ink-500">No feature flags yet.</td></tr>}</tbody></table></div>}
    </div>

    {showForm && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><form onSubmit={save} className="w-full max-w-2xl rounded-2xl border border-ink-700 bg-ink-900 shadow-card"><div className="p-5 border-b border-ink-700"><h2 className="text-lg font-semibold text-white">{editing ? 'Edit feature flag' : 'Create feature flag'}</h2><p className="text-xs text-ink-500 mt-1">Changing a flag is audited. Do not use it as an authorization gate.</p></div><div className="p-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="label">Key</span><input className="input" required disabled={!!editing} value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} placeholder="new_payment_flow" /></label><label className="sm:col-span-2"><span className="label">Description</span><textarea className="input min-h-20" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label><label><span className="label">Environment</span><input className="input" value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value })} /></label><label><span className="label">Rollout percentage</span><input type="number" min="0" max="100" className="input" value={form.rolloutPercentage} onChange={e => setForm({ ...form, rolloutPercentage: e.target.value })} /></label><label className="sm:col-span-2 flex items-center gap-3"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /><span className="text-sm text-ink-200">Enabled</span></label><label className="sm:col-span-2"><span className="label">Community targeting</span><select multiple className="input min-h-32" value={form.communityIds} onChange={e => setForm({ ...form, communityIds: Array.from(e.target.selectedOptions).map(o => o.value).filter(Boolean) })}><option value="">— All communities —</option>{communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>)}</select><span className="text-[11px] text-ink-500">Hold Ctrl/Cmd to select multiple communities. An empty selection means all communities.</span></label></div><div className="flex justify-end gap-2 px-5 py-4 border-t border-ink-700"><button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="btn-primary" type="submit">Save flag</button></div></form></div>}

    {history && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><div className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-2xl border border-ink-700 bg-ink-900"><div className="flex items-center justify-between p-5 border-b border-ink-700"><div><h2 className="text-lg font-semibold text-white">Audit history — {history.flag.key}</h2><p className="text-xs text-ink-500 mt-1">Platform audit log is append-only.</p></div><button onClick={() => setHistory(null)} className="btn-secondary">Close</button></div><div className="overflow-y-auto max-h-[65vh] p-5 space-y-3">{history.rows.map(r => <div key={r.id} className="rounded-lg border border-ink-700 bg-ink-800/50 p-3"><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs text-teal-300">{r.action}</span><span className="text-[11px] text-ink-500">{new Date(r.createdAt).toLocaleString()}</span></div><div className="text-sm text-ink-200 mt-1">{r.description}</div><div className="text-xs text-ink-500 mt-1">{r.actorEmail || 'System'}{r.actorRole ? ` · ${r.actorRole}` : ''}</div></div>)}{!history.rows.length && <div className="text-sm text-ink-500">No history found.</div>}</div></div></div>}
  </div>
}
