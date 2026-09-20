import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ScrollText, X } from 'lucide-react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import PlatformPageHeader from '../components/PlatformPageHeader'
import PlatformErrorNotice from '../components/PlatformErrorNotice'

const PAGE_SIZE = 50
const ACTION_SUGGESTIONS = ['LOGIN_FAILED', 'COMMUNITY_SUSPENDED', 'USER_DISABLED', 'ROLE_CHANGED', 'PERMISSION_CHANGED', 'IMPERSONATION_STARTED', 'FEATURE_FLAG_CHANGED', 'MAINTENANCE_ENABLED', 'DATA_EXPORT_STARTED']

function Badge({ children, tone = 'neutral' }) {
  const classes = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    danger: 'border-red-500/30 bg-red-500/10 text-red-300',
    neutral: 'border-ink-600 bg-ink-800 text-ink-300',
  }
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${classes[tone]}`}>{children}</span>
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) : '—'
}

export default function PlatformAudit() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(() => ({
    search: searchParams.get('search') || '',
    actor: searchParams.get('actor') || '',
    action: searchParams.get('action') || '',
    entity: searchParams.get('entity') || '',
    communityId: searchParams.get('communityId') || '',
    requestId: searchParams.get('requestId') || '',
    success: searchParams.get('success') || 'all',
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  }))
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1)
  const selectedEntry = searchParams.get('entryId')
  const [selectedDetail, setSelectedDetail] = useState(null)

  const activeFilterCount = useMemo(() => Object.entries(filters).filter(([key, value]) => key !== 'success' ? value : value !== 'all').length, [filters])

  async function load(nextPage = page) {
    setLoading(true)
    setError(null)
    const params = Object.fromEntries(Object.entries({ ...filters, page: nextPage, pageSize: PAGE_SIZE }).filter(([, v]) => v !== '' && v !== 'all'))
    try {
      const { data } = await platformApi.get(platformEndpoints.audit(), { params })
      setRows(data.data || [])
      setPagination(data.pagination || null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(page) }, [page])

  useEffect(() => {
    let cancelled = false
    if (!selectedEntry) { setSelectedDetail(null); return undefined }
    platformApi.get(platformEndpoints.auditDetail(selectedEntry)).then(({ data }) => {
      if (!cancelled) setSelectedDetail(data.data || null)
    }).catch(() => { if (!cancelled) setSelectedDetail(null) })
    return () => { cancelled = true }
  }, [selectedEntry])

  function apply() {
    setPage(1)
    const next = Object.fromEntries(Object.entries(filters).filter(([key, value]) => value !== '' && !(key === 'success' && value === 'all')))
    setSearchParams({ ...next, page: '1' })
    load(1)
  }

  function clear() {
    const empty = { search: '', actor: '', action: '', entity: '', communityId: '', requestId: '', success: 'all', from: '', to: '' }
    setFilters(empty)
    setPage(1)
    setSearchParams({})
  }

  const selected = rows.find((r) => r.id === selectedEntry) || selectedDetail

  return (
    <div className="space-y-5 max-w-[1400px]">
      <PlatformPageHeader
        icon={ScrollText}
        title="Audit Center"
        description="Append-only platform operations trail. Search by actor, action, entity, tenant, date, outcome, or request ID."
        actions={activeFilterCount > 0 ? <button onClick={clear} className="btn-ghost text-xs"><X className="w-3.5 h-3.5" />Clear filters</button> : null}
      />

      <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['search', 'Search events…'],
            ['actor', 'Actor email / ID'],
            ['entity', 'Entity type'],
            ['communityId', 'Community ID'],
            ['requestId', 'Request ID'],
          ].map(([key, placeholder]) => (
            <label key={key} className="block">
              <span className="sr-only">{placeholder}</span>
              <input value={filters[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className="input bg-ink-800 border-ink-700 py-2.5" />
            </label>
          ))}
          <label className="block">
            <span className="sr-only">Action</span>
            <input list="audit-actions" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} placeholder="Action" className="input bg-ink-800 border-ink-700 py-2.5" />
            <datalist id="audit-actions">{ACTION_SUGGESTIONS.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
          <label className="block">
            <span className="sr-only">Outcome</span>
            <select value={filters.success} onChange={(e) => setFilters((f) => ({ ...f, success: e.target.value }))} className="input bg-ink-800 border-ink-700 py-2.5">
              <option value="all">All outcomes</option><option value="true">Success</option><option value="false">Failure</option>
            </select>
          </label>
          <label className="block"><span className="text-[11px] text-ink-500">From</span><input type="datetime-local" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="input bg-ink-800 border-ink-700 py-2.5" /></label>
          <label className="block"><span className="text-[11px] text-ink-500">To</span><input type="datetime-local" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="input bg-ink-800 border-ink-700 py-2.5" /></label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={apply} className="btn-primary text-xs"><Search className="w-3.5 h-3.5" />Apply filters</button>
          <span className="text-xs text-ink-600">Audit records cannot be edited or deleted from this console.</span>
        </div>
      </section>

      {error && <PlatformErrorNotice error={error} onRetry={() => load(page)} onDismiss={() => setError(null)} />}

      {selected && (
        <section className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
          <div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-wide text-teal-400">Selected event</div><div className="mt-1 text-sm text-white">{selected.description}</div></div><button onClick={() => { const p = new URLSearchParams(searchParams); p.delete('entryId'); navigate(`/platform-admin/audit?${p.toString()}`) }} className="text-xs text-ink-500 hover:text-white">Close</button></div>
        </section>
      )}

      <div className="table-wrap bg-ink-900/40">
        <table className="data-table min-w-[1100px]">
          <thead><tr>{['Time', 'Actor', 'Action', 'Entity', 'Community', 'Outcome', 'Request ID', 'Description'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-16 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-ink-500" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-16 text-center text-ink-500">No matching audit events.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} id={r.id} className={r.id === selectedEntry ? 'bg-teal-500/5' : ''}>
                <td><span className="text-xs text-ink-400 whitespace-nowrap">{formatDate(r.createdAt)}</span></td>
                <td><div className="text-xs text-ink-200">{r.actorEmail || 'System / unknown'}</div><div className="text-[10px] text-ink-600">{r.actorRole || '—'}</div></td>
                <td><code className="text-[11px] text-teal-300 bg-teal-500/5 px-1.5 py-0.5 rounded">{r.action}</code></td>
                <td><div className="text-xs text-ink-300">{r.entityType}</div><div className="text-[10px] text-ink-600 font-mono">{r.entityId || '—'}</div></td>
                <td><span className="text-xs text-ink-500 font-mono">{r.communityId || '—'}</span></td>
                <td><Badge tone={r.success ? 'success' : 'danger'}>{r.success ? 'Success' : 'Failure'}</Badge></td>
                <td><span className="text-[10px] font-mono text-ink-500">{r.requestId || '—'}</span></td>
                <td><span className="text-xs text-ink-400 leading-relaxed">{r.description}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && <div className="flex flex-col sm:flex-row gap-2 items-center justify-between text-xs text-ink-500"><span>Page {pagination.page} of {pagination.pageCount} · {pagination.total.toLocaleString()} events</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => { setPage(page - 1); setSearchParams((p) => ({ ...Object.fromEntries(p), page: String(page - 1) })) }} className="btn-ghost text-xs disabled:opacity-30">Previous</button><button disabled={page >= pagination.pageCount} onClick={() => { setPage(page + 1); setSearchParams((p) => ({ ...Object.fromEntries(p), page: String(page + 1) })) }} className="btn-ghost text-xs disabled:opacity-30">Next</button></div></div>}
    </div>
  )
}
