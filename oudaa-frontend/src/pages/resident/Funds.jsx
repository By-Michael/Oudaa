import { useMemo, useRef, useState } from 'react'
import { Landmark, Target, Users, TrendingUp, HandCoins, Copy, Check, Camera, Loader2, ShieldCheck, Clock, RotateCw, Upload, FileCheck2, Smartphone, Link2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { PageHeader, Modal, Badge, currency, currencyBalance, usePagedList, Pager, formatDate, EmptyState } from '../../components/ui'

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

const catColors = {
  Security: 'from-brand-500 to-brand-600',
  Utilities: 'from-sky-400 to-sky-600',
  Maintenance: 'from-emerald-500 to-emerald-600',
  Development: 'from-violet-500 to-violet-600',
}

// Small "value + copy button" row used in the "pay to" block — identical
// to the one on the Make a Payment page, so the two flows feel the same.
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

const emptyForm = { amount: '', paymentMethodId: '', payerName: '', txnId: '', phoneNumber: '', reason: '' }

export default function ResidentFunds() {
  const { user } = useAuth()
  const {
    funds, fees, projects, payments, residents, community, paymentMethods,
    submitSelfPayment, uploadSelfPaymentReceipt, parsePaymentScreenshot,
  } = useData()
  const activeMethods = paymentMethods.filter((m) => m.isActive)
  const total = funds.reduce((s, f) => s + f.actualBalance, 0)
  const me = residents.find((r) => r.id === user?.residentId) || residents[0]
  const fundOf = (id) => funds.find((f) => f.id === id)
  // Direct fund contributions this resident made — shown further down so
  // they can actually see what happened after "Contribute" instead of the
  // modal just closing with no lasting trace of the status.
  const myContributions = useMemo(
    () => payments.filter((p) => p.residentId === me?.id && p.fundId).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [payments, me]
  )
  const { pageItems: pagedContributions, page: contribPage, totalPages: contribTotalPages, total: contribTotal, setPage: setContribPage } = usePagedList(myContributions, 20)

  const [contribute, setContribute] = useState(null)
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

  // CBE-only: the resident either uploads their e-receipt (screenshot/PDF)
  // or pastes a link to it — either way we end up with a receiptUrl to send
  // with self-verify. "mode" toggles which of the two inputs is showing.
  const [receiptMode, setReceiptMode] = useState('upload') // 'upload' | 'link'
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [receiptFileName, setReceiptFileName] = useState('')
  const [receiptUploadError, setReceiptUploadError] = useState('')
  const [receiptLink, setReceiptLink] = useState('')
  const receiptInputRef = useRef(null)
  const [receiptReference, setReceiptReference] = useState('')

  const selectedMethod = activeMethods.find((m) => m.id === form.paymentMethodId)
  const isCbe = selectedMethod?.provider === 'CBE'
  const isTelebirr = selectedMethod?.provider === 'TELEBIRR'
  // Only CBE and Telebirr are supported — CBE is receipt-only (no
  // transaction ID/suffix needed) and Telebirr needs the sender's phone.
  const needsPhone = isTelebirr

  // Contributing directly to a fund (any amount the resident chooses) uses
  // the fundId branch of the self-verify endpoint — no fee involved at all.
  const enriched = useMemo(() => funds.map((f) => {
    const projectIdsInFund = new Set(projects.filter((p) => p.fundId === f.id).map((p) => p.id))
    const contributorIds = new Set(
      payments.filter((p) => p.status === 'paid' && (p.fundId === f.id || projectIdsInFund.has(p.projectId))).map((p) => p.residentId)
    )
    const goal = f.goal || null
    const collected = f.verifiedCollected
    return {
      ...f,
      collected,
      contributors: contributorIds.size,
      nonContributors: Math.max(residents.length - contributorIds.size, 0),
      goal,
      pct: goal ? Math.min(100, Math.round((collected / goal) * 100)) : null,
    }
  }), [funds, fees, projects, payments, residents])

  function openContribute(f) {
    setContribute(f)
    setForm({ ...emptyForm, paymentMethodId: activeMethods[0]?.id || '' })
    setUseMyName(false)
    setPhase('form')
    setError('')
    setCanRetry(false)
    setOcrNote('')
    setReceiptAmount(null)
    setReceiptMode('upload')
    setReceiptFileName('')
    setReceiptUploadError('')
    setReceiptLink('')
    setReceiptReference('')
  }

  function selectMethod(methodId) {
    // Clear fields that don't carry over between providers (a CBE receipt
    // is meaningless for Telebirr and vice versa) so a leftover value
    // can't sneak into a submission it doesn't apply to.
    setForm((f) => ({ ...f, paymentMethodId: methodId, txnId: '', phoneNumber: '', receiptUrl: undefined }))
    setReceiptMode('upload')
    setReceiptFileName('')
    setReceiptUploadError('')
    setReceiptLink('')
    setReceiptReference('')
  }

  async function handleReceiptUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setReceiptUploading(true)
    setReceiptUploadError('')
    try {
      const result = await uploadSelfPaymentReceipt(file)
      setForm((f) => ({ ...f, receiptUrl: result.receiptUrl }))
      setReceiptFileName(file.name)
      setReceiptReference(result.extractedReference || '')
    } catch (err) {
      setReceiptUploadError(err?.response?.data?.message || err.message || 'Could not upload that receipt.')
    } finally {
      setReceiptUploading(false)
      if (receiptInputRef.current) receiptInputRef.current.value = ''
    }
  }

  function closeModal() {
    if (phase === 'verifying') return // don't allow closing mid-verification
    setContribute(null)
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
      if (Object.keys(updates).length) {
        setForm((f) => ({ ...f, ...updates }))
        setUseMyName(false)
        let note = 'Filled in from your screenshot — please double-check before submitting.'
        // A fund contribution's amount is whatever the resident chooses to
        // type in — but if the receipt itself shows a different amount than
        // what's currently typed into the Amount field, that's worth
        // flagging before they submit, same as the fee-payment flow does.
        if (result.amount != null && form.amount && Math.abs(result.amount - Number(form.amount)) > 0.01) {
          note += ` Heads up: the screenshot shows ${result.amount}, but you entered ${currency(Number(form.amount))} — double-check the amount before submitting.`
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

  async function submit(e) {
    e.preventDefault()
    setError('')
    setCanRetry(false)
    if (isCbe && !form.receiptUrl) {
      setError('Upload your CBE e-receipt (or paste a link to it) before submitting.')
      return
    }
    if (!isCbe && !form.txnId.trim()) {
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
        fundId: contribute?.id,
        amount: Number(form.amount),
        payerName: form.payerName.trim(),
        reason: form.reason.trim() || `Contribution to ${contribute?.name || ''}`,
        receiptAmount,
        paymentMethodId: selectedMethod?.id || undefined,
        provider: selectedMethod ? PROVIDER_TO_HINT[selectedMethod.provider] : undefined,
        txnId: isCbe ? undefined : form.txnId.trim(),
        phoneNumber: needsPhone ? form.phoneNumber.trim() : undefined,
        receiptUrl: isCbe ? form.receiptUrl : undefined,
        receiptReference: isCbe ? (receiptReference || undefined) : undefined,
      })
      setSuccessStatus(payment?.status || 'paid')
      setSuccessReviewFlags(payment?.reviewFlags || '')
      setPhase('success')
    } catch (err) {
      const isNetworkError = !err?.response
      setError(
        err?.response?.data?.message ||
        (isNetworkError
          ? "Couldn't reach the server. Check your connection and try again."
          : err.message || 'Could not verify this payment.')
      )
      setCanRetry(isNetworkError || err?.response?.status >= 500)
      setPhase('form')
    }
  }

  return (
    <div>
      <PageHeader title="Community Funds" subtitle={`Transparent balances totalling ${currency(total)}`} />
      {enriched.length === 0 ? (
        <div className="card"><EmptyState icon={Landmark} title="No funds yet" subtitle="Your committee hasn't set up any community funds yet — check back soon." /></div>
      ) : (
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {enriched.map((f) => (
          <div key={f.id} className="card p-5">
            <div className={`h-11 w-11 rounded-2xl bg-gradient-to-br ${catColors[f.category] || catColors.Security} flex items-center justify-center shadow-glow`}>
              <Landmark className="h-5 w-5 text-white" />
            </div>
            <p className="mt-4 font-semibold text-ink-800">{f.name}</p>
            <span className="badge bg-ink-100 text-ink-600 mt-1">{f.category}</span>
            <p className="mt-4 text-2xl font-bold font-display text-ink-900">{currencyBalance(f.actualBalance, 'short')}</p>
            <p className="text-xs text-ink-400">Actually collected, minus spent</p>
            <p className="mt-1 text-xs text-ink-400">
              Budgeted: <span className="font-medium text-ink-500">{currency(f.budgetRemaining)}</span> remaining of {currency(f.budgetAllocated)}
            </p>

            <div className="mt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between text-ink-500">
                <span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Collected</span>
                <span className="font-semibold text-ink-800">{currency(f.collected)}</span>
              </div>
              {f.goal ? (
                <>
                  <div className="flex items-center justify-between text-ink-500">
                    <span className="flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-brand-500" /> Goal</span>
                    <span className="font-semibold text-ink-800">{currency(f.goal)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                    <div className="h-full bg-brand-gradient" style={{ width: `${f.pct}%` }} />
                  </div>
                </>
              ) : (
                <p className="text-ink-400 italic">No goal set yet for this fund.</p>
              )}
              <div className="flex items-center justify-between text-ink-500">
                <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-ink-400" /> Contributors</span>
                <span className="font-semibold text-ink-800">{f.contributors} paid · {f.nonContributors} haven't</span>
              </div>
            </div>

            <button
              onClick={() => openContribute(f)}
              className="mt-4 w-full btn-secondary"
            >
              <HandCoins className="h-4 w-4" /> Contribute
            </button>
          </div>
        ))}
      </div>
      )}

      <div className="card overflow-hidden mt-5">
        <div className="px-5 py-4 border-b border-ink-50">
          <h3 className="font-semibold text-ink-800">My contributions</h3>
          <p className="text-xs text-ink-400 mt-0.5">Every direct fund contribution you've made, and where it stands right now.</p>
        </div>
        {myContributions.length === 0 ? (
          <EmptyState icon={HandCoins} title="No contributions yet" subtitle='Use "Contribute" on any fund above to make your first one.' />
        ) : (
          <div className="table-wrap !border-0">
            <table className="data-table">
              <thead><tr><th>Fund</th><th>Amount</th><th>Date</th><th>Reference</th><th>Status</th></tr></thead>
              <tbody>
                {pagedContributions.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-ink-800">{fundOf(p.fundId)?.name || '—'}</td>
                    <td className="font-semibold">{currency(p.amount)}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="font-mono text-xs text-ink-400">{p.reference}</td>
                    <td>
                      <Badge status={p.status} />
                      {p.status === 'pending_review' && p.reviewFlags && (
                        <p className="mt-1 text-[11px] text-amber-600 max-w-xs">{p.reviewFlags}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={contribPage} totalPages={contribTotalPages} total={contribTotal} onChange={setContribPage} pageSize={20} />
          </div>
        )}
      </div>

      <Modal open={!!contribute} onClose={closeModal} title={`Contribute to ${contribute?.name || ''}`} dismissible={phase !== 'verifying'} wide>
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
              <button onClick={() => setContribute(null)} className="btn-primary mt-6">Done</button>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center">
                <ShieldCheck className="h-7 w-7 text-emerald-600" />
              </div>
              <p className="mt-4 text-lg font-bold text-ink-900">Contribution recorded</p>
              <p className="mt-1 text-sm text-ink-500">
                Your bank transaction was verified and this contribution has been added to {contribute?.name}.
              </p>
              <button onClick={() => setContribute(null)} className="btn-primary mt-6">Done</button>
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
            <p className="text-sm text-ink-500 -mt-1">Give any amount you'd like — it goes straight to this fund.</p>

            <div>
              <label className="label">Amount (ETB)</label>
              <input
                required type="number" min={1} step="0.01" autoFocus className="input"
                placeholder="e.g. 500"
                value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
              {receiptAmount != null && form.amount && Math.abs(receiptAmount - Number(form.amount)) > 0.01 && (
                <p className="mt-1.5 text-xs text-amber-600">
                  Your uploaded receipt appears to show {currency(receiptAmount)}, which doesn't match this amount — this will be sent for admin review instead of auto-approved.
                </p>
              )}
            </div>

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
                <CopyRow label="Amount" value={form.amount ? currency(Number(form.amount)) : '—'} />
              </div>
            </div>

            {activeMethods.length > 0 && (
              <div>
                <label className="label">Pay with</label>
                <select required className="input" value={form.paymentMethodId} onChange={(e) => selectMethod(e.target.value)}>
                  {activeMethods.map((m) => (
                    <option key={m.id} value={m.id}>{m.label} · {PROVIDER_LABELS[m.provider] || m.provider}</option>
                  ))}
                </select>
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
              <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3.5">
                <label className="label !mb-1.5">CBE e-receipt</label>
                <p className="text-xs text-ink-400 mb-2.5">
                  Upload the screenshot or PDF receipt from your transfer, or paste a link to it — we'll
                  read the QR code and verify it automatically. If we can't read it, a committee admin
                  will confirm it against this contribution instead.
                </p>
                <div className="flex gap-1.5 mb-2.5">
                  <button
                    type="button"
                    onClick={() => { setReceiptMode('upload'); setReceiptLink(''); setReceiptReference(''); setForm((f) => ({ ...f, receiptUrl: undefined })) }}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${receiptMode === 'upload' ? 'bg-brand-600 text-white' : 'bg-white text-ink-500 ring-1 ring-ink-200'}`}
                  >
                    Upload file
                  </button>
                  <button
                    type="button"
                    onClick={() => { setReceiptMode('link'); setReceiptFileName(''); setReceiptReference(''); setForm((f) => ({ ...f, receiptUrl: undefined })) }}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${receiptMode === 'link' ? 'bg-brand-600 text-white' : 'bg-white text-ink-500 ring-1 ring-ink-200'}`}
                  >
                    Paste a link
                  </button>
                </div>
                {receiptMode === 'upload' ? (
                  <>
                    <input ref={receiptInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={handleReceiptUpload} />
                    <button
                      type="button"
                      onClick={() => receiptInputRef.current?.click()}
                      disabled={receiptUploading}
                      className="w-full flex items-center justify-center gap-2 text-sm font-medium text-ink-600 hover:text-brand-700 disabled:opacity-50"
                    >
                      {receiptUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : (form.receiptUrl ? <FileCheck2 className="h-4 w-4 text-emerald-600" /> : <Upload className="h-4 w-4" />)}
                      {receiptUploading ? 'Uploading…' : form.receiptUrl ? `Uploaded: ${receiptFileName}` : 'Choose a screenshot or PDF'}
                    </button>
                    {form.receiptUrl && !receiptUploading && (
                      <p className={`mt-1.5 text-xs ${receiptReference ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {receiptReference
                          ? 'QR code read successfully — this can be verified automatically.'
                          : "Couldn't read a QR code off this file — it'll be queued for manual review."}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                    <input
                      className="input pl-9"
                      placeholder="https://mbreciept.cbe.com.et/…"
                      value={receiptLink}
                      onChange={(e) => {
                        const value = e.target.value
                        setReceiptLink(value)
                        const trimmed = value.trim()
                        setForm((f) => ({ ...f, receiptUrl: trimmed || undefined }))
                        setReceiptReference(trimmed)
                      }}
                    />
                  </div>
                )}
                {receiptUploadError && <p className="mt-2 text-xs text-center text-rose-600">{receiptUploadError}</p>}
              </div>
            ) : (
              <div>
                <label className="label">{isTelebirr ? 'Reference number' : 'Transaction ID'}</label>
                <input
                  required
                  className="input font-mono"
                  placeholder="From your bank's transfer confirmation"
                  value={form.txnId}
                  onChange={(e) => setForm({ ...form, txnId: e.target.value })}
                />
              </div>
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
                placeholder={`e.g. Contribution to ${contribute?.name || 'this fund'}`}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            <div className="rounded-xl border border-dashed border-ink-200 p-3.5">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleScreenshot} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={ocrLoading}
                className="w-full flex items-center justify-center gap-2 text-sm font-medium text-ink-600 hover:text-brand-700 disabled:opacity-50"
              >
                {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {ocrLoading ? 'Reading screenshot…' : 'Upload a screenshot to autofill name & transaction ID'}
              </button>
              {ocrNote && <p className="mt-2 text-xs text-center text-ink-500">{ocrNote}</p>}
            </div>

            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-600">
                <div className="flex items-start justify-between gap-3">
                  <span>{error}</span>
                  {canRetry && (
                    <button
                      type="button"
                      onClick={submit}
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
              <button type="submit" className="btn-primary flex-1">Submit contribution</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
