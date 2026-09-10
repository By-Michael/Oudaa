import { useMemo, useState } from 'react'
import { Calendar, ChevronRight, Landmark, Paperclip, Ban, FolderKanban, Search } from 'lucide-react'
import { useData } from '../../context/DataContext'
import { PageHeader, Modal, Badge, currency, formatDate, usePagedList, Pager, useDebouncedValue, EmptyState } from '../../components/ui'

const EXPENSE_CATEGORY_LABEL = {
  SECURITY: 'Security', WATER: 'Water', CLEANING: 'Cleaning', MAINTENANCE: 'Maintenance',
  IMPROVEMENT: 'Improvement', ADMIN: 'Admin', OTHER: 'Other',
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'planned', label: 'Planned' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function ResidentProjects() {
  const { projects, funds, expenses, receipts } = useData()
  const [detail, setDetail] = useState(null)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 200)
  const [statusFilter, setStatusFilter] = useState('all')

  const fundOf = (id) => funds.find((f) => f.id === id)
  const receiptOf = (id) => receipts.find((r) => r.id === id)

  const filteredProjects = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    return projects.filter((p) => {
      const matchesQuery = !q || [p.name, p.description, ...(p.fundAllocations || []).map((a) => a.fundName)]
        .join(' ').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [projects, debouncedQuery, statusFilter])

  const detailExpenses = detail ? expenses.filter((e) => e.projectId === detail.id) : []
  const detailPct = detail?.budget ? Math.min(100, Math.round((detail.spent / detail.budget) * 100)) : 0
  const detailRemaining = detail ? detail.budget - detail.spent : 0
  const { pageItems: pagedProjects, page, totalPages, total, setPage } = usePagedList(filteredProjects, 20)

  return (
    <div>
      <PageHeader title="Community Projects" subtitle="See exactly where fund money is being invested. Tap a project for the full breakdown." />
      {projects.length > 0 && (
        <div className="card p-4 mb-5 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" className="input pl-10" />
          </div>
          <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {pagedProjects.map((p) => {
          const pct = p.budget ? Math.min(100, Math.round((p.spent / p.budget) * 100)) : 0
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setDetail(p)}
              className="card p-5 text-left transition hover:border-brand-200 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-800 truncate">{p.name}</p>
                  <p className="text-xs text-ink-400 mt-0.5">{fundOf(p.fundId)?.name || '—'}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge status={p.status} />
                  <ChevronRight className="h-4 w-4 text-ink-300" />
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs text-ink-500 mb-1.5">
                  <span>{currency(p.spent)} spent</span>
                  <span>{currency(p.budget)} budget</span>
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div className={`h-full rounded-full ${pct >= 95 ? 'bg-rose-500' : 'bg-brand-gradient'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2 text-xs text-ink-400">
                <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {formatDate(p.startDate)} — {formatDate(p.endDate)}</span>
                {p.expenseCount > 0 && <span>{p.expenseCount} expense{p.expenseCount === 1 ? '' : 's'}</span>}
              </div>
            </button>
          )
        })}
        {projects.length === 0 ? (
          <div className="card sm:col-span-2"><EmptyState icon={FolderKanban} title="No projects yet" subtitle="Your committee hasn't logged any projects yet — check back soon." /></div>
        ) : filteredProjects.length === 0 && (
          <div className="card sm:col-span-2"><EmptyState icon={Search} title="No projects match your search" subtitle="Try a different search term or clear the filters." /></div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="card mt-4 !p-0">
          <Pager page={page} totalPages={totalPages} total={total} onChange={setPage} pageSize={20} />
        </div>
      )}

      {/* ---------------- Project detail ---------------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name || 'Project'} wide>
        {detail && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  <FolderKanban className="h-4.5 w-4.5 text-brand-600" />
                </div>
                <div>
                  <p className="font-semibold text-ink-800">{detail.name}</p>
                  <p className="text-xs text-ink-400">{formatDate(detail.startDate)} — {formatDate(detail.endDate)}</p>
                </div>
              </div>
              <Badge status={detail.status} />
            </div>

            {detail.description && (
              <p className="text-sm text-ink-600 leading-relaxed border-t border-ink-100 pt-4">{detail.description}</p>
            )}

            {detail.status === 'cancelled' && detail.cancelReason && (
              <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-700 flex gap-2 items-start">
                <Ban className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Project cancelled</p>
                  <p className="text-rose-600/90 mt-0.5">{detail.cancelReason}</p>
                </div>
              </div>
            )}

            {/* Budget */}
            <div className="border-t border-ink-100 pt-4">
              <p className="text-xs uppercase font-semibold text-ink-400 mb-2">Budget</p>
              <div className="grid grid-cols-3 gap-3 text-sm mb-2.5">
                <div><p className="text-ink-400 text-xs">Budget</p><p className="text-ink-800 font-semibold">{currency(detail.budget)}</p></div>
                <div><p className="text-ink-400 text-xs">Spent</p><p className="text-ink-800 font-semibold">{currency(detail.spent)}</p></div>
                <div><p className="text-ink-400 text-xs">Remaining</p><p className={`font-semibold ${detailRemaining < 0 ? 'text-rose-500' : 'text-ink-800'}`}>{currency(detailRemaining)}</p></div>
              </div>
              <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                <div className={`h-full rounded-full ${detailPct >= 95 ? 'bg-rose-500' : 'bg-brand-gradient'}`} style={{ width: `${detailPct}%` }} />
              </div>
              <p className="text-xs text-ink-400 mt-1.5">{detailPct}% of budget used</p>
            </div>

            {/* Funding source(s) */}
            <div className="border-t border-ink-100 pt-4">
              <p className="text-xs uppercase font-semibold text-ink-400 mb-2 flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> Funded from</p>
              {detail.fundAllocations?.length > 1 ? (
                <div className="space-y-1.5">
                  {detail.fundAllocations.map((a) => (
                    <div key={a.fundId} className="flex items-center justify-between text-sm rounded-xl bg-ink-50/70 px-3.5 py-2.5">
                      <span className="text-ink-700">{a.fundName || fundOf(a.fundId)?.name || '—'}</span>
                      <span className="font-semibold text-ink-800">{currency(a.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-700">{fundOf(detail.fundId)?.name || '—'}</p>
              )}
            </div>

            {/* Linked expenses */}
            <div className="border-t border-ink-100 pt-4">
              <p className="text-xs uppercase font-semibold text-ink-400 mb-2">
                Expenses logged against this project {detailExpenses.length > 0 && `(${detailExpenses.length})`}
              </p>
              {detailExpenses.length === 0 ? (
                <p className="text-sm text-ink-400">No expenses logged yet.</p>
              ) : (
                <div className="rounded-xl border border-ink-100 overflow-hidden">
                  <div className="max-h-64 overflow-y-auto divide-y divide-ink-50">
                    {detailExpenses.map((e) => {
                      const r = receiptOf(e.receiptId)
                      return (
                        <div key={e.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink-800 truncate">{e.description}</p>
                            <p className="text-xs text-ink-400">
                              {EXPENSE_CATEGORY_LABEL[e.category] || e.category} · {e.vendor || 'No vendor'} · {formatDate(e.date)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {r && <Paperclip className="h-3.5 w-3.5 text-brand-500" title="Has a receipt" />}
                            <span className="text-sm font-semibold text-ink-800">{currency(e.amount)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
