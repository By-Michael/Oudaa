import { useMemo, useState } from 'react'
import { Plus, Trash2, FileText, Paperclip, Eye, Download, Upload, CheckCircle2, CircleDashed } from 'lucide-react'
import { useData } from '../../context/DataContext'
import {
  PageHeader, Modal, EmptyState, currency, formatDate, ConfirmDialog, notify, usePagedList, Pager,
  FilterPopover, FilterGrid, FilterField, FilterTextInput, FilterSelectInput, FilterDateInput, CalendarDateInput,
} from '../../components/ui'
import { fileUrl, downloadFile } from '../../lib/api'

function inRange(dateStr, from, to) {
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (from && t < new Date(from).getTime()) return false
  if (to && t > new Date(to).getTime() + 86399999) return false
  return true
}

const empty = { targetType: 'project', projectId: '', fundId: '', reason: '', description: '', amount: '', vendor: '', date: '', bankName: '', transactionReference: '', file: null }

const EXPENSE_PAYMENT_OPTIONS = ['Telebirr', 'Commercial Bank of Ethiopia']

export default function Expenses() {
  const { expenses, projects, funds, receipts, addExpense, reverseExpense, addReceipt, updateReceipt, dataFullyLoaded } = useData()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(empty)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [uploadingFor, setUploadingFor] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ---- Filters: search + project/fund target + receipt status + date range ----
  const [query, setQuery] = useState('')
  const [targetFilter, setTargetFilter] = useState('all') // 'all' | 'project' | 'fund' | a specific project/fund id
  const [receiptFilter, setReceiptFilter] = useState('all') // 'all' | 'attached' | 'none'
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const activeFilterCount = [
    !!query.trim(), targetFilter !== 'all', receiptFilter !== 'all', !!(dateFrom || dateTo),
  ].filter(Boolean).length

  function clearFilters() {
    setQuery('')
    setTargetFilter('all')
    setReceiptFilter('all')
    setDateFrom('')
    setDateTo('')
  }

  const projectOf = (id) => projects.find((p) => p.id === id)?.name || '—'
  const fundOf = (id) => funds.find((f) => f.id === id)?.name || '—'
  const receiptOf = (id) => receipts.find((r) => r.id === id)

  async function submit(e) {
    e.preventDefault()
    if (form.targetType === 'fund' && !form.reason.trim()) {
      setError('A reason is required when deducting directly from a fund.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await addExpense({ ...form, amount: Number(form.amount) })
      setModal(false)
      setForm(empty)
      notify('Expense logged.', 'success')
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not log expense.')
    } finally {
      setSubmitting(false)
    }
  }

  async function attachReceipt(expenseId, file) {
    if (!file) return
    setUploadingFor(expenseId)
    try {
      await addReceipt({ expenseId, file })
      notify('Receipt uploaded.', 'success')
    } catch (err) {
      notify(err?.response?.data?.message || err.message || 'Upload failed.')
    } finally {
      setUploadingFor(null)
    }
  }

  // "Delete" here is what the user sees; under the hood it's still a
  // reversal (a linked, offsetting entry — see reverseExpense in
  // DataContext), because expenses are append-only and never actually
  // erased from the record. Kept as a single, no-frills confirm — no
  // separate reason step — since the person just wants the row gone from
  // view, not a mini financial-correction workflow.
  function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    reverseExpense(deleteTarget.id)
      .then(() => {
        setDeleteTarget(null)
        setDetail(null)
        notify('Expense deleted.', 'success')
      })
      .catch((err) => notify(err?.response?.data?.message || err.message))
      .finally(() => setDeleting(false))
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  // Reversal entries are just the internal, offsetting rows created when
  // something is "deleted" — an implementation detail, not something a
  // committee member should have to look at or make sense of. Hide them
  // from the visible list; `total` above still nets them in so the
  // header figure stays accurate.
  const visibleExpenses = expenses.filter((e) => !e.isReversal)

  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visibleExpenses.filter((e) => {
      const matchesQuery = !q || [e.description, e.vendor, e.bankName, e.transactionReference, projectOf(e.projectId), fundOf(e.fundId)]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
      const matchesTarget = targetFilter === 'all'
        || (targetFilter === 'project' && !!e.projectId)
        || (targetFilter === 'fund' && !!e.fundId)
        || e.projectId === targetFilter
        || e.fundId === targetFilter
      const matchesReceipt = receiptFilter === 'all'
        || (receiptFilter === 'attached' && !!e.receiptId)
        || (receiptFilter === 'none' && !e.receiptId)
      const matchesDate = !(dateFrom || dateTo) || inRange(e.date, dateFrom, dateTo)
      return matchesQuery && matchesTarget && matchesReceipt && matchesDate
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleExpenses, query, targetFilter, receiptFilter, dateFrom, dateTo, projects, funds])

  // Render at most 50 rows at a time — with thousands of expenses,
  // rendering every row into the DOM on every render is what made
  // switching to/around this page slow. `total` above still sums every
  // expense, so the header stays accurate.
  const { pageItems: pagedExpenses, page: tablePage, totalPages: tableTotalPages, total: tableTotal, setPage: setTablePage } = usePagedList(filteredExpenses, 50)

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={
          dataFullyLoaded
            ? `${filteredExpenses.length} of ${visibleExpenses.length} records · ${currency(total)} net spend · tap a row for details`
            : `${filteredExpenses.length} of ${visibleExpenses.length} records so far · calculating net spend…`
        }
        action={<button onClick={() => setModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> Log expense</button>}
      />

      {visibleExpenses.length > 0 && (
        <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
          <FilterPopover active={activeFilterCount} onClear={clearFilters}>
            <FilterGrid>
              <FilterField label="Search" full>
                <FilterTextInput placeholder="Search by description, vendor, bank, reference…" value={query} onChange={setQuery} />
              </FilterField>
              <FilterField label="Target">
                <FilterSelectInput
                  value={targetFilter}
                  onChange={setTargetFilter}
                  options={[
                    ['all', 'All expenses'],
                    ['project', 'Any project'],
                    ['fund', 'Any fund (direct)'],
                    ...projects.map((p) => [p.id, `Project · ${p.name}`]),
                    ...funds.map((f) => [f.id, `Fund · ${f.name}`]),
                  ]}
                />
              </FilterField>
              <FilterField label="Receipt">
                <FilterSelectInput
                  value={receiptFilter}
                  onChange={setReceiptFilter}
                  options={[['all', 'Any'], ['attached', 'Attached'], ['none', 'No receipt']]}
                />
              </FilterField>
              <FilterField label="Date range">
                <div className="flex items-center gap-2">
                  <FilterDateInput value={dateFrom} onChange={setDateFrom} />
                  <span className="text-ink-400 text-xs">to</span>
                  <FilterDateInput value={dateTo} onChange={setDateTo} />
                </div>
              </FilterField>
            </FilterGrid>
          </FilterPopover>
        </div>
      )}

      <div className="card overflow-hidden">
        {visibleExpenses.length === 0 ? (
          <EmptyState icon={FileText} title="No expenses logged" subtitle="Log an expense against a project to track spend." action={<button onClick={() => setModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> Log expense</button>} />
        ) : filteredExpenses.length === 0 ? (
          <EmptyState icon={FileText} title="No expenses match your filters" subtitle="Try a different search term or clear the filters." action={<button onClick={clearFilters} className="btn-secondary">Clear filters</button>} />
        ) : (
          <div className="table-wrap !border-0">
            <table className="data-table">
              <thead><tr><th>Description</th><th>Project / Fund</th><th>Vendor</th><th>Amount</th><th>Date</th><th>Receipt</th><th /></tr></thead>
              <tbody>
                {pagedExpenses.map((e) => {
                  const rc = receiptOf(e.receiptId)
                  return (
                    <tr key={e.id} className={`cursor-pointer ${e.isVoided ? 'opacity-40 blur-[0.4px] hover:blur-0 hover:opacity-60 transition' : ''}`} onClick={() => setDetail(e)}>
                      <td className="font-medium text-ink-800">
                        {e.description}
                        {e.isVoided && <span className="badge bg-ink-100 text-ink-500 ml-2">Deleted</span>}
                      </td>
                      <td>
                        {e.projectId ? projectOf(e.projectId) : e.fundId ? (
                          <span className="badge bg-violet-50 text-violet-700 ring-1 ring-violet-200">Fund · {fundOf(e.fundId)}</span>
                        ) : '—'}
                      </td>
                      <td>{e.vendor}</td>
                      <td className="font-semibold">{currency(e.amount)}</td>
                      <td>{formatDate(e.date)}</td>
                      <td>
                        {rc ? (
                          <span className="badge bg-brand-50 text-brand-700 ring-1 ring-brand-200"><Paperclip className="h-3 w-3" /> Attached</span>
                        ) : (
                          <span className="badge bg-ink-100 text-ink-500">None</span>
                        )}
                      </td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {!e.isVoided && (
                            <button onClick={() => setDeleteTarget(e)} title="Delete this expense" className="p-2 rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-500">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pager page={tablePage} totalPages={tableTotalPages} total={tableTotal} onChange={setTablePage} pageSize={50} />
          </div>
        )}
      </div>

      {/* Log expense */}
      <Modal open={modal} onClose={() => setModal(false)} title="Log expense" wide>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Description</label>
            <input required className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Fencing materials — Phase 2" />
          </div>
          <div>
            <label className="label">Spending from</label>
            <div className="flex gap-2 mb-2">
              {['project', 'fund'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, targetType: t, projectId: '', fundId: '', reason: '' })}
                  className={`badge capitalize border ${form.targetType === t ? 'bg-brand-gradient text-white border-transparent' : 'bg-white text-ink-500 border-ink-200 hover:border-brand-300'}`}
                >
                  {t === 'project' ? 'A project' : 'A fund directly'}
                </button>
              ))}
            </div>
            {form.targetType === 'project' ? (
              <select required className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">Select project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <select required className="input" value={form.fundId} onChange={(e) => setForm({ ...form, fundId: e.target.value })}>
                <option value="">Select fund</option>
                {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
            {form.targetType === 'project' && projects.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-600">No projects set up yet — add one under Projects first.</p>
            )}
            {form.targetType === 'fund' && (
              <p className="mt-1.5 text-xs text-ink-400">Deducted straight from the fund's balance — enter whatever amount was actually spent below.</p>
            )}
          </div>
          {form.targetType === 'fund' && (
            <div>
              <label className="label">Reason <span className="text-rose-500">*</span></label>
              <textarea required rows={2} className="input" placeholder="Why this was spent directly from the fund"
                value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount (ETB)</label>
              <input required type="number" min="0" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className="label">Date</label>
              <CalendarDateInput value={form.date} onChange={(value) => setForm({ ...form, date: value })} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Vendor</label>
            <input required className="input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Bank</label>
              <select className="input" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })}>
                <option value="">Select (optional)</option>
                {EXPENSE_PAYMENT_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{form.bankName === 'Telebirr' ? 'Reference ID' : 'Transaction ID'}</label>
              <input className="input" placeholder={form.bankName === 'Telebirr' ? 'e.g. CFE1A2B3...' : 'e.g. FT2408...'} value={form.transactionReference} onChange={(e) => setForm({ ...form, transactionReference: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Receipt (optional)</label>
            <div className="rounded-xl border-2 border-dashed border-ink-200 hover:border-brand-300 transition p-4 text-center">
              <Upload className="h-5 w-5 text-ink-300 mx-auto mb-1.5" />
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input"
                onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} />
              <p className="text-xs text-ink-400 mt-1.5">Any resident will be able to view or download this.</p>
            </div>
          </div>
          <p className="text-xs text-ink-400 -mt-1">
            Once logged, this record can't be edited — only deleted.
          </p>
          {error && <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-600">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1">{submitting ? 'Saving…' : 'Log expense'}</button>
          </div>
        </form>
      </Modal>

      {/* Expense detail with receipt view/download */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.description || 'Expense'}>
        {detail && (
          <ExpenseDetail
            expense={detail}
            project={detail.projectId ? projectOf(detail.projectId) : null}
            fund={detail.fundId ? fundOf(detail.fundId) : null}
            receipt={receiptOf(detail.receiptId)}
            onAttach={(file) => attachReceipt(detail.id, file)}
            uploading={uploadingFor === detail.id}
            onToggleVerified={(rc) => updateReceipt(rc.id, { verified: !rc.verified })}
            onDelete={() => setDeleteTarget(detail)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete expense?"
        message={deleteTarget ? `This will delete "${deleteTarget.description}" and can't be undone.` : ''}
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function ExpenseDetail({ expense, project, fund, receipt, onAttach, uploading, onToggleVerified, onDelete }) {
  const url = receipt ? fileUrl(receipt.fileUrl) : null
  const handleDownload = async () => {
    try {
      await downloadFile(url, receipt.fileName)
    } catch (err) {
      notify(err.message || 'Failed to download receipt.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      {expense.isVoided && (
        <div className="rounded-xl bg-ink-50 border border-ink-200 px-3.5 py-2.5 text-sm text-ink-600">
          This expense has been deleted.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-ink-400 text-xs uppercase font-semibold">{fund ? 'Fund' : 'Project'}</p><p className="text-ink-800">{fund || project || '—'}</p></div>
        <div><p className="text-ink-400 text-xs uppercase font-semibold">Vendor</p><p className="text-ink-800">{expense.vendor}</p></div>
        <div><p className="text-ink-400 text-xs uppercase font-semibold">Amount</p><p className="text-ink-800 font-semibold">{currency(expense.amount)}</p></div>
        <div><p className="text-ink-400 text-xs uppercase font-semibold">Date</p><p className="text-ink-800">{formatDate(expense.date)}</p></div>
        {expense.bankName && <div><p className="text-ink-400 text-xs uppercase font-semibold">Bank</p><p className="text-ink-800">{expense.bankName}</p></div>}
        {expense.transactionReference && <div><p className="text-ink-400 text-xs uppercase font-semibold">{expense.bankName === 'Telebirr' ? 'Reference ID' : 'Transaction ID'}</p><p className="text-ink-800 font-mono text-xs">{expense.transactionReference}</p></div>}
        {fund && expense.reason && <div className="col-span-2"><p className="text-ink-400 text-xs uppercase font-semibold">Reason</p><p className="text-ink-800">{expense.reason}</p></div>}
      </div>

      <div className="border-t border-ink-100 pt-4">
        <p className="text-xs uppercase font-semibold text-ink-400 mb-2">Receipt</p>
        {receipt ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary"><Eye className="h-4 w-4" /> View</a>
              <button type="button" onClick={handleDownload} className="btn-secondary"><Download className="h-4 w-4" /> Download</button>
              <button
                onClick={() => onToggleVerified(receipt)}
                className={`badge cursor-pointer ${receipt.verified ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}
              >
                {receipt.verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                {receipt.verified ? 'Verified' : 'Mark verified'}
              </button>
            </div>
          </div>
        ) : expense.isVoided ? (
          <p className="text-sm text-ink-400">No receipt was attached, and this expense has been deleted — no new receipts can be added.</p>
        ) : (
          <div>
            <p className="text-sm text-ink-400 mb-2">No receipt attached yet.</p>
            <label className="btn-secondary cursor-pointer inline-flex">
              <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Attach receipt'}
              <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading}
                onChange={(e) => e.target.files?.[0] && onAttach(e.target.files[0])} />
            </label>
          </div>
        )}
      </div>

      {!expense.isVoided && (
        <div className="border-t border-ink-100 pt-4">
          <button onClick={onDelete} className="btn-secondary text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Delete this expense</button>
        </div>
      )}
    </div>
  )
}
