import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { usePlatformAuth } from '../context/PlatformAuthContext'
import { PLATFORM_PERMISSIONS, roleHasPermission } from '../lib/platformPermissions'

const STATUS_BADGE = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  SUSPENDED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[status] ?? 'bg-ink-700 text-ink-400 border-ink-600'}`}>
      {status}
    </span>
  )
}

function SortIcon({ field, sortBy, sortDir }) {
  if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-ink-600" />
  return sortDir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5 text-teal-400" />
    : <ChevronDown className="w-3.5 h-3.5 text-teal-400" />
}

function formatRelative(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
}

const COLUMNS = [
  { key: 'name', label: 'Community', sortable: true },
  { key: 'slug', label: 'Slug', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'residents', label: 'Residents', sortable: false },
  { key: 'admins', label: 'Admins', sortable: false },
  { key: 'payments', label: 'Payments', sortable: false },
  { key: 'projects', label: 'Projects', sortable: false },
  { key: 'lastActivity', label: 'Last Activity', sortable: false },
  { key: 'createdAt', label: 'Created', sortable: true },
]

export default function PlatformCommunities() {
  const navigate = useNavigate()
  const { admin } = usePlatformAuth()
  const canManage = roleHasPermission(admin?.role, PLATFORM_PERMISSIONS.COMMUNITIES_MANAGE)

  // Filter/sort/pagination state
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [activityFilter, setActivityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  // Data state
  const [communities, setCommunities] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1) }, [debouncedSearch, status, activityFilter, sortBy, sortDir])

  const fetchCommunities = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortDir,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(status !== 'all' && { status }),
        ...(activityFilter !== 'all' && { activityFilter }),
      })
      const { data } = await platformApi.get(`${platformEndpoints.communities()}?${params}`)
      setCommunities(data.data)
      setPagination(data.pagination)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load communities')
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, sortDir, debouncedSearch, status, activityFilter])

  useEffect(() => { fetchCommunities() }, [fetchCommunities])

  function handleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-teal-400" />
            Communities
          </h1>
          <p className="text-sm text-ink-400 mt-0.5">
            {pagination ? `${pagination.total.toLocaleString()} communities` : 'Loading…'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
          <input
            type="text"
            placeholder="Search name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-800/60 pl-9 pr-3 py-2 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        {/* Status */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>

        {/* Activity */}
        <select
          value={activityFilter}
          onChange={(e) => setActivityFilter(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="all">All activity</option>
          <option value="active_30d">Active (30d)</option>
          <option value="inactive_30d">Inactive (30d)</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-800/60">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide ${col.sortable ? 'cursor-pointer hover:text-ink-200 select-none' : ''}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && <SortIcon field={col.key} sortBy={sortBy} sortDir={sortDir} />}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Loading */}
            {loading && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-16 text-center text-ink-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading communities…
                </td>
              </tr>
            )}

            {/* Empty */}
            {!loading && !error && communities.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-16 text-center text-ink-500">
                  <Building2 className="w-8 h-8 mx-auto mb-2 text-ink-700" />
                  No communities found
                </td>
              </tr>
            )}

            {/* Rows */}
            {!loading && communities.map((c) => (
              <tr
                key={c.id}
                className="border-b border-ink-800 hover:bg-ink-800/40 transition-colors"
              >
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/platform-admin/communities/${c.id}`)}
                    className="font-medium text-white hover:text-teal-400 transition-colors text-left"
                  >
                    {c.name}
                  </button>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-400">{c.slug}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-ink-300">{c.residents.toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-300">{c.admins.toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-300">{c.payments.toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-300">{c.projects.toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-400 text-xs">{formatRelative(c.lastActivity)}</td>
                <td className="px-4 py-3 text-ink-400 text-xs">{formatDate(c.createdAt)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/platform-admin/communities/${c.id}`)}
                    className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    View →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-400">
          <span>
            Page {pagination.page} of {pagination.totalPages} — {pagination.total.toLocaleString()} total
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page === 1}
              className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              const pg = Math.max(1, Math.min(pagination.totalPages - 4, pagination.page - 2)) + i
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`px-3 py-1 rounded text-sm transition ${pg === pagination.page ? 'bg-teal-600 text-white' : 'hover:bg-ink-700 text-ink-300'}`}
                >
                  {pg}
                </button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page === pagination.totalPages}
              className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
