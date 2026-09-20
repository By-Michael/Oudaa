import { useMemo, useState } from 'react'
import { Plus, Pencil, FolderKanban, Calendar, Ban, X, Search } from 'lucide-react'
import { useData } from '../../context/DataContext'
import { PageHeader, Modal, Badge, currency, formatDate, EmptyState, notify, useDebouncedValue } from '../../components/ui'

const empty = { name: '', description: '', fundId: '', budget: '', status: 'planned', startDate: '', endDate: '' }

const STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'planned', label: 'Planned' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function Projects() {
  const { projects, funds, addProject, updateProject, cancelProject } = useData()
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  // Multi-fund split, editable as its own list separate from `form` so the
  // "single fund" case (the vast majority) never has to think about it —
  // it defaults to one row that tracks form.fundId/budget automatically.
  const [splitFunds, setSplitFunds] = useState(false)
  // Each row is { fundId, amount, manual }. `manual: false` means the amount
  // is auto-split (equal share of whatever budget isn't claimed by manual
  // rows) and re-computed live; `manual: true` means the user typed a
  // specific amount for that fund and it's held fixed.
  const [allocations, setAllocations] = useState([])
  const [primaryManual, setPrimaryManual] = useState(false)
  const [primaryManualAmount, setPrimaryManualAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // ---- Filters: quick search + status + fund ----
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 200)
  const [statusFilter, setStatusFilter] = useState('all')
  const [fundFilter, setFundFilter] = useState('all')
  const activeFilterCount = (statusFilter !== 'all' ? 1 : 0) + (fundFilter !== 'all' ? 1 : 0) + (query.trim() ? 1 : 0)

  function clearFilters() {
    setQuery('')
    setStatusFilter('all')
    setFundFilter('all')
  }

  const fundOf = (id) => funds.find((f) => f.id === id)?.name || '—'

  const filteredProjects = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    return projects.filter((p) => {
      const matchesQuery = !q || [p.name, p.description, ...(p.fundAllocations || []).map((a) => a.fundName)]
        .join(' ').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter
      const matchesFund = fundFilter === 'all' ||
        (p.fundAllocations || []).some((a) => a.fundId === fundFilter) ||
        p.fundId === fundFilter
      return matchesQuery && matchesStatus && matchesFund
    })
  }, [projects, debouncedQuery, statusFilter, fundFilter])

  function openAdd() {
    setEditing(null); setForm(empty); setSplitFunds(false); setAllocations([])
    setPrimaryManual(false); setPrimaryManualAmount('')
    setModal(true)
  }
  function openEdit(p) {
    setEditing(p); setForm(p)
    const multi = (p.fundAllocations || []).length > 1
    setSplitFunds(multi)
    if (multi) {
      // fundAllocations from the API includes the primary fund's row too —
      // pull it out so it doesn't get rendered twice (once as "primary",
      // once as an editable row), and treat every saved amount as manual
      // since it was explicitly chosen when the project was last saved.
      const primaryRow = p.fundAllocations.find((a) => a.fundId === p.fundId)
      setPrimaryManual(true)
      setPrimaryManualAmount(primaryRow ? String(primaryRow.amount) : '')
      setAllocations(
        p.fundAllocations
          .filter((a) => a.fundId !== p.fundId)
          .map((a) => ({ fundId: a.fundId, amount: String(a.amount), manual: true })),
      )
    } else {
      setPrimaryManual(false); setPrimaryManualAmount('')
      setAllocations([])
    }
    setModal(true)
  }

  function openCancel(p) { setCancelTarget(p); setCancelReason('') }

  function confirmCancel(e) {
    e.preventDefault()
    if (!cancelTarget || !cancelReason.trim()) return
    setCancelling(true)
    cancelProject(cancelTarget.id, cancelReason.trim())
      .then((result) => {
        setCancelTarget(null)
        notify(result.message, result.pendingChange ? 'info' : 'success')
      })
      .catch((err) => notify(err?.response?.data?.message || err.message))
      .finally(() => setCancelling(false))
  }

  function addAllocationRow() {
    const used = new Set([form.fundId, ...allocations.map((a) => a.fundId)])
    const next = funds.find((f) => !used.has(f.id))
    // New rows start in "auto" mode — no amount typed, split evenly with
    // the other auto rows out of whatever budget the manual rows leave over.
    setAllocations([...allocations, { fundId: next?.id || '', amount: '', manual: false }])
  }
  function updateAllocationRow(i, patch) {
    setAllocations(allocations.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }
  function removeAllocationRow(i) {
    setAllocations(allocations.filter((_, idx) => idx !== i))
  }
  function setRowManualAmount(i, value) {
    updateAllocationRow(i, { amount: value, manual: true })
  }
  function resetRowToAuto(i) {
    updateAllocationRow(i, { amount: '', manual: false })
  }

  // ---- Auto-split math ----
  // Manually-set rows (primary or additional) keep whatever amount the user
  // typed. Every "auto" row splits the remaining budget evenly between them,
  // recalculating live as other amounts or the total budget change.
  const totalBudget = Number(form.budget || 0)
  const manualSum = (primaryManual ? Number(primaryManualAmount || 0) : 0)
    + allocations.reduce((s, a) => s + (a.manual ? Number(a.amount || 0) : 0), 0)
  const autoRowCount = (primaryManual ? 0 : 1) + allocations.filter((a) => !a.manual).length
  const autoShare = autoRowCount > 0 ? Math.max(0, totalBudget - manualSum) / autoRowCount : 0

  const primaryAmount = splitFunds
    ? (primaryManual ? Number(primaryManualAmount || 0) : autoShare)
    : totalBudget
  const allocationAmounts = allocations.map((a) => (a.manual ? Number(a.amount || 0) : autoShare))
  const allocationTotal = primaryAmount + allocationAmounts.reduce((s, v) => s + v, 0)
  const allocationMismatch = splitFunds && Math.abs(allocationTotal - totalBudget) > 0.01

  function submit(e) {
    e.preventDefault()
    if (allocationMismatch) {
      notify('Fund allocations must add up to the total budget.')
      return
    }
    setSaving(true)
    const fundAllocations = splitFunds
      ? [
        { fundId: form.fundId, amount: primaryAmount },
        ...allocations
          .map((a, i) => ({ fundId: a.fundId, amount: allocationAmounts[i] }))
          .filter((a) => a.fundId),
      ]
      : undefined
    const payload = { ...form, budget: Number(form.budget), fundAllocations }
    const wasEditing = !!editing
    const action = wasEditing ? updateProject(editing.id, payload) : addProject(payload)
    action
      .then((result) => {
        setModal(false)
        // Budget/fund-split changes on a project that already has expenses
        // logged go through committee approval rather than applying
        // instantly — tell the admin which happened instead of a blanket
        // "updated".
        if (wasEditing && result?.budgetChangeMessage) {
          notify(result.budgetChangeMessage, result.pendingChange ? 'info' : 'success')
        } else {
          notify(wasEditing ? 'Project updated.' : 'Project added.', 'success')
        }
      })
      .catch((err) => notify(err?.response?.data?.message || err.message))
      .finally(() => setSaving(false))
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${filteredProjects.length} of ${projects.length} projects · ${projects.filter((p) => p.status === 'in-progress').length} in progress`}
        action={<button onClick={openAdd} className="btn-primary"><Plus className="h-4 w-4" /> New project</button>}
      />

      {projects.length > 0 && (
        <div className="card p-4 mb-5 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" className="input pl-10" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className="input !w-auto" value={fundFilter} onChange={(e) => setFundFilter(e.target.value)}>
              <option value="all">Any fund</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="text-xs text-ink-400 hover:text-rose-500 underline underline-offset-2">
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="card"><EmptyState icon={FolderKanban} title="No projects yet" subtitle="Create a project to start tracking budget and spend." action={<button onClick={openAdd} className="btn-primary"><Plus className="h-4 w-4" /> New project</button>} /></div>
      ) : filteredProjects.length === 0 ? (
        <div className="card"><EmptyState icon={FolderKanban} title="No projects match your filters" subtitle="Try a different search term or clear the filters." action={<button onClick={clearFilters} className="btn-secondary">Clear filters</button>} /></div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filteredProjects.map((p) => {
            const pct = p.budget ? Math.min(100, Math.round((p.spent / p.budget) * 100)) : 0
            const cancelled = p.status === 'cancelled'
            return (
              <div key={p.id} className="card p-5 hover:shadow-glow transition-shadow group">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-ink-800">{p.name}</p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {p.fundAllocations.length > 1
                        ? `${p.fundAllocations.length} funds: ${p.fundAllocations.map((a) => a.fundName).join(', ')}`
                        : fundOf(p.fundId)}
                    </p>
                  </div>
                  {!cancelled && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-ink-400 hover:bg-brand-50 hover:text-brand-600"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openCancel(p)} title="Cancel project" className="p-1.5 rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-500"><Ban className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
                <div className="mt-3"><Badge status={p.status} /></div>
                {cancelled && p.cancelReason && (
                  <p className="mt-2 text-xs text-rose-500">Cancelled: {p.cancelReason}</p>
                )}
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-ink-500 mb-1.5">
                    <span>{currency(p.spent)} spent</span>
                    <span>{currency(p.budget)} budget</span>
                  </div>
                  <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 95 ? 'bg-rose-500' : 'bg-brand-gradient'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs font-semibold text-ink-500">{pct}% utilized</p>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs text-ink-400">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(p.startDate)} — {formatDate(p.endDate)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit project' : 'New project'} wide>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Project name</label>
            <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Primary fund</label>
              <select required className="input" value={form.fundId} onChange={(e) => setForm({ ...form, fundId: e.target.value })}>
                <option value="">Select fund</option>
                {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="planned">Planned</option>
                <option value="in-progress">In progress</option>
                {/* Completed is only offered once a project exists — a brand
                    new project can't be created as already-finished, it has
                    to be moved to Completed from the edit form later.
                    Cancelled isn't offered here at all — cancellation always
                    goes through the dedicated flow (reason + committee
                    approval), never a plain status dropdown. */}
                {editing && <option value="completed">Completed</option>}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Budget (ETB)</label>
            <input required type="number" min="0" className="input" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
          </div>
          <p className="text-xs text-ink-400 -mt-1">
            Amount spent isn't set manually — it's calculated automatically from expenses logged against this project.
          </p>
          {editing && editing.expenseCount > 0 && (
            <p className="text-xs text-amber-600 -mt-1">
              This project already has expenses logged against it, so changing the budget will need every other committee member to approve before it takes effect.
            </p>
          )}

          <div className="rounded-xl border border-ink-100 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
              <input
                type="checkbox"
                checked={splitFunds}
                disabled={!!(editing && editing.expenseCount > 0)}
                onChange={(e) => {
                  setSplitFunds(e.target.checked)
                  if (!e.target.checked) { setAllocations([]); setPrimaryManual(false); setPrimaryManualAmount('') }
                }}
              />
              Fund this project from multiple fund accounts
            </label>
            {editing && editing.expenseCount > 0 && (
              <p className="text-xs text-ink-400 mt-1">Fund split can't be changed once expenses are logged against this project.</p>
            )}
            {splitFunds && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-ink-400">
                  Amounts are split evenly across funds automatically — click into any amount to set it manually, or "Auto" to hand it back.
                </p>
                <div className="flex gap-2 items-center">
                  <div className="input flex-1 bg-ink-50 text-ink-600 flex items-center">{fundOf(form.fundId) || 'Primary fund'}</div>
                  <input
                    type="number" min="0" className="input w-32" placeholder="Auto"
                    value={primaryManual ? primaryManualAmount : Math.round(primaryAmount)}
                    onChange={(e) => { setPrimaryManual(true); setPrimaryManualAmount(e.target.value) }}
                  />
                  {primaryManual ? (
                    <button
                      type="button"
                      onClick={() => { setPrimaryManual(false); setPrimaryManualAmount('') }}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0 w-14 text-center"
                    >
                      Auto
                    </button>
                  ) : <span className="w-14" />}
                </div>
                {allocations.map((a, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select
                      className="input flex-1"
                      value={a.fundId}
                      onChange={(e) => updateAllocationRow(i, { fundId: e.target.value })}
                    >
                      <option value="">Select fund</option>
                      {funds.filter((f) => f.id !== form.fundId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <input
                      type="number" min="0" className="input w-32" placeholder="Auto"
                      value={a.manual ? a.amount : Math.round(allocationAmounts[i])}
                      onChange={(e) => setRowManualAmount(i, e.target.value)}
                    />
                    {a.manual ? (
                      <button type="button" onClick={() => resetRowToAuto(i)} className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0 w-14 text-center">Auto</button>
                    ) : <span className="w-14" />}
                    <button type="button" onClick={() => removeAllocationRow(i)} className="p-1.5 text-ink-400 hover:text-rose-500"><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={addAllocationRow} className="text-xs font-medium text-brand-600 hover:text-brand-700">+ Add another fund</button>
                <p className={`text-xs ${allocationMismatch ? 'text-rose-500' : 'text-ink-400'}`}>
                  Total allocated: {currency(allocationTotal)} of {currency(totalBudget)} budget
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start date</label>
              <input required type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className="label">End date</label>
              <input required type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setModal(false)} disabled={saving} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving || allocationMismatch} className="btn-primary flex-1">{saving ? 'Saving…' : (editing ? 'Save changes' : 'Create project')}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel project">
        <form onSubmit={confirmCancel} className="space-y-4">
          <p className="text-sm text-ink-500">
            {cancelTarget ? `Cancelling "${cancelTarget.name}" requires a reason and needs every other committee member to approve before it takes effect. This can't be undone.` : ''}
          </p>
          <div>
            <label className="label">Reason for cancellation</label>
            <textarea
              required
              minLength={3}
              rows={3}
              className="input"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this project being cancelled?"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setCancelTarget(null)} disabled={cancelling} className="btn-secondary flex-1">Back</button>
            <button type="submit" disabled={cancelling || !cancelReason.trim()} className="btn-primary flex-1 bg-rose-500 hover:bg-rose-600">
              {cancelling ? 'Submitting…' : 'Submit for committee approval'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
