import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { SECURITY_EVENT_CATEGORIES, actionLabel, actionSeverity, severityBadgeClass, fmtDateTime } from '../lib/securityDisplay'

export default function PlatformSecurityEvents() {
  const [categories, setCategories] = useState([])
  const [page, setPage] = useState(1)
  const [events, setEvents] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function toggleCategory(value) {
    setPage(1)
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    platformApi
      .get(platformEndpoints.securityEvents(), { params: { category: categories.length ? categories : undefined, page, pageSize: 50 } })
      .then(({ data }) => { if (!cancelled) { setEvents(data.data); setPagination(data.pagination) } })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.message || 'Failed to load security events') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [categories, page])

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <Link to="/platform-admin/security" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200 mb-2">
          <ArrowLeft className="w-4 h-4" /> Security Center
        </Link>
        <h1 className="text-xl font-display font-semibold text-white">Security events</h1>
        <p className="text-sm text-ink-400 mt-1">Filterable feed of authentication, privilege, and configuration events.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SECURITY_EVENT_CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => toggleCategory(c.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              categories.includes(c.value)
                ? 'bg-teal-600/20 border-teal-500/50 text-teal-300'
                : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200'
            }`}
          >
            {c.label}
          </button>
        ))}
        {categories.length > 0 && (
          <button onClick={() => setCategories([])} className="px-3 py-1.5 rounded-full text-xs text-ink-500 hover:text-ink-300">
            Clear filters
          </button>
        )}
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
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Event</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Actor</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Severity</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">IP</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-ink-400 uppercase tracking-wide">When</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-16 text-center text-ink-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            )}
            {!loading && events.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-16 text-center text-ink-500">No matching events</td></tr>
            )}
            {!loading && events.map((e) => (
              <tr key={e.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/40">
                <td className="px-4 py-2.5">
                  <div className="text-ink-200">{actionLabel(e.action)}</div>
                  <div className="text-xs text-ink-500">{e.description}</div>
                </td>
                <td className="px-4 py-2.5 text-ink-400 text-xs">{e.actorEmail || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={severityBadgeClass(actionSeverity(e.action, e.success))}>
                    {actionSeverity(e.action, e.success)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-500 text-xs">{e.ipAddress || '—'}</td>
                <td className="px-4 py-2.5 text-ink-500 text-xs text-right whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-400">
          <span>Page {pagination.page} of {pagination.pageCount} — {pagination.total.toLocaleString()} total</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page === 1} className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30 transition">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage((p) => Math.min(pagination.pageCount, p + 1))} disabled={pagination.page === pagination.pageCount} className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30 transition">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
