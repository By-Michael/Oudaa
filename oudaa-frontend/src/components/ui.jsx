import { useEffect, useMemo, useRef, useState } from 'react'
import { X, AlertTriangle, CheckCircle2, Info, Filter } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// ---------------------------------------------------------------------------
// In-app toast notifications — replaces native window.alert()/confirm()
// popups (which look like a browser chrome dialog, break the site's own
// look, and block the whole tab) with a small dismissible banner that stays
// inside the app. Call `notify('message', 'error' | 'success' | 'info')`
// from anywhere; <Toaster/> (mounted once in App.jsx) renders whatever is
// currently queued.
// ---------------------------------------------------------------------------
let toastId = 0
export function notify(message, type = 'error') {
  if (!message) return
  window.dispatchEvent(new CustomEvent('oudaa:toast', { detail: { id: ++toastId, message, type } }))
}

const TOAST_STYLES = {
  error: { icon: AlertTriangle, cls: 'bg-rose-50 border-rose-200 text-rose-700' },
  success: { icon: CheckCircle2, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  info: { icon: Info, cls: 'bg-brand-50 border-brand-200 text-brand-700' },
}

export function Toaster() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    function onToast(e) {
      const t = e.detail
      setToasts((prev) => [...prev, t])
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 5000)
    }
    window.addEventListener('oudaa:toast', onToast)
    return () => window.removeEventListener('oudaa:toast', onToast)
  }, [])

  function dismiss(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    // top-20 (not top-4) so toasts stack below the sticky topbar (h-16)
    // instead of overlapping its icons/dropdowns; z-[200] keeps them above
    // the topbar's own z-30/z-40 dropdown layers regardless of stacking
    // context quirks introduced by the topbar's backdrop-blur.
    <div className="fixed z-[200] top-20 right-4 flex flex-col gap-2 w-[calc(100%-2rem)] sm:w-full max-w-sm pointer-events-none">
      {toasts.map((t) => {
        const style = TOAST_STYLES[t.type] || TOAST_STYLES.error
        const Icon = style.icon
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg animate-fade-up ${style.cls}`}
          >
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-sm font-medium flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Shown in place of a chart/diagram while the full dataset it needs
// (payments/expenses/residents, paged in silently in the background — see
// DataContext's dataFullyLoaded) hasn't finished loading yet. Charts
// summarize the WHOLE dataset, so rendering them off a partial page would
// show numbers that are simply wrong until they jump/change later — better
// to show a lightweight placeholder for a moment than a misleading graph.
export function ChartPlaceholder({ height = 260, label = 'Crunching the numbers…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-ink-300" style={{ height }}>
      <span className="h-8 w-8 rounded-full border-2 border-ink-200 border-t-brand-500 dark:border-[#383838] dark:border-t-brand-400 animate-spin" />
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}

// Shown instead of ChartPlaceholder once loading has actually finished and
// the dataset behind a chart is just genuinely empty (a brand-new
// community with no payments/expenses yet, for example) — distinct from
// ChartPlaceholder's spinner so a new account doesn't look stuck loading
// forever when there's simply nothing to plot yet.
export function ChartEmptyState({ height = 260, icon: Icon, title = 'Nothing to show yet', body }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ height }}>
      {Icon && (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-ink-100 text-ink-400 dark:bg-white/[0.06] dark:text-ink-500">
          <Icon size={18} />
        </div>
      )}
      <span className="text-sm font-semibold text-ink-500 dark:text-ink-300">{title}</span>
      {body && <span className="max-w-xs text-xs text-ink-400">{body}</span>}
    </div>
  )
}

export function StatCard({ icon: Icon, label, value, sub, trend, accent = 'brand', to, onClick, loading = false }) {
  const accents = {
    brand: 'from-brand-500 to-brand-600',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    rose: 'from-rose-500 to-rose-600',
  }
  const navigate = useNavigate()
  const isInteractive = Boolean(to || onClick)
  const handleActivate = () => {
    if (onClick) onClick()
    else if (to) navigate(to)
  }
  return (
    <div
      className={`card p-5 hover:shadow-glow transition-shadow duration-300 group${isInteractive ? ' cursor-pointer hover:-translate-y-0.5 hover:ring-1 hover:ring-brand-200 transition-all' : ''}`}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={isInteractive ? handleActivate : undefined}
      onKeyDown={isInteractive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate() } } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>
          {loading ? (
            <>
              <span className="mt-2 block h-7 w-20 rounded-md bg-ink-100 animate-pulse" />
              <span className="mt-2 block h-3 w-28 rounded bg-ink-100 animate-pulse" />
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold font-display text-ink-900">{value}</p>
              {sub && <p className="mt-1 text-xs text-ink-400">{sub}</p>}
            </>
          )}
        </div>
        <div className={`h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br ${accents[accent]} flex items-center justify-center shadow-glow group-hover:scale-105 transition-transform`}>
          <Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
      </div>
      {trend && !loading && (
        <div className="mt-3 flex items-center gap-1 text-xs font-medium">
          <span className={trend.direction === 'up' ? 'text-emerald-600' : 'text-rose-500'}>
            {trend.direction === 'up' ? '▲' : '▼'} {trend.value}
          </span>
          <span className="text-ink-400">{trend.label}</span>
        </div>
      )}
    </div>
  )
}

export function Badge({ status }) {
  const map = {
    paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    verified: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    // Not shown as its own status anywhere — same look as plain "pending"
    // (see the label override below), just kept as a distinct value
    // internally for logic that depends on it (e.g. resident retract).
    pending_review: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    'in-progress': 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
    planned: 'bg-ink-100 text-ink-600 ring-1 ring-ink-200',
    inactive: 'bg-ink-100 text-ink-500 ring-1 ring-ink-200',
    overdue: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
    rejected: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
    cancelled: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
    unverified: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  }
  const dot = {
    paid: 'bg-emerald-500', active: 'bg-emerald-500', completed: 'bg-emerald-500', verified: 'bg-emerald-500',
    pending: 'bg-amber-500', pending_review: 'bg-amber-500', 'in-progress': 'bg-brand-500', planned: 'bg-ink-400', inactive: 'bg-rose-500',
    overdue: 'bg-rose-500', rejected: 'bg-rose-500', cancelled: 'bg-rose-500', unverified: 'bg-amber-500',
  }
  // "Needs review" is never surfaced as a status of its own — a payment
  // pending an admin's review still just reads "pending" to everyone.
  const label = status === 'pending_review' ? 'pending' : status
  return (
    <span className={`badge ${map[status] || map.planned}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status] || dot.planned}`} />
      {label?.replace('-', ' ')}
    </span>
  )
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterPopover — a single "Filter" button that opens a dropdown panel of
// detailed filter fields (search, selects, date ranges, etc). Replaces rows
// of always-visible filter controls with one compact control per table.
//
// - `active`  — count of currently-applied filters; drives the badge and
//               whether the little inline "x" clear button appears.
// - `onClear` — resets every filter for this table back to its default.
// - `children` — the actual filter fields, laid out by the caller (usually
//               inside a <FilterGrid> for a responsive multi-column layout).
//
// The panel closes on outside click and on Escape, and always exposes a
// "Clear all" action at the bottom in addition to the quick inline "x".
// ---------------------------------------------------------------------------
export function FilterPopover({ active = 0, onClear, label = 'Filter', children, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onDocPointer(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`btn-secondary text-xs !pl-3 ${active > 0 ? '!pr-1.5' : '!pr-3'} ${active > 0 ? 'border-brand-300 text-brand-700 bg-brand-50' : ''}`}
        aria-expanded={open}
      >
        <Filter className="h-3.5 w-3.5" />
        {label}
        {active > 0 && (
          <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold leading-none">
            {active}
          </span>
        )}
        {active > 0 && (
          <span
            role="button"
            aria-label="Clear filters"
            title="Clear filters"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClear?.() }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClear?.() } }}
            className="ml-1 flex items-center justify-center h-4 w-4 rounded-full hover:bg-brand-100 text-brand-500 transition"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-30 top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-2 w-[min(94vw,620px)] card p-4 shadow-xl border border-ink-100 animate-fade-up`}
        >
          {children}
          <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-ink-100">
            {active > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="flex items-center gap-1 text-xs text-ink-400 hover:text-rose-600 transition"
              >
                <X className="h-3.5 w-3.5" /> Clear all
              </button>
            ) : <span />}
            <button type="button" onClick={() => setOpen(false)} className="btn-primary !py-1.5 text-xs">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Responsive grid used inside a FilterPopover panel to lay out mixed field
