import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LifeBuoy, Search, AlertTriangle, Loader2, Bot } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'

const PAGE_SIZE = 25

const SECTIONS = [
  { key: 'all', label: 'All tickets' },
  { key: 'open', label: 'Open' },
  { key: 'assigned_to_me', label: 'Assigned to me' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'high_priority', label: 'High priority' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'waiting_for_user', label: 'Waiting for user' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
]

const PRIORITY_BADGE = {
  LOW: 'bg-ink-700 text-ink-400 border-ink-600',
  NORMAL: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  HIGH: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  URGENT: 'bg-red-500/15 text-red-400 border-red-500/30',
}
const STATUS_BADGE = {
  OPEN: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  IN_PROGRESS: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  WAITING_FOR_USER: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ESCALATED: 'bg-red-500/15 text-red-400 border-red-500/30',
  RESOLVED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CLOSED: 'bg-ink-700 text-ink-400 border-ink-600',
}

function Badge({ value, map }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[value] ?? 'bg-ink-700 text-ink-400 border-ink-600'}`}>
      {value?.replace(/_/g, ' ')}
    </span>
  )
}

function formatRelative(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function PlatformSupportInbox() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userIdFilter = searchParams.get('userId') || ''
  const [section, setSection] = useState('open')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [priority, setPriority] = useState('all')
  const [page, setPage] = useState(1)
  const [tickets, setTickets] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [section, debouncedSearch, category, priority])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        section,
        page,
        pageSize: PAGE_SIZE,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(userIdFilter && { userId: userIdFilter }),
        ...(category !== 'all' && { category }),
        ...(priority !== 'all' && { priority }),
      })
      const { data } = await platformApi.get(`${platformEndpoints.supportTickets()}?${params}`)
      setTickets(data.data)
      setPagination(data.pagination)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [section, page, debouncedSearch, category, priority, userIdFilter])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-teal-400" />
            Support Inbox
          </h1>
          <p className="text-sm text-ink-400 mt-0.5">{pagination ? `${pagination.total.toLocaleString()} tickets` : 'Loading…'}{userIdFilter && ' · filtered to selected user'}</p>
        </div>
        <button
          onClick={() => navigate('/platform-admin/support/ai')}
          className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-1.5 text-sm text-ink-300 hover:text-white hover:border-ink-600 transition"
        >
          <Bot className="w-4 h-4" />
          AI support
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-ink-700 pb-3">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              section === s.key ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30' : 'text-ink-400 hover:text-ink-200 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
          <input
            type="text"
            placeholder="Search subject, description, user…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-800/60 pl-9 pr-3 py-2 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
          <option value="all">All categories</option>
          {['ACCOUNT', 'PAYMENT', 'COMMUNITY', 'TECHNICAL', 'SECURITY', 'FINANCIAL', 'BUG', 'FEATURE_REQUEST', 'OTHER'].map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500">
          <option value="all">All priorities</option>
          {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-800/60">
              {['Subject', 'User', 'Community', 'Status', 'Priority', 'Assignee', 'Last activity'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-ink-500"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading tickets…</td></tr>
            )}
            {!loading && tickets.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-ink-500">No tickets in this view.</td></tr>
            )}
            {!loading && tickets.map((t) => (
              <tr
                key={t.id}
                onClick={() => navigate(`/platform-admin/support/${t.id}`)}
                className="border-b border-ink-800 hover:bg-ink-800/40 cursor-pointer transition"
              >
                <td className="px-4 py-3 text-ink-100 max-w-xs truncate">{t.subject}</td>
                <td className="px-4 py-3 text-ink-300">{t.user?.fullName}</td>
                <td className="px-4 py-3 text-ink-400">{t.community?.name || '—'}</td>
                <td className="px-4 py-3"><Badge value={t.status} map={STATUS_BADGE} /></td>
                <td className="px-4 py-3"><Badge value={t.priority} map={PRIORITY_BADGE} /></td>
                <td className="px-4 py-3 text-ink-400">{t.assignedTo?.fullName || 'Unassigned'}</td>
                <td className="px-4 py-3 text-ink-500 text-xs">{formatRelative(t.lastResponseAt || t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-400">
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-ink-700 px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-ink-700 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
