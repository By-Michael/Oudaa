import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, X, Building2, Users, LifeBuoy, ScrollText, CreditCard, FolderKanban, UserCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import { useDebouncedValue } from './useDebouncedValue'

const CATEGORY_META = {
  communities: { label: 'Communities', icon: Building2 },
  users: { label: 'Users', icon: Users },
  community_admin: { label: 'Community Admins', icon: Users },
  admins: { label: 'Platform Admins', icon: UserCircle },
  support_tickets: { label: 'Support Tickets', icon: LifeBuoy },
  residents: { label: 'Residents', icon: UserCircle },
  support: { label: 'Support', icon: LifeBuoy },
  audit: { label: 'Audit', icon: ScrollText },
  payments: { label: 'Payments', icon: CreditCard },
  projects: { label: 'Projects', icon: FolderKanban },
}

/**
 * Backend-driven global search (Ctrl+K). Every keystroke (debounced) hits
 * GET /api/platform/v1/search?q=... — no client-side filtering of a bulk
 * dataset, per Phase 2's explicit requirement. Results arrive already
 * grouped by category and already filtered to what this operator's role
 * is permitted to see (see platformSearchService.js); this component just
 * renders whatever groups come back.
 */
export default function PlatformGlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 200)
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      setQuery('')
      setGroups([])
      setError('')
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  useEffect(() => {
    if (!open || debounced.trim().length < 2) {
      setGroups([])
      return
    }
    setLoading(true)
    setError('')
    platformApi
      .get(platformEndpoints.search(), { params: { q: debounced } })
      .then(({ data }) => setGroups(data.data.groups || []))
      .catch((err) => setError(err.response?.data?.message || 'Search failed'))
      .finally(() => setLoading(false))
  }, [debounced, open])

  const handleSelect = useCallback(
    (link) => {
      onClose()
      navigate(link)
    },
    [navigate, onClose]
  )

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl2 border border-ink-700 bg-ink-800 shadow-card overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-700">
          <Search className="w-4 h-4 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search communities, users, admins, tickets, audit, payments…"
            className="flex-1 bg-transparent text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none"
          />
          <button onClick={onClose} className="text-ink-500 hover:text-ink-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading && <div className="px-4 py-6 text-sm text-ink-400 text-center">Searching…</div>}
          {error && <div className="px-4 py-6 text-sm text-red-400 text-center">{error}</div>}
          {!loading && !error && query.trim().length >= 2 && groups.length === 0 && (
            <div className="px-4 py-6 text-sm text-ink-400 text-center">No results for "{query}"</div>
          )}
          {!loading && query.trim().length > 0 && query.trim().length < 2 && (
            <div className="px-4 py-6 text-sm text-ink-500 text-center">Keep typing to search…</div>
          )}
          {!loading &&
            groups.map((group) => {
              const meta = CATEGORY_META[group.category] || { label: group.category, icon: Search }
              const Icon = meta.icon
              return (
                <div key={group.category} className="py-2">
                  <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    {meta.label}
                  </div>
                  {group.results.map((r) => (
                    <button
                      key={`${r.type}-${r.id}`}
                      onClick={() => handleSelect(r.link)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-ink-700/60 transition"
                    >
                      <Icon className="w-4 h-4 text-ink-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-ink-100 truncate">{r.title}</div>
                        <div className="text-xs text-ink-500 truncate">{r.subtitle}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            })}
        </div>

        <div className="px-4 py-2 border-t border-ink-700 text-[11px] text-ink-500 flex items-center justify-between">
          <span>Backend-driven — results respect your permissions</span>
          <span className="hidden sm:inline">Esc to close</span>
        </div>
      </div>
    </div>
  )
}
