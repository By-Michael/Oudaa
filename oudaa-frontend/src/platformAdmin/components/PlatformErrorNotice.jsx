import { AlertTriangle, RefreshCw, X } from 'lucide-react'

export function getPlatformError(error, fallback = 'Something went wrong while loading this page.') {
  const response = error?.response?.data
  return {
    message: response?.message || error?.message || fallback,
    requestId: response?.requestId || error?.requestId || null,
    retryable: !response?.statusCode || response.statusCode >= 500 || error?.response?.status >= 500,
  }
}

export default function PlatformErrorNotice({ error, onRetry, onDismiss, compact = false }) {
  const parsed = typeof error === 'string' ? { message: error, requestId: null, retryable: false } : getPlatformError(error)
  return (
    <div className={`rounded-xl border border-red-500/30 bg-red-500/10 text-red-100 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-red-300 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{parsed.message}</div>
          {parsed.requestId && <div className="mt-1 text-[11px] text-red-200/70 font-mono break-all">Request ID: {parsed.requestId}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRetry && parsed.retryable && (
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-100 hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
            </button>
          )}
          {onDismiss && (
            <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="p-1.5 text-red-200/70 hover:text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
