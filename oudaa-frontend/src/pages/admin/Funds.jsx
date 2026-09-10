import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Landmark, TrendingUp, Target, Users, Lock } from 'lucide-react'
import { useData } from '../../context/DataContext'
import { PageHeader, Modal, currency, currencyBalance, ConfirmDialog, notify, EmptyState } from '../../components/ui'
import { FUND_CATEGORIES } from '../../lib/adapters'

const empty = { name: '', category: 'Security', goal: '', reason: '' }
const catColors = {
  Security: 'from-brand-500 to-brand-600',
  Utilities: 'from-sky-400 to-sky-600',
  Maintenance: 'from-emerald-500 to-emerald-600',
  Development: 'from-violet-500 to-violet-600',
  Landscaping: 'from-lime-500 to-emerald-600',
  Sanitation: 'from-teal-400 to-teal-600',
  Emergency: 'from-rose-500 to-rose-600',
  Events: 'from-fuchsia-500 to-purple-600',
  Administration: 'from-slate-500 to-slate-600',
  Insurance: 'from-amber-500 to-orange-600',
  Other: 'from-ink-400 to-ink-600',
}

export default function Funds() {
  const { funds, projects, payments, residents, addFund, updateFund, removeFund } = useData()
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const total = funds.reduce((s, f) => s + f.actualBalance, 0)

  // Contributors are residents with a VERIFIED payment that actually counts
  // toward this fund: either a direct fund payment, or a payment toward one
  // of this fund's projects. Fee payments never count — fees are for
  // operating costs, not fund-linked projects (see Payment.fundId schema
  // comment on the backend).
  const enriched = useMemo(() => funds.map((f) => {
    const projectIdsInFund = new Set(projects.filter((p) => p.fundId === f.id).map((p) => p.id))
    const verifiedPayments = payments.filter((p) => p.status === 'paid' && (p.fundId === f.id || projectIdsInFund.has(p.projectId)))
    const collected = f.verifiedCollected // trust the backend total, not a client re-derivation
    const contributorIds = new Set(verifiedPayments.map((p) => p.residentId))
    const goal = f.goal || null
    // Mirror the server's deletion rule (fundController.js deleteFund) so
    // the button/lock icon reflects reality instead of letting the admin
    // hit a 403: deletable once the fund's real balance is exactly zero
    // AND nothing is still pending against it (direct or via a project) —
    // an unverified payment could still land money into it later.
    const projectIdsArr = Array.from(projectIdsInFund)
    const hasPending = payments.some((p) =>
      (p.status === 'pending' || p.status === 'pending_review') &&
      (p.fundId === f.id || projectIdsArr.includes(p.projectId))
    )
    const canDelete = f.actualBalance === 0 && !hasPending
    return {
      ...f,
      collected,
      contributors: contributorIds.size,
      nonContributors: Math.max(residents.length - contributorIds.size, 0),
      goal,
      pct: goal ? Math.min(100, Math.round((collected / goal) * 100)) : null,
      canDelete,
      deleteBlockedReason: f.actualBalance !== 0
        ? `Still holds a balance of ${currency(f.actualBalance)} — spend it down to zero first.`
        : hasPending
          ? "Has a pending payment awaiting verification — resolve it first."
          : '',
    }
  }), [funds, projects, payments, residents])

  function openAdd() { setEditing(null); setForm(empty); setModal(true) }
  function openEdit(f) { setEditing(f); setForm({ ...f, goal: f.goal ?? '', reason: f.reason || '' }); setModal(true) }

  function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    removeFund(deleteTarget.id)
      .then(() => { setDeleteTarget(null); notify('Fund deleted.', 'success') })
      .catch((err) => notify(err?.response?.data?.message || err.message))
      .finally(() => setDeleting(false))
  }

  function submit(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      name: form.name,
      category: form.category,
      reason: form.reason || undefined,
      goal: form.goal === '' ? null : Number(form.goal),
    }
    const wasEditing = !!editing
    const action = wasEditing ? updateFund(editing.id, payload) : addFund(payload)
    action.then(() => {
      setModal(false)
      notify(wasEditing ? 'Fund updated.' : 'Fund added.', 'success')
    }).catch((err) => notify(err?.response?.data?.message || err.message))
      .finally(() => setSaving(false))
  }

  return (
    <div>
      <PageHeader
        title="Community Funds"
        subtitle={`Total balance ${currency(total)} across ${funds.length} funds`}
        action={<button onClick={openAdd} className="btn-primary"><Plus className="h-4 w-4" /> Add fund</button>}
      />

      {enriched.length === 0 ? (
        <div className="card"><EmptyState icon={Landmark} title="No funds yet" subtitle="Create your first fund, like a Security Fund or Maintenance Fund, to start tracking contributions." action={<button onClick={openAdd} className="btn-primary"><Plus className="h-4 w-4" /> Add fund</button>} /></div>
      ) : (
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {enriched.map((f) => {
          const linkedProjects = projects.filter((p) => p.fundId === f.id)
          return (
            <div key={f.id} className="card p-5 group hover:shadow-glow transition-shadow relative overflow-hidden">
              <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${catColors[f.category] || catColors.Security} opacity-10`} />
              <div className="flex items-start justify-between relative">
                <div className={`h-11 w-11 rounded-2xl bg-gradient-to-br ${catColors[f.category] || catColors.Security} flex items-center justify-center shadow-glow`}>
                  <Landmark className="h-5 w-5 text-white" />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(f)} className="p-1.5 rounded-lg text-ink-400 hover:bg-brand-50 hover:text-brand-600"><Pencil className="h-3.5 w-3.5" /></button>
                  {!f.canDelete ? (
                    <span title={`Can't be deleted — ${f.deleteBlockedReason}`} className="p-1.5 rounded-lg text-ink-300 cursor-not-allowed">
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <button onClick={() => setDeleteTarget(f)} className="p-1.5 rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </div>
              <p className="mt-4 font-semibold text-ink-800">{f.name}</p>
              <span className="badge bg-ink-100 text-ink-600 mt-1">{f.category}</span>
              {f.reason && (
                <p className="mt-1.5 text-xs text-ink-400 line-clamp-2" title={f.reason}>{f.reason}</p>
              )}
              <p className="mt-4 text-2xl font-bold font-display text-ink-900">{currencyBalance(f.actualBalance, 'short')}</p>
              <p className="text-xs text-ink-400">Actually collected, minus spent</p>
              <p className="mt-1 text-xs text-ink-400">
                Budgeted: <span className="font-medium text-ink-500">{currency(f.budgetRemaining)}</span> remaining of {currency(f.budgetAllocated)}
              </p>

              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-ink-500">
                  <span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Collected</span>
                  <span className="font-semibold text-ink-800">{currency(f.collected)}</span>
                </div>
                {f.goal ? (
                  <>
                    <div className="flex items-center justify-between text-ink-500">
                      <span className="flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-brand-500" /> Goal</span>
                      <span className="font-semibold text-ink-800">{currency(f.goal)} ({f.pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                      <div className="h-full bg-brand-gradient" style={{ width: `${f.pct}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="text-ink-400 italic">No goal set — edit this fund to add one.</p>
                )}
                <div className="flex items-center justify-between text-ink-500">
                  <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-ink-400" /> Contributed</span>
                  <span className="font-semibold text-ink-800">{f.contributors} of {residents.length} residents</span>
                </div>
                <div className="flex items-center justify-between text-rose-500">
                  <span>Haven't contributed</span>
                  <span className="font-semibold">{f.nonContributors}</span>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-400">
                {linkedProjects.length} linked project{linkedProjects.length !== 1 ? 's' : ''}
              </div>
            </div>
          )
        })}
      </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit fund' : 'Add fund'} wide>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Fund name</label>
            <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Category</label>
            <select
              className="input"
              value={FUND_CATEGORIES.includes(form.category) ? form.category : 'Other'}
              onChange={(e) => setForm({ ...form, category: e.target.value === 'Other' ? '' : e.target.value })}
            >
              {FUND_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              <option value="Other">Other…</option>
            </select>
            {!FUND_CATEGORIES.includes(form.category) && (
              <input
                required autoFocus className="input mt-2" placeholder="Type a category name"
                value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            )}
          </div>
          <div>
            <label className="label">Reason <span className="text-ink-400 font-normal normal-case">(optional)</span></label>
            <textarea
              className="input" rows={2}
              placeholder="Anything specific behind setting up this fund — e.g. what prompted it, what it's earmarked for…"
              value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Collection goal (ETB, optional)</label>
            <input type="number" min="0" className="input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="e.g. 200000" />
          </div>
          <p className="text-xs text-ink-400 -mt-1">
            Balance isn't set manually. "Actually collected" is verified payments made directly to this fund plus verified payments to its projects, minus what's been spent. "Budgeted" is this fund's project budgets minus logged expenses — a planning figure, not real cash. Fee payments never count toward a fund's balance.
          </p>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setModal(false)} disabled={saving} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : (editing ? 'Save changes' : 'Add fund')}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete fund?"
        message={deleteTarget ? `This will permanently delete "${deleteTarget.name}". This action cannot be undone.` : ''}
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
