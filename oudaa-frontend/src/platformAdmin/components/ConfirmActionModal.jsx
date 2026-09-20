import { useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

/**
 * Shared confirmation dialog for every privileged security/admin-management
 * action (disable admin, change role, require password reset, revoke
 * sessions, update security settings, ...). Collects the `reason` and
 * `confirm: true` the backend requires (see validators/platformAdmin/
 * platformAdminManagementValidators.js and platformSecurityValidators.js)
 * so the caller never has to build its own dialog for this.
 *
 * The server is the actual authority on whether this action is allowed
 * (permission + recent re-auth + confirm + reason) — this modal only
 * prevents accidental clicks and makes sure the API gets what it needs.
 */
export default function ConfirmActionModal({
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  requireReason = true,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (requireReason && reason.trim().length < 3) {
      setError('Please provide a brief reason (at least 3 characters).')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(err?.response?.data?.message || 'This action could not be completed.')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 shadow-card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
          <div className="flex items-center gap-2">
            {danger && <AlertTriangle className="w-4 h-4 text-red-400" />}
            <h3 className="font-semibold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-200 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {description && <p className="text-sm text-ink-300">{description}</p>}

          {requireReason && (
            <div>
              <label className="block text-xs font-medium text-ink-400 mb-1">Reason</label>
              <textarea
                autoFocus
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this action needed?"
                className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ink-700">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-sm text-ink-300 hover:bg-ink-700 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-60 ${
              danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-teal-600 hover:bg-teal-500 text-white'
            }`}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
