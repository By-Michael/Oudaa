import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
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

// ─── helpers ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const cls =
    role === 'ADMIN'
      ? 'bg-teal-500/15 text-teal-400 border-teal-500/30'
      : 'bg-ink-700/60 text-ink-400 border-ink-600'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {role}
    </span>
  )
}

function ResidentBadge({ status }) {
  if (!status) return <span className="text-ink-600 text-xs">—</span>
  const cls =
    status === 'ACTIVE'
      ? 'text-emerald-400'
      : status === 'INACTIVE'
      ? 'text-ink-500'
      : 'text-amber-400'
  return <span className={`text-xs font-medium ${cls}`}>{status}</span>
}

function SortIcon({ field, sortBy, sortDir }) {
  if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-ink-600" />
  return sortDir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5 text-teal-400" />
    : <ChevronDown className="w-3.5 h-3.5 text-teal-400" />
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

// ─── columns ─────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'fullName',     label: 'Name',          sortable: true },
  { key: 'email',        label: 'Email',          sortable: true },
  { key: 'role',         label: 'Role',           sortable: true },
  { key: 'community',    label: 'Community',      sortable: false },
  { key: 'residentStatus', label: 'Resident',     sortable: false },
  { key: 'createdAt',    label: 'Created',        sortable: true },
  { key: 'lastActivity', label: 'Last Activity',  sortable: false },
]

const PAGE_SIZE = 25

// ─── main component ───────────────────────────────────────────────────────────

export default function PlatformUsers() {
  const navigate = useNavigate()

  // Filters
  const [search, setSearch]               = useState('')
  const [debouncedSearch, setDebounced]   = useState('')
  const [communityFilter, setCommunity]   = useState('all')
  const [roleFilter, setRole]             = useState('all')
  const [residentStatusFilter, setResSt]  = useState('all')
  const [sortBy, setSortBy]               = useState('createdAt')
  const [sortDir, setSortDir]             = useState('desc')
  const [page, setPage]                   = useState(1)

  // Data
  const [users, setUsers]           = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [debouncedSearch, communityFilter, roleFilter, residentStatusFilter, sortBy, sortDir])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortDir,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(communityFilter !== 'all' && { communityId: communityFilter }),
        ...(roleFilter !== 'all' && { role: roleFilter }),
        ...(residentStatusFilter !== 'all' && { residentStatus: residentStatusFilter }),
      })
      const { data } = await platformApi.get(`${platformEndpoints.users()}?${params}`)
      setUsers(data.data)
      setPagination(data.pagination)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, sortDir, debouncedSearch, communityFilter, roleFilter, residentStatusFilter])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  function handleSort(field) {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(field); setSortDir('asc') }
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-teal-400" />
          Global Users
        </h1>
        <p className="text-sm text-ink-400 mt-0.5">
          {pagination ? `${pagination.total.toLocaleString()} users across all communities` : 'Loading…'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
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

        {/* Role */}
        <select
          value={roleFilter}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="all">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="RESIDENT">Resident</option>
        </select>

        {/* Resident status */}
        <select
          value={residentStatusFilter}
          onChange={(e) => setResSt(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="all">All resident statuses</option>
          <option value="ACTIVE">Active residents</option>
          <option value="INACTIVE">Inactive residents</option>
          <option value="PENDING">Pending approval</option>
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
                  onClick={() => col.sortable && handleSort(col.key)}
                  className={`px-4 py-3 text-left text-xs font-medium text-ink-400 uppercase tracking-wide ${col.sortable ? 'cursor-pointer hover:text-ink-200 select-none' : ''}`}
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
                  Loading users…
                </td>
              </tr>
            )}

            {/* Empty */}
            {!loading && !error && users.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-16 text-center text-ink-500">
                  <Users className="w-8 h-8 mx-auto mb-2 text-ink-700" />
                  No users found
                </td>
              </tr>
            )}

            {/* Rows */}
            {!loading && users.map((u) => (
              <tr key={u.id} className="border-b border-ink-800 hover:bg-ink-800/40 transition-colors">
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/platform-admin/users/${u.id}`)}
                    className="font-medium text-white hover:text-teal-400 transition-colors text-left"
                  >
                    {u.fullName}
                  </button>
                </td>
                <td className="px-4 py-3 text-ink-400 text-xs">{u.email}</td>
                <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3">
                  {u.community ? (
                    <button
                      onClick={() => navigate(`/platform-admin/communities/${u.community.id}`)}
                      className="text-xs text-ink-300 hover:text-teal-400 transition-colors"
                    >
                      {u.community.name}
                    </button>
                  ) : <span className="text-ink-600 text-xs">—</span>}
                </td>
                <td className="px-4 py-3"><ResidentBadge status={u.residentProfile?.status} /></td>
                <td className="px-4 py-3 text-ink-500 text-xs whitespace-nowrap">{fmt(u.createdAt)}</td>
                <td className="px-4 py-3 text-ink-500 text-xs whitespace-nowrap">{fmt(u.lastActivity)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/platform-admin/users/${u.id}`)}
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
