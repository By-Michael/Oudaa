import { useEffect, useMemo, useState } from 'react'
import { Save, LockKeyhole, Settings2 } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { PLATFORM_PERMISSIONS, roleHasPermission } from '../lib/platformPermissions'

const CATEGORY_ORDER = ['general','support','ai','email','payments','storage','performance','maintenance','feature-flags']
function pretty(key) { return key.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()) }
function formatValue(v) { return typeof v === 'boolean' ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v ?? '') }
function parseValue(raw, current) { if (typeof current === 'boolean') return raw === 'true'; if (typeof current === 'number') return Number(raw); try { return JSON.parse(raw) } catch { return raw } }

export default function PlatformSettings() {
  const { admin } = usePlatformAuth()
  const canManage = roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.SETTINGS_MANAGE)
  const [rows, setRows] = useState([]); const [draft, setDraft] = useState({}); const [saving, setSaving] = useState('')
  async function load() { const { data } = await platformApi.get(platformEndpoints.platformSettings()); setRows(data.data||[]); setDraft(Object.fromEntries((data.data||[]).map(r=>[r.id, formatValue(r.value)]))) }
  useEffect(()=>{load()},[])
  const grouped = useMemo(()=>{ const map = {}; for(const row of rows) (map[row.category] ||= []).push(row); return CATEGORY_ORDER.map(c=>[c,map[c]||[]]).filter(([,items])=>items.length).concat(Object.entries(map).filter(([c])=>!CATEGORY_ORDER.includes(c))) },[rows])
  async function save(row) { setSaving(row.id); try { const value = row.isSensitive ? draft[row.id] : parseValue(draft[row.id], row.value); await platformApi.patch(platformEndpoints.platformSetting(row.id), { value }); await load() } finally { setSaving('') } }
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold text-white">Platform Configuration</h1><p className="text-sm text-ink-400 mt-1">Operational settings are server-managed. Sensitive credentials are never returned to the browser.</p>{!canManage && <p className="text-xs text-amber-300 mt-2">Read-only access — your role can inspect configuration but cannot change it.</p>}</div>{grouped.map(([cat,items])=><section key={cat} className="rounded-xl border border-ink-700 bg-ink-900 overflow-hidden"><div className="px-5 py-3 border-b border-ink-700 flex items-center gap-2"><Settings2 className="w-4 h-4 text-teal-300"/><h2 className="font-semibold text-white capitalize">{cat}</h2></div><div className="divide-y divide-ink-800">{items.map(row=><div key={row.id} className="p-4 grid gap-3 md:grid-cols-[1fr_1.4fr_auto] items-center"><div><div className="text-sm text-white">{pretty(row.key)}</div><div className="text-xs text-ink-500 mt-1">{row.description}</div>{row.managedBy !== 'DATABASE' && <div className="text-[11px] text-amber-300 mt-1">Managed by deployment environment</div>}</div><div className="relative">{row.isSensitive && <LockKeyhole className="absolute left-3 top-2.5 w-4 h-4 text-ink-500"/>}<input className="input pl-9" type={row.isSensitive?'password':'text'} value={draft[row.id]??''} onChange={e=>setDraft({...draft,[row.id]:e.target.value})} placeholder={row.isSensitive?'Managed server-side':''} disabled={row.managedBy !== 'DATABASE'}/></div>{canManage && row.managedBy === 'DATABASE' && <button onClick={()=>save(row)} disabled={saving===row.id} className="btn-secondary inline-flex items-center gap-2 justify-center"><Save className="w-4 h-4"/>{saving===row.id?'Saving…':'Save'}</button>}</div>)}</div></section>)}</div>
}
