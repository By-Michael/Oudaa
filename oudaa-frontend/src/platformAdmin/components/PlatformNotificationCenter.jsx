import { useEffect, useState } from 'react'
import { Bell, Check, ExternalLink, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import platformApi, { platformEndpoints } from '../lib/platformApi'

function severityClass(severity) {
  if (severity === 'CRITICAL' || severity === 'ERROR') return 'border-red-500/30 bg-red-500/10'
  if (severity === 'WARNING') return 'border-amber-500/30 bg-amber-500/10'
  return 'border-ink-700 bg-ink-800'
}

export default function PlatformNotificationCenter() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const navigate = useNavigate()

  async function load() {
    try {
      const { data } = await platformApi.get(platformEndpoints.notifications())
      setItems(data.data || [])
      setUnread(data.unreadCount || 0)
    } catch (_e) { /* silent – polling; errors are non-fatal */ }
  }

  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id) }, [])

  async function markRead(id) {
    await platformApi.post(platformEndpoints.notificationRead(id)).catch(() => { /* silent */ })
    await load()
  }

  async function markAllRead() {
    await platformApi.post(platformEndpoints.notificationsReadAll()).catch(() => { /* silent */ })
    await load()
  }

  return (
    <div className="relative">
      <button onClick={() => { setOpen((v) => !v); if (!open) load() }} aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`} className="relative rounded-lg p-2 text-ink-300 hover:bg-ink-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
        <Bell className="w-5 h-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(92vw,420px)] rounded-xl border border-ink-700 bg-ink-900 shadow-card z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
            <div><div className="font-semibold text-white">Platform notifications</div><div className="text-xs text-ink-500">Operational events and alerts</div></div>
            <div className="flex items-center gap-1">
              {unread > 0 && <button onClick={markAllRead} className="text-xs text-teal-300 hover:text-teal-200 px-2 py-1">Mark all read</button>}
              <button onClick={() => setOpen(false)} className="p-1 text-ink-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {!items.length && <div className="p-6 text-sm text-ink-500 text-center">No notifications.</div>}
            {items.map((item) => (
              <div key={item.id} className={`border-b border-ink-800 p-3 ${item.readAt ? 'opacity-60' : ''}`}>
                <div className={`rounded-lg border p-3 ${severityClass(item.severity)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="text-sm font-semibold text-white">{item.title}</div><div className="mt-1 text-xs text-ink-300 leading-relaxed">{item.message}</div></div>
                    {!item.readAt && <button title="Mark read" onClick={() => markRead(item.id)} className="text-ink-400 hover:text-white"><Check className="w-4 h-4" /></button>}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
                    <span>{item.source || item.type || 'Platform'} · {new Date(item.createdAt).toLocaleString()}</span>
                    {item.route && <button onClick={() => { markRead(item.id); setOpen(false); navigate(item.route) }} className="inline-flex items-center gap-1 text-teal-300 hover:text-teal-200"><ExternalLink className="w-3 h-3" />Open</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
