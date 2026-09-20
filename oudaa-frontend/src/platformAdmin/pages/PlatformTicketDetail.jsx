import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Lock, AlertTriangle, Loader2, Send, ExternalLink } from 'lucide-react'
import platformApi, { platformEndpoints } from '../lib/platformApi'

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'ESCALATED', 'RESOLVED', 'CLOSED']
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const CATEGORIES = ['ACCOUNT', 'PAYMENT', 'COMMUNITY', 'TECHNICAL', 'SECURITY', 'FINANCIAL', 'BUG', 'FEATURE_REQUEST', 'OTHER']

function fmt(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleString() : '—'
}

export default function PlatformTicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [isInternalNote, setIsInternalNote] = useState(false)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await platformApi.get(platformEndpoints.supportTicketDetail(id))
      setTicket(data.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load ticket')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function updateField(endpointFn, field, value) {
    try {
      await platformApi.patch(endpointFn(id), { [field]: value })
      load()
    } catch (err) {
      setError(err.response?.data?.message || 'Update failed')
    }
  }

  async function handleEscalate() {
    try {
      await platformApi.post(platformEndpoints.supportTicketEscalate(id))
      load()
    } catch (err) {
      setError(err.response?.data?.message || 'Escalation failed')
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    try {
      await platformApi.post(platformEndpoints.supportTicketMessages(id), { body: reply, isInternalNote })
      setReply('')
      load()
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-ink-500"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading ticket…</div>
  }
  if (error && !ticket) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        {error}
      </div>
    )
  }
  if (!ticket) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Main column: subject, conversation, reply box */}
      <div className="lg:col-span-2 space-y-4">
        <button onClick={() => navigate('/platform-admin/support')} className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200">
          <ArrowLeft className="w-4 h-4" /> Back to inbox
        </button>

        <div>
          <h1 className="text-lg font-semibold text-white">{ticket.subject}</h1>
          <p className="text-sm text-ink-400 mt-1">{ticket.description}</p>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Conversation — customer messages and internal notes always
            visually distinguished (Phase 4's explicit requirement), never
            ambiguous which is which. */}
        <div className="rounded-xl border border-ink-700 divide-y divide-ink-800">
          {ticket.messages.length === 0 && <div className="px-4 py-6 text-sm text-ink-500 text-center">No messages yet.</div>}
          {ticket.messages.map((m) => {
            const isNote = m.isInternalNote
            const authorName = m.authorPlatformAdmin?.fullName || m.authorUser?.fullName || 'Unknown'
            return (
              <div key={m.id} className={`px-4 py-3 ${isNote ? 'bg-amber-500/5' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-ink-300">{authorName}</span>
                  {isNote ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      <Lock className="w-3 h-3" /> Internal platform note
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 text-[10px] font-medium text-teal-400">
                      Customer message
                    </span>
                  )}
                  <span className="text-[11px] text-ink-600 ml-auto">{fmt(m.createdAt)}{m.editedAt ? ' (edited)' : ''}</span>
                </div>
                <p className="text-sm text-ink-200 whitespace-pre-wrap">{m.body}</p>
              </div>
            )
          })}
        </div>

        {/* Reply / note composer */}
        <form onSubmit={handleSend} className="rounded-xl border border-ink-700 p-3 space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder={isInternalNote ? 'Write an internal note (never seen by the user)…' : 'Write a reply to the user…'}
            className="w-full rounded-lg bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-ink-400">
              <input type="checkbox" checked={isInternalNote} onChange={(e) => setIsInternalNote(e.target.checked)} />
              Internal note (not visible to the user)
            </label>
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition px-3 py-1.5 text-sm font-medium text-white"
            >
              <Send className="w-3.5 h-3.5" /> {isInternalNote ? 'Add note' : 'Send reply'}
            </button>
          </div>
        </form>
      </div>

      {/* Sidebar: ticket controls + quick-navigation context */}
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-700 p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Ticket</h2>
          <Field label="Status">
            <select value={ticket.status} onChange={(e) => updateField(platformEndpoints.supportTicketStatus, 'status', e.target.value)} className="w-full rounded-lg bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100">
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={ticket.priority} onChange={(e) => updateField(platformEndpoints.supportTicketPriority, 'priority', e.target.value)} className="w-full rounded-lg bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select value={ticket.category} onChange={(e) => updateField(platformEndpoints.supportTicketCategory, 'category', e.target.value)} className="w-full rounded-lg bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Assigned to">
            <p className="text-sm text-ink-300">{ticket.assignedTo?.fullName || 'Unassigned'}</p>
          </Field>
          {ticket.status !== 'ESCALATED' && (
            <button onClick={handleEscalate} className="w-full rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition px-3 py-1.5 text-sm font-medium">
              Escalate
            </button>
          )}
        </div>

        <div className="rounded-xl border border-ink-700 p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Context</h2>
          <ContextLink label="User" to={`/platform-admin/users/${ticket.user.id}`} value={ticket.user.fullName} />
          {ticket.community && <ContextLink label="Community" to={`/platform-admin/communities/${ticket.community.id}`} value={ticket.community.name} />}
          {ticket.context.communityAdmins?.map((a) => (
            <ContextLink key={a.id} label="Community admin" to={`/platform-admin/users/${a.id}`} value={a.fullName} />
          ))}
        </div>

        {ticket.context.recentPayments?.length > 0 && (
          <div className="rounded-xl border border-ink-700 p-4 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Recent payments</h2>
            {ticket.context.recentPayments.map((p) => (
              <Link key={p.id} to={ticket.community ? `/platform-admin/communities/${ticket.community.id}?tab=payments&paymentId=${encodeURIComponent(p.id)}` : '/platform-admin/communities'} className="flex items-center justify-between text-sm rounded-lg px-2 py-1.5 hover:bg-ink-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
                <span className="text-ink-300">{p.amount}</span>
                <span className="text-ink-500 text-xs">{p.status} · {fmt(p.paidAt)}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-ink-700 p-4 space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Ticket audit</h2><Link to={`/platform-admin/audit?entityId=${encodeURIComponent(ticket.id)}`} className="text-[10px] text-teal-300 hover:text-teal-200">View all</Link></div>
          {ticket.ticketAudit.length === 0 && <p className="text-xs text-ink-600">No changes recorded yet.</p>}
          {ticket.ticketAudit.slice(0, 6).map((a) => (
            <p key={a.id} className="text-xs text-ink-500">{a.description}</p>
          ))}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-ink-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

function ContextLink({ label, to, value }) {
  return (
    <Link to={to} className="flex items-center justify-between text-sm text-ink-300 hover:text-teal-400 transition group">
      <span>{label}: {value}</span>
      <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />
    </Link>
  )
}
