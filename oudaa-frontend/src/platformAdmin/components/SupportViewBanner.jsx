import { ShieldAlert, X, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'
import platformApi, { platformEndpoints } from '../lib/platformApi'

/**
 * Persistent banner rendered at the top of every page while a support view
 * session is active. Displays the operator's identity, the target user's
 * identity, and a countdown to automatic expiry.
 *
 * This is ALWAYS read-only — the banner itself enforces nothing, but the
 * server enforces it for every API call.
 */
export default function SupportViewBanner({ session, onEnd }) {
  const [ending, setEnding] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(getSecondsLeft(session?.expiresAt))

  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      const left = getSecondsLeft(session.expiresAt)
      setSecondsLeft(left)
      if (left <= 0) {
        clearInterval(interval)
        onEnd?.()
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [session, onEnd])

  if (!session) return null

  async function handleEnd() {
    if (!window.confirm('End this support view session?')) return
    setEnding(true)
    try {
      await platformApi.delete(platformEndpoints.supportViewSession(session.id))
      onEnd?.()
    } catch {
      setEnding(false)
    }
  }

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const expiring = secondsLeft < 120 // highlight when < 2 min

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-4 px-5 py-3 bg-amber-500/20 border-b border-amber-500/40 backdrop-blur-sm">
      {/* Icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="text-sm font-semibold text-amber-300 tracking-wide uppercase">
          Support View
        </span>
        <span className="hidden sm:block text-sm text-amber-200">
          — You are viewing this account as a platform operator.
        </span>
      </div>

      {/* Target user identity */}
      <div className="hidden md:flex items-center gap-2 text-xs text-amber-200 min-w-0 shrink">
        <span className="text-amber-500">Viewing:</span>
        <span className="font-medium truncate">{session.targetEmail}</span>
        <span className="text-amber-500">·</span>
        <span className="text-amber-500">Operator:</span>
        <span className="font-medium truncate">{session.operatorEmail}</span>
      </div>

      {/* Countdown + end button */}
      <div className="flex items-center gap-3 shrink-0">
        <span className={`flex items-center gap-1 text-xs font-mono ${expiring ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}>
          <Clock className="w-3.5 h-3.5" />
          {mins}:{String(secs).padStart(2, '0')}
        </span>
        <button
          onClick={handleEnd}
          disabled={ending}
          className="flex items-center gap-1 rounded border border-amber-500/50 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          End session
        </button>
      </div>
    </div>
  )
}

function getSecondsLeft(expiresAt) {
  if (!expiresAt) return 0
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
}
