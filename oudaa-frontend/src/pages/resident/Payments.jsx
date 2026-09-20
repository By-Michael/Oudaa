import { useRef, useState } from 'react'
import {
  Wallet, Plus, Copy, Check, Landmark, Loader2, ShieldCheck, Clock, RotateCw, Upload, FileCheck2, Smartphone,
  Download, UserCog,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { PageHeader, Modal, Badge, EmptyState, currency, formatDate, usePagedList, Pager } from '../../components/ui'
import { useLanguage } from '../../context/LanguageContext'
import { formatMonthKey } from '../../lib/ethiopianCalendar'

// Maps a CommunityPaymentMethod's `provider` enum (DB value) to the
// lowercase hint the backend's self-verify endpoint expects (see
// DB_PROVIDER_TO_VERITAS in paymentController.js). Hivee only supports
// these two providers (see PaymentProvider in schema.prisma).
const PROVIDER_TO_HINT = {
  CBE: 'cbe', TELEBIRR: 'telebirr',
}
const PROVIDER_LABELS = {
  CBE: 'Commercial Bank of Ethiopia (CBE)', TELEBIRR: 'Telebirr',
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Turns a raw paidForMonth value ("2026-08" or "2026-06,2026-07,2026-08")
// into something readable, and flags whether any part of it is a future
// month — i.e. a prepayment the committee recorded ahead of when it was
// actually due.
function describeForMonth(paidForMonth) {
  if (!paidForMonth) return null
  const keys = paidForMonth.split(',').filter(Boolean)
  if (keys.length === 0) return null
  const label = (key) => formatMonthKey(key)
  const now = new Date()
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isFuture = keys.some((k) => k > nowKey)
  const text = keys.length === 1 ? label(keys[0]) : `${label(keys[0])} – ${label(keys[keys.length - 1])}`
  return { text, isFuture }
}

// Small "value + copy button" row used in the "pay to" block.
function CopyRow({ label, value, mono }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard API unavailable — silently no-op, the value is still visible to copy by hand
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
        <p className={`text-sm font-semibold text-ink-800 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 transition"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// Read-only "view details" row used in the payment detail modal — just a
// label/value pair, no inputs. Residents can look but not touch, since
// this is here so they can double-check a committee-recorded entry is
// accurate, not edit it.
function DetailRow({ label, value, mono }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-ink-100 last:border-0">
      <span className="text-xs uppercase tracking-wide text-ink-400 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm font-medium text-ink-800 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

const emptyForm = { feeId: '', paymentMethodId: '', payerName: '', txnId: '', phoneNumber: '', reason: '' }

export default function ResidentPayments() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const {
    payments, fees, residents, community, paymentMethods,
    submitSelfPayment, uploadSelfPaymentReceipt, retractPayment, parsePaymentScreenshot, loadError, loading,
  } = useData()
  // Residents only ever see active methods (see paymentMethodController's
  // listPaymentMethods) — but filter again defensively in case an admin
  // preview or cached state slips one through.
  const activeMethods = paymentMethods.filter((m) => m.isActive)
  const resident = residents.find((r) => r.id === user?.residentId) || residents[0]
  const mine = payments.filter((p) => p.residentId === resident?.id).sort((a, b) => new Date(b.date) - new Date(a.date))
  const feeOf = (id) => fees.find((f) => f.id === id)
  const [detailTarget, setDetailTarget] = useState(null)
  const { pageItems: pagedMine, page: tablePage, totalPages: tableTotalPages, total: tableTotal, setPage: setTablePage } = usePagedList(mine, 50)

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [useMyName, setUseMyName] = useState(false)
  // phase: 'form' | 'verifying' | 'success'
  const [phase, setPhase] = useState('form')
  const [error, setError] = useState('')
  const [canRetry, setCanRetry] = useState(false)
  const [successStatus, setSuccessStatus] = useState('paid')
  const [successReviewFlags, setSuccessReviewFlags] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrNote, setOcrNote] = useState('')
  const [receiptAmount, setReceiptAmount] = useState(null)
  const fileInputRef = useRef(null)

  // CBE-only: resident uploads their e-receipt (image/PDF) — backend runs
  // OCR (OCR.space) then Groq to auto-fill transaction ID and name. Upload
  // is always visible; no receipt link input (links can't be verified
  // reliably).
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [receiptFileName, setReceiptFileName] = useState('')
  const [receiptUploadError, setReceiptUploadError] = useState('')
  const receiptInputRef = useRef(null)
  // Set when the uploaded receipt resolves to a CBE reference via
  // OCR/Groq extraction — sent as receiptReference so the backend can
  // bank-verify the payment instantly instead of queuing it for manual
  // review.
  const [receiptReference, setReceiptReference] = useState('')

  const selectedFee = fees.find((f) => f.id === form.feeId)
  const selectedMethod = activeMethods.find((m) => m.id === form.paymentMethodId)
  const isCbe = selectedMethod?.provider === 'CBE'
  const payerNameReady = form.payerName.trim().length > 0
  const isTelebirr = selectedMethod?.provider === 'TELEBIRR'
  // Only CBE and Telebirr are supported — CBE is receipt-only (no
  // transaction ID/suffix needed) and Telebirr needs the sender's phone.
  const needsPhone = isTelebirr

  function openModal() {
    setForm({ ...emptyForm, feeId: fees[0]?.id || '', paymentMethodId: activeMethods[0]?.id || '' })
    setUseMyName(false)
    setPhase('form')
    setError('')
    setCanRetry(false)
    setOcrNote('')
    setReceiptAmount(null)
    setReceiptFileName('')
    setReceiptUploadError('')
    setReceiptReference('')
    setModal(true)
  }

  function selectMethod(methodId) {
    // Clear fields that don't carry over between providers (a CBE
    // receipt is meaningless for Telebirr and vice versa) so a leftover
    // value can't sneak into a submission it doesn't apply to.
    setForm((f) => ({ ...f, paymentMethodId: methodId, txnId: '', phoneNumber: '', receiptUrl: undefined }))
    setReceiptFileName('')
    setReceiptUploadError('')
    setReceiptReference('')
    setOcrNote('')
    setReceiptAmount(null)
  }

  async function handleReceiptUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Belt-and-braces: the button is disabled until a name is entered, but
    // guard here too in case the input is ever reached another way.
    setReceiptUploading(true)
    setReceiptUploadError('')
    setOcrNote('')
    let result
    try {
      result = await uploadSelfPaymentReceipt(file)
      setReceiptFileName(file.name)
      // Backend runs OCR + Groq on the uploaded file and returns
      // extractedTxnId and extractedName. Auto-fill both if found —
      // the resident can correct them before submitting.
      const updates = { receiptUrl: result.receiptUrl }
      if (result.extractedTxnId) {
        updates.txnId = result.extractedTxnId
        setReceiptReference(result.extractedTxnId)
      }
      if (result.extractedName) {
        updates.payerName = result.extractedName
        setUseMyName(false)
      }
      setForm((f) => ({ ...f, ...updates }))
    } catch (err) {
      setReceiptUploadError(err?.response?.data?.message || err.message || 'Could not upload that receipt.')
      setReceiptUploading(false)
      if (receiptInputRef.current) receiptInputRef.current.value = ''
      return
    }
    setReceiptUploading(false)

    // Show a note if fields were auto-filled from the receipt
    if (result.extractedTxnId || result.extractedName) {
      let note = 'Details filled in from your receipt — please double-check before submitting.'
      setOcrNote(note)
    }
    if (receiptInputRef.current) receiptInputRef.current.value = ''
  }

  function closeModal() {
    if (phase === 'verifying') return // don't allow closing mid-verification
    setModal(false)
  }

  function toggleUseMyName() {
    const next = !useMyName
    setUseMyName(next)
    setForm((f) => ({ ...f, payerName: next ? (user?.name || '') : '' }))
  }

  async function handleScreenshot(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrLoading(true)
    setOcrNote('')
    try {
      const result = await parsePaymentScreenshot(file)
      const updates = {}
      if (result.name) updates.payerName = result.name
      if (result.txnId) updates.txnId = result.txnId
      if (result.receiptUrl) updates.receiptUrl = result.receiptUrl
      if (Object.keys(updates).length) {
        setForm((f) => ({ ...f, ...updates }))
        setUseMyName(false)
        let note = 'Filled in from your screenshot — please double-check before submitting.'
        // Amount isn't a form field (it's fixed by the selected fee), but if
        // the screenshot shows a different amount than the fee you picked,
        // that's exactly the kind of mismatch worth flagging before submit —
        // plain OCR text alone couldn't tell you this, only the structured
        // amount field can.
        if (result.amount != null && selectedFee && Math.abs(result.amount - Number(selectedFee.amount)) > 0.01) {
          note += ` Heads up: the screenshot shows ${result.amount}, but "${selectedFee.name}" is ${currency(selectedFee.amount)} — double-check you selected the right fee.`
        }
        setOcrNote(note)
      } else {
        setOcrNote("Couldn't read a name or transaction ID from that image. Please fill them in manually.")
      }
      setReceiptAmount(result.amount != null ? Number(result.amount) : null)
    } catch (err) {
      setOcrNote(err?.response?.data?.message || err.message || 'Could not read that screenshot.')
    } finally {
      setOcrLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Block resident-only actions if the user is a staff role (admin or
  // committee) with no resident profile linked. Admins/committee members
  // who ARE also residents (residentId is set) can use this page normally.
  const isAdminPreview = ['admin', 'committee'].includes(user?.role) && !user?.residentId

  async function attemptSubmit() {
    setError('')
    setCanRetry(false)
    if (isAdminPreview) {
      setError("You're an admin with no resident profile of your own in this community — payment submission is resident-only.")
      return
    }
    if (isCbe && !form.txnId.trim()) {
      setError('Enter your CBE transaction ID before submitting.')
      return
    }
    if (!form.txnId.trim()) {
      setError('Transaction ID is required.')
      return
    }
    if (needsPhone && !form.phoneNumber.trim()) {
      setError('This provider requires the phone number the payment was made from.')
      return
    }
    setPhase('verifying')
    try {
      const payment = await submitSelfPayment({
        feeId: form.feeId,
        payerName: form.payerName.trim(),
        reason: form.reason.trim(),
        receiptAmount,
        paymentMethodId: selectedMethod?.id || undefined,
        provider: selectedMethod ? PROVIDER_TO_HINT[selectedMethod.provider] : undefined,
        txnId: form.txnId.trim(),
        phoneNumber: needsPhone ? form.phoneNumber.trim() : undefined,
        receiptUrl: form.receiptUrl || undefined,
        receiptReference: isCbe ? (receiptReference || undefined) : undefined,
      })
      setSuccessStatus(payment?.status || 'paid')
      setSuccessReviewFlags(payment?.reviewFlags || '')
      setPhase('success')
    } catch (err) {
      // No `response` means the request never reached the server (offline,
      // DNS hiccup, dropped connection, the API host itself unreachable) —
      // that's worth letting the resident retry with one tap rather than
      // re-typing the whole form. A `response` means the server answered
      // (validation error, duplicate txn ID, etc.) — retrying won't help
      // until they change something, so no retry button for those.
      const isNetworkError = !err?.response
      const serverMessage = err?.response?.data?.message
      setError(
        serverMessage ||
        (isNetworkError
          ? "Couldn't reach the server. Check your connection and try again."
          : err.message || 'Could not verify this payment.')
      )
      setCanRetry(isNetworkError || err?.response?.status >= 500)
      setPhase('form')
    }
  }

  async function submit(e) {
    e.preventDefault()
    await attemptSubmit()
  }

  const [retractingId, setRetractingId] = useState(null)
  const [retractError, setRetractError] = useState('')

  async function handleRetract(id) {
    if (!window.confirm(t('resident_portal.retract_this_payment_this_can_t_be_undon', "Retract this payment? This can't be undone — you'll need to resubmit if it was actually correct."))) return
    setRetractingId(id)
    setRetractError('')
    try {
      await retractPayment(id)
    } catch (err) {
      setRetractError(err?.response?.data?.message || 'Could not retract this payment.')
    } finally {
      setRetractingId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="My Payments"
        subtitle={`Full contribution history for unit ${resident?.unit}`}
        action={<button onClick={openModal} className="btn-primary"><Plus className="h-4 w-4" /> Make a payment</button>}
      />

      {retractError && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">{retractError}</div>
      )}

      <div className="card overflow-hidden">
        {mine.length === 0 ? (
          <EmptyState icon={Wallet} title="No payments yet" subtitle="Once you make a contribution it will show up here." />
        ) : (
          <div className="table-wrap !border-0">
            <table className="data-table">
              <thead><tr><th>Fee</th><th>Amount</th><th>Method</th><th>Paid by</th><th>Reference</th><th>Date</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pagedMine.map((p) => (
                  <tr key={p.id} onClick={() => setDetailTarget(p)} className="cursor-pointer hover:bg-brand-50/40">
                    <td className="font-medium text-ink-800">
                      {feeOf(p.feeId)?.name || (p.projectName || '—')}
                      {p.feeId && describeForMonth(p.paidForMonth) && (
                        <div className={`text-[11px] font-normal ${describeForMonth(p.paidForMonth).isFuture ? 'text-brand-600' : 'text-ink-400'}`}>
                          For {describeForMonth(p.paidForMonth).text}
                          {describeForMonth(p.paidForMonth).isFuture ? ' (prepayment)' : ''}
                        </div>
                      )}
                    </td>
                    <td className="font-semibold">{currency(p.amount)}</td>
                    <td>{p.method}</td>
                    <td className="text-ink-500">{p.payerName || '—'}</td>
                    <td className="font-mono text-xs text-ink-400">{p.reference}</td>
                    <td>{formatDate(p.date)}</td>
                    <td><Badge status={p.status} /></td>
                    <td>
                      {p.status === 'pending_review' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetract(p.id) }}
                          disabled={retractingId === p.id}
                          className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                          title="Retract — only possible before an admin reviews it"
                        >
                          {retractingId === p.id ? 'Retracting…' : 'Retract'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={tablePage} totalPages={tableTotalPages} total={tableTotal} onChange={setTablePage} pageSize={50} />
          </div>
        )}
      </div>

      <Modal open={modal} onClose={closeModal} title="Make a payment" dismissible={phase !== 'verifying'} wide>
        {phase === 'success' ? (
          successStatus === 'pending_review' ? (
            <div className="text-center py-6">
              <div className="mx-auto h-14 w-14 rounded-full bg-amber-50 flex items-center justify-center">
                <Clock className="h-7 w-7 text-amber-600" />
              </div>
              <p className="mt-4 text-lg font-bold text-ink-900">Submitted for review</p>
              <p className="mt-1 text-sm text-ink-500">
                We couldn't fully auto-verify this transaction. It's been recorded and a
                committee admin will review it shortly.
              </p>
              {successReviewFlags ? (
                <div className="mt-4 mx-auto max-w-sm rounded-lg bg-amber-50 border border-amber-100 p-3 text-left">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">
                    Why this needs review
                  </p>
                  <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
                    {successReviewFlags.split('. ').filter(Boolean).map((flag, i) => (
                      <li key={i}>{flag.replace(/\.$/, '')}.</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <button onClick={() => setModal(false)} className="btn-primary mt-6">Done</button>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center">
                <ShieldCheck className="h-7 w-7 text-emerald-600" />
              </div>
              <p className="mt-4 text-lg font-bold text-ink-900">Payment initiated</p>
              <p className="mt-1 text-sm text-ink-500">
                Your bank transaction was verified and this payment has been recorded as paid.
              </p>
              <button onClick={() => setModal(false)} className="btn-primary mt-6">Done</button>
            </div>
          )
        ) : phase === 'verifying' ? (
          <div className="text-center py-10">
            <Loader2 className="h-10 w-10 text-brand-600 mx-auto animate-spin" />
            <p className="mt-4 font-semibold text-ink-800">Verifying your payment…</p>
            <p className="mt-1 text-sm text-ink-500">This only takes a moment. Please don't close this window.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="label">Fee</label>
              <select required className="input" value={form.feeId} onChange={(e) => setForm({ ...form, feeId: e.target.value })}>
                <option value="">Select fee</option>
                {fees.map((f) => <option key={f.id} value={f.id}>{f.name} · {currency(f.amount)}</option>)}
              </select>
              {fees.length === 0 && (
                <p className="mt-1.5 text-xs text-amber-600">
                  {loading
                    ? 'Loading fees…'
                    : loadError
                    ? `Couldn't load fees: ${loadError}`
                    : "No fees set up yet for your community — ask the committee to add one under Fees."}
                </p>
              )}
            </div>

            {activeMethods.length > 0 && (
              <div>
                <label className="label">Pay with</label>
                <div className={`grid gap-2.5 ${activeMethods.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {activeMethods.map((m) => {
                    const selected = form.paymentMethodId === m.id
                    const Icon = m.provider === 'TELEBIRR' ? Smartphone : Landmark
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => selectMethod(m.id)}
                        className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-left transition ring-1 ${
                          selected
                            ? 'bg-brand-50 ring-brand-300 text-brand-700'
                            : 'bg-white ring-ink-200 text-ink-600 hover:bg-ink-50'
                        }`}
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-brand-600' : 'text-ink-400'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-tight truncate">{m.label}</p>
                          <p className={`text-xs leading-tight truncate ${selected ? 'text-brand-500' : 'text-ink-400'}`}>
                            {PROVIDER_LABELS[m.provider] || m.provider}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {selectedFee && (
              <div className="rounded-xl bg-brand-50/60 ring-1 ring-brand-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 flex items-center gap-1.5 mb-1.5">
                  {isTelebirr ? <Smartphone className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5" />} Send payment to
                </p>
                <div className="divide-y divide-brand-100/80">
                  {isTelebirr ? (
                    <>
                      <CopyRow label="Full name" value={selectedMethod.fullName || '—'} />
                      <CopyRow label="Phone number" value={selectedMethod.phoneNumber || '—'} mono />
                    </>
                  ) : (
                    <>
                      <CopyRow label="Bank" value={selectedMethod?.bankName || community?.paymentBankName || '—'} />
                      <CopyRow label="Account name" value={selectedMethod?.accountName || community?.paymentAccountName || '—'} />
                      <CopyRow label="Account number" value={selectedMethod?.accountNumber || community?.paymentAccountNumber || '—'} mono />
                    </>
                  )}
                  <CopyRow label="Amount" value={currency(selectedFee.amount)} />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label !mb-0">Paid by (name on the transfer)</label>
                <label className="flex items-center gap-1.5 text-xs text-ink-500 cursor-pointer select-none">
                  <input type="checkbox" checked={useMyName} onChange={toggleUseMyName} className="rounded" />
                  Use my account name
                </label>
              </div>
              <input
                required
                className="input"
                placeholder="Full name of whoever sent the money"
                value={form.payerName}
                onChange={(e) => { setForm({ ...form, payerName: e.target.value }); setUseMyName(false) }}
              />
              <p className="mt-1 text-xs text-ink-400">If someone paid on your behalf (e.g. a family member), put their name here.</p>
            </div>

            {isCbe ? (
              <>
                {/* CBE: Transaction ID — auto-filled from receipt upload */}
                <div>
                  <label className="label">Transaction ID</label>
                  <input
                    className="input font-mono"
                    placeholder="e.g. FT24219XXXXX"
                    value={form.txnId}
                    onChange={(e) => {
                      setForm({ ...form, txnId: e.target.value })
                      setReceiptReference(e.target.value.trim())
                    }}
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    Found on your CBE e-receipt or transfer confirmation. Upload your receipt below and we'll fill this in automatically.
                  </p>
                </div>

                {/* CBE: Receipt upload — always visible, no name gate */}
                <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3.5">
                  <label className="label !mb-1.5">CBE e-receipt</label>
                  <p className="text-xs text-ink-400 mb-3">
                    Upload your e-receipt screenshot or PDF — we'll extract the transaction ID and name automatically. If we can't extract them, a committee admin will confirm it manually.
                  </p>

                  <input ref={receiptInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={handleReceiptUpload} />
                  <button
                    type="button"
                    onClick={() => receiptInputRef.current?.click()}
                    disabled={receiptUploading || ocrLoading || isAdminPreview}
                    title={isAdminPreview ? "You have no resident profile in this community — receipt upload is resident-only." : undefined}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold bg-brand-gradient text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {receiptUploading || ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (receiptFileName ? <FileCheck2 className="h-4 w-4" /> : <Upload className="h-4 w-4" />)}
                    {receiptUploading ? 'Uploading…' : ocrLoading ? 'Reading receipt…' : receiptFileName ? `Uploaded: ${receiptFileName}` : 'Upload screenshot or PDF'}
                  </button>

                  {isAdminPreview && (
                    <p className="mt-1.5 text-xs text-center text-ink-400">
                      Receipt upload is resident-only, and you don't have a resident profile in this community.
                    </p>
                  )}
                  {receiptFileName && form.receiptUrl && !receiptUploading && !ocrLoading && (
                    <p className={`mt-1.5 text-xs ${receiptReference ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {receiptReference
                        ? 'Transaction ID extracted — filled in automatically.'
                        : "Couldn't extract details from this file — it'll be queued for manual review."}
                    </p>
                  )}
                  {ocrNote && !receiptUploading && !ocrLoading && (
                    <p className="mt-1.5 text-xs text-ink-500">{ocrNote}</p>
                  )}
                  {receiptUploadError && <p className="mt-2 text-xs text-center text-rose-600">{receiptUploadError}</p>}
                </div>
              </>
            ) : (
              <>
                {/* Telebirr: Reference number — auto-filled from screenshot/PDF upload */}
                <div>
                  <label className="label">Reference number</label>
                  <input
                    className="input font-mono"
                    placeholder="From your Telebirr transfer confirmation"
                    value={form.txnId}
                    onChange={(e) => setForm({ ...form, txnId: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    Upload your Telebirr screenshot or PDF below and we'll fill this in automatically.
                  </p>
                </div>

                {/* Telebirr: Receipt upload — same layout as CBE, always visible */}
                <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3.5">
                  <label className="label !mb-1.5">Telebirr receipt</label>
                  <p className="text-xs text-ink-400 mb-3">
                    Upload your Telebirr confirmation screenshot or PDF — we'll read the reference number and name automatically.
                  </p>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={handleScreenshot} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={ocrLoading}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold bg-brand-gradient text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (form.txnId || form.payerName ? <FileCheck2 className="h-4 w-4" /> : <Upload className="h-4 w-4" />)}
                    {ocrLoading ? 'Reading receipt…' : (form.txnId || form.payerName ? 'Replace receipt' : 'Upload screenshot or PDF')}
                  </button>
                  {ocrNote && !ocrLoading && (
                    <p className="mt-1.5 text-xs text-ink-500">{ocrNote}</p>
                  )}
                </div>
              </>
            )}

            {needsPhone && (
              <div>
                <label className="label">Phone number used to pay</label>
                <input
                  required
                  className="input font-mono"
                  placeholder="e.g. 2519XXXXXXXX"
                  value={form.phoneNumber}
                  onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="label">Reason (optional)</label>
              <textarea
                rows={2}
                className="input"
                placeholder="e.g. August dues"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>



            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-600">
                <div className="flex items-start justify-between gap-3">
                  <span>{error}</span>
                  {canRetry && (
                    <button
                      type="button"
                      onClick={attemptSubmit}
                      className="shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-100 hover:bg-rose-200 transition"
                    >
                      <RotateCw className="h-3.5 w-3.5" /> Retry
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeModal} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={isAdminPreview} title={isAdminPreview ? "You don't have a resident profile in this community — submission is resident-only." : undefined}>Submit payment</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Read-only payment detail — lets a resident confirm a payment
          (whether they submitted it themselves or a committee member
          recorded it for them) is accurate. No fields are editable here;
          that only happens from the admin side. */}
      <Modal open={!!detailTarget} onClose={() => setDetailTarget(null)} title="Payment details">
        {detailTarget && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-ink-900">{currency(detailTarget.amount)}</p>
                <p className="text-sm text-ink-500">
                  {feeOf(detailTarget.feeId)?.name || detailTarget.projectName || '—'}
                </p>
              </div>
              <Badge status={detailTarget.status} />
            </div>

            <div className="rounded-xl border border-ink-100 px-3.5">
              <DetailRow label="Method" value={detailTarget.method} />
              {detailTarget.feeId && describeForMonth(detailTarget.paidForMonth) && (
                <div className="flex items-start justify-between gap-3 py-2 border-b border-ink-100">
                  <span className="text-xs uppercase tracking-wide text-ink-400 shrink-0 pt-0.5">For month</span>
                  <span className={`text-sm font-medium text-right ${describeForMonth(detailTarget.paidForMonth).isFuture ? 'text-brand-700' : 'text-ink-800'}`}>
                    {describeForMonth(detailTarget.paidForMonth).text}
                    {describeForMonth(detailTarget.paidForMonth).isFuture ? ' · Prepayment' : ''}
                  </span>
                </div>
              )}
              <DetailRow label="Reference" value={detailTarget.reference} mono />
              <DetailRow label="Date" value={formatDate(detailTarget.date)} />
              <DetailRow label="Paid by" value={detailTarget.payerName} />
              <DetailRow label="Reason" value={detailTarget.reason} />
              <DetailRow label="Bank sender name" value={detailTarget.senderName} />
              {detailTarget.recordedByName && (
                <div className="flex items-start justify-between gap-3 py-2">
                  <span className="text-xs uppercase tracking-wide text-ink-400 shrink-0 pt-0.5">Recorded by</span>
                  <span className="text-sm font-medium text-ink-800 text-right flex items-center gap-1.5">
                    <UserCog className="h-3.5 w-3.5 text-ink-400" /> {detailTarget.recordedByName} (committee)
                  </span>
                </div>
              )}
            </div>

            {detailTarget.receiptUrl ? (
              <a
                href={detailTarget.receiptUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700 transition"
              >
                <Download className="h-4 w-4" /> View / download receipt
              </a>
            ) : (
              <p className="text-xs text-ink-400 text-center">No receipt was attached to this payment.</p>
            )}

            <button type="button" onClick={() => setDetailTarget(null)} className="btn-secondary w-full">
              Close
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
