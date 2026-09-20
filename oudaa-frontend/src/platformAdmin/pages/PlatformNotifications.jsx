import { useEffect, useState } from 'react'
import { Bell, Check, ExternalLink, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import platformApi, { platformEndpoints } from '../lib/platformApi'
import PlatformPageHeader from '../components/PlatformPageHeader'
import PlatformErrorNotice from '../components/PlatformErrorNotice'

function severityClass(severity) {
  if (severity === 'CRITICAL' || severity === 'ERROR') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (severity === 'WARNING') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  return 'border-ink-700 bg-ink-900 text-ink-200'
}

export default function PlatformNotifications() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const { data } = await platformApi.get(platformEndpoints.notifications(), { params: { limit: 100 } })
      setItems(data.data || []); setUnread(data.unreadCount || 0)
    } catch (err) { setError(err) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function markRead(id) {
    await platformApi.post(platformEndpoints.notificationRead(id)).catch(() => {})
    await load()
  }
  async function markAll() {
    await platformApi.post(platformEndpoints.notificationsReadAll()).catch(() => {})
    await load()
  }

  return (
    <div className="space-y-5 max-w-[1000px]">
      <PlatformPageHeader
        icon={Bell}
        title="Notification Center"
        description="Operational events, escalations, service failures, security signals, and maintenance activity."
        actions={unread > 0 ? <button onClick={markAll} className="btn-secondary text-xs"><Check className="w-3.5 h-3.5" />Mark all read ({unread})</button> : null}
      />
      {error && <PlatformErrorNotice error={error} onRetry={load} onDismiss={() => setError(null)} />}
      {loading && <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 text-ink-500 animate-spin" /></div>}
      {!loading && !items.length && <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-12 text-center text-sm text-ink-500">No active notifications.</div>}
      {!loading && items.length > 0 && <div className="space-y-2">{items.map((item) => (
        <article key={item.id} className={`rounded-xl border p-4 ${item.readAt ? 'opacity-60' : ''} ${severityClass(item.severity)}`}>
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.title}</h2><span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-wide">{item.severity}</span>{!item.readAt && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px]">Unread</span>}</div>
              <p className="mt-1.5 text-sm leading-6 text-ink-300">{item.message}</p>
              <div className="mt-2 text-[11px] text-ink-500">{item.type} · {new Date(item.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!item.readAt && <button onClick={() => markRead(item.id)} className="btn-ghost text-xs"><Check className="w-3.5 h-3.5" />Read</button>}
              {item.route && <button onClick={() => { markRead(item.id); navigate(item.route) }} className="btn-ghost text-xs"><ExternalLink className="w-3.5 h-3.5" />Open</button>}
            </div>
          </div>
        </article>
      ))}</div>}
    </div>
  )
}