// types (text inputs, selects, date pickers) evenly.
export function FilterGrid({ children }) {
  return <div className="grid sm:grid-cols-2 gap-3">{children}</div>
}

// Labelled wrapper for a single field inside a FilterPopover panel.
export function FilterField({ label, full, children }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

const filterFieldCls = 'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 transition dark:bg-[#1e1e1e] dark:border-[#383838] dark:text-ink-100'

// Compact text input for use inside a FilterField/FilterGrid.
export function FilterTextInput({ value, onChange, placeholder }) {
  return (
    <input
      className={filterFieldCls}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// Compact <select> for use inside a FilterField/FilterGrid.
export function FilterSelectInput({ value, onChange, options }) {
  return (
    <select className={filterFieldCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  )
}

// Compact date input for use inside a FilterField/FilterGrid.
export function FilterDateInput({ value, onChange }) {
  return (
    <input type="date" className={filterFieldCls} value={value} onChange={(e) => onChange(e.target.value)} />
  )
}

// Compact number input (for amount/budget ranges) for use inside a
// FilterField/FilterGrid.
export function FilterNumberInput({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={filterFieldCls}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Modal({ open, onClose, title, children, wide, dismissible = true }) {
  // Lock the page behind the modal while it's open — otherwise the mouse
  // wheel / trackpad keeps scrolling the (invisible, but still there) body
  // underneath the overlay, which then jumps back into view scrolled to a
  // different spot once the modal closes.
  useEffect(() => {
    if (!open) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Clicking the backdrop intentionally does NOT close the modal — only
          the explicit X (or a Cancel button in the form) does, so an
          accidental click outside a half-filled form never discards it. */}
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-md'} card p-6 animate-fade-up max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          {dismissible && (
            <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title = 'Are you sure?', message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true, loading = false, error = '', onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop click intentionally does not cancel — same reasoning as Modal above. */}
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm card p-6 animate-fade-up">
        <h3 className="text-lg font-bold text-ink-900">{title}</h3>
        {message && <p className="mt-2 text-sm text-ink-500">{message}</p>}
        {error && (
          <p className="mt-3 text-sm text-rose-600 bg-rose-50 ring-1 ring-rose-100 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-600 hover:bg-ink-100 transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Shown in place of a page's content while its first data load is still in
// flight, so the user sees "this is loading" instead of a flash of empty
// tables/zeroed stats that then suddenly pop to real numbers a moment
// later. Only meant for the very first load — see AppLayout, which stops
// showing this once the first fetch (success or failure) has completed.
export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading your data…">
      <div className="h-7 w-56 rounded-lg bg-ink-100 mb-2" />
      <div className="h-4 w-80 rounded-lg bg-ink-100 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-5 h-24 bg-ink-50" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="card p-5 xl:col-span-2 h-64 bg-ink-50" />
        <div className="card p-5 h-64 bg-ink-50" />
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="h-14 w-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
        <Icon className="h-7 w-7 text-brand-500" />
      </div>
      <h3 className="text-base font-semibold text-ink-800">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-ink-400 max-w-sm">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// Debounces a fast-changing value (typically a search input) so expensive
// work derived from it — filtering thousands of rows, refetching, etc —
// only runs after the user pauses typing, instead of on every keystroke.
export function useDebouncedValue(value, delayMs = 200) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

// Client-side pagination for big in-memory lists (residents, payments,
// expenses, etc). The full filtered array is still what totals/reports are
// computed from — this only limits how many rows get rendered into the
// DOM at once, which is what actually got slow with thousands of rows.
// Resets to page 1 whenever the underlying item count changes (e.g. a new
// search query narrows the list) so you're never stuck looking at an
// empty page 7 of 2 results.
export function usePagedList(items, pageSize = 50) {
  const [page, setPage] = useState(1)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize])

  useEffect(() => { setPage(1) }, [total])

  return { pageItems, page: safePage, totalPages, total, setPage }
}

export function Pager({ page, totalPages, total, onChange, pageSize = 50 }) {
  if (totalPages <= 1) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-ink-100 text-xs text-ink-400">
      <span>Showing {start}–{end} of {total}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-lg border border-ink-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ink-50"
        >Prev</button>
        <span className="px-2 font-medium text-ink-600">{page} / {totalPages}</span>
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-lg border border-ink-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ink-50"
        >Next</button>
      </div>
    </div>
  )
}

export function currency(n) {
  return new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(n || 0)
}

// For balances where a negative number is an expected, normal state (e.g. a
// fund that hasn't finished collecting against its budget yet) rather than
// an error — shows the magnitude without a leading "-" so it doesn't read
// as a danger/error signal. Pass a `shortfallLabel` to say so in words
// instead, e.g. currencyBalance(f.actualBalance, 'short of budget').
export function currencyBalance(n, shortfallLabel) {
  const amount = currency(Math.abs(n || 0))
  if ((n || 0) >= 0) return amount
  return shortfallLabel ? `${amount} ${shortfallLabel}` : amount
}

export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
