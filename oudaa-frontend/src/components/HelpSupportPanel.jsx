import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Search, HelpCircle, Sparkles, Send, Bookmark, BookmarkCheck,
  History, Trash2, Plus, ChevronDown, Loader2, Mail,
} from 'lucide-react'
import api, { endpoints } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { notify } from './ui'

// Full-screen (mobile) / centered wide modal (desktop) panel — deliberately
// its own overlay rather than reusing <Modal> from ui.jsx, since the chat
// view needs a fixed-height scrollable message list + pinned input, which
// Modal's auto-growing "card" layout isn't built for.
export default function HelpSupportPanel({ open, onClose }) {
  const { user } = useAuth()
  const [tab, setTab] = useState('faq') // 'faq' | 'chat'

  useEffect(() => {
    if (!open) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [open])

  // Reset to the FAQ tab each time the panel is freshly opened, so a
  // half-finished chat isn't hidden behind a tab the user forgot they left.
  useEffect(() => { if (open) setTab('faq') }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl h-[92vh] sm:h-[85vh] card rounded-b-none sm:rounded-2xl flex flex-col overflow-hidden animate-fade-up">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-ink-100 dark:border-[#2e2e2e]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-glow">
              <HelpCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink-900 leading-tight">Help &amp; Support</h3>
              <p className="text-xs text-ink-400 leading-tight">Answers, or ask Oudaa AI directly</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition dark:hover:bg-[#2a2a2a]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex gap-1 px-4 pt-3">
          <TabButton active={tab === 'faq'} onClick={() => setTab('faq')} icon={HelpCircle} label="FAQ" />
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={Sparkles} label="Ask Oudaa AI" />
        </div>

        <div className="flex-1 min-h-0">
          {tab === 'faq' ? <FaqTab onAskAi={() => setTab('chat')} /> : <ChatTab userName={user?.name} />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
          : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-200'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// FAQ tab
// ---------------------------------------------------------------------------

function FaqTab({ onAskAi }) {
  const [faqs, setFaqs] = useState(null)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.get(endpoints.supportFaqs())
      .then(({ data }) => { if (!cancelled) setFaqs(data.data || []) })
      .catch(() => { if (!cancelled) setFaqs([]) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    if (!faqs) return []
    const q = query.trim().toLowerCase()
    if (!q) return faqs
    return faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q) || f.category.toLowerCase().includes(q))
  }, [faqs, query])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const f of filtered) {
      if (!map.has(f.category)) map.set(f.category, [])
      map.get(f.category).push(f)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help topics…"
            className="input pl-9 py-2.5 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
        {faqs === null ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-brand-500" /></div>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-10">No matching topics. Try asking Oudaa AI instead.</p>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-400 mb-2">{category}</p>
              <div className="space-y-1.5">
                {items.map((f) => (
                  <div key={f.id} className="rounded-xl border border-ink-100 dark:border-[#2e2e2e] overflow-hidden">
                    <button
                      onClick={() => setOpenId(openId === f.id ? null : f.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-ink-800 dark:text-ink-100 hover:bg-brand-50/50 dark:hover:bg-brand-500/5 transition-colors"
                    >
                      {f.question}
                      <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${openId === f.id ? 'rotate-180' : ''}`} />
                    </button>
                    {openId === f.id && (
                      <div className="px-4 pb-3.5 text-sm text-ink-500 dark:text-ink-400 leading-relaxed">{f.answer}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Attractive, obvious escape hatch to the AI when the FAQ doesn't cover it. */}
      <div className="shrink-0 p-4 border-t border-ink-100 dark:border-[#2e2e2e]">
        <button
          onClick={onAskAi}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient text-white font-semibold text-sm py-3 shadow-glow hover:brightness-[1.06] active:brightness-95 transition-all"
        >
          <Sparkles className="h-4.5 w-4.5" />
          Didn't find it? Ask Oudaa AI
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------

function ChatTab({ userName }) {
  const [messages, setMessages] = useState([]) // {role:'user'|'assistant', content}
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [saveEnabled, setSaveEnabled] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState(null)
  const [aiConfigured, setAiConfigured] = useState(true)
  const listRef = useRef(null)

  useEffect(() => {
    api.get(endpoints.supportAiStatus())
      .then(({ data }) => setAiConfigured(Boolean(data.data?.configured)))
      .catch(() => setAiConfigured(true)) // fail open on the status check itself; the real chat call will surface a clear error if it's actually down
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  function loadSessions() {
    setSessions(null)
    api.get(endpoints.supportChatSessions())
      .then(({ data }) => setSessions(data.data || []))
      .catch(() => setSessions([]))
  }

  function toggleHistory() {
    const next = !showHistory
    setShowHistory(next)
    if (next) loadSessions()
  }

  function startNewChat() {
    setMessages([])
    setSessionId(null)
    setSaveEnabled(false)
    setShowHistory(false)
  }

  async function openSession(id) {
    try {
      const { data } = await api.get(endpoints.supportChatSession(id))
      setMessages(data.data.messages.map((m) => ({ role: m.role, content: m.content })))
      setSessionId(data.data.id)
      setSaveEnabled(true)
      setShowHistory(false)
    } catch {
      notify('Could not load that conversation')
    }
  }

  async function deleteSession(id, e) {
    e.stopPropagation()
    try {
      await api.delete(endpoints.supportChatSession(id))
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (sessionId === id) startNewChat()
    } catch {
      notify('Could not delete that conversation')
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    const nextMessages = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setSending(true)

    try {
      // Already-saved conversation: the server holds the history, so just
      // send the new message + sessionId and let it persist both turns.
      if (saveEnabled && sessionId) {
        const { data } = await api.post(endpoints.supportChat(), { message: text, sessionId })
        setMessages((prev) => [...prev, { role: 'assistant', content: data.data.reply }])
        return
      }

      // Otherwise stateless — send the client-held history alongside the
      // new message. Nothing touches the database yet.
      const { data } = await api.post(endpoints.supportChat(), { message: text, history: messages })
      const reply = data.data.reply
      const finalMessages = [...nextMessages, { role: 'assistant', content: reply }]
      setMessages(finalMessages)

      // If the user has "save this conversation" turned on and we don't
      // have a session yet, create one now with the full transcript so
      // far — this is the one and only moment a SupportChatSession row
      // gets created.
      if (saveEnabled && !sessionId) {
        const { data: saved } = await api.post(endpoints.supportChatSessions(), { messages: finalMessages })
        setSessionId(saved.data.id)
      }
    } catch (err) {
      const msg = err?.response?.data?.message || 'Something went wrong reaching Oudaa AI. Please try again.'
      notify(msg)
      setMessages((prev) => prev) // leave the user's message visible; just don't add a reply
    } finally {
      setSending(false)
    }
  }

  async function handleToggleSave(next) {
    setSaveEnabled(next)
    // Turning save on mid-conversation with existing local-only messages:
    // persist what's there now so nothing already said is lost.
    if (next && !sessionId && messages.length > 0) {
      try {
        const { data } = await api.post(endpoints.supportChatSessions(), { messages })
        setSessionId(data.data.id)
      } catch {
        notify('Could not save this conversation')
        setSaveEnabled(false)
      }
    }
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Sub-header: save toggle + history */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-2.5 border-b border-ink-100 dark:border-[#2e2e2e]">
        <button
          onClick={() => handleToggleSave(!saveEnabled)}
          title={saveEnabled ? 'This conversation is being saved' : 'Save this conversation'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            saveEnabled
              ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300'
              : 'bg-ink-100 text-ink-500 hover:bg-ink-200 dark:bg-[#2a2a2a] dark:text-ink-400'
          }`}
        >
          {saveEnabled ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {saveEnabled ? 'Saving' : 'Save chat'}
        </button>

        <div className="flex items-center gap-1.5">
          <button onClick={startNewChat} title="New chat" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition dark:hover:bg-[#2a2a2a]">
            <Plus className="h-4 w-4" />
          </button>
          <button onClick={toggleHistory} title="Saved conversations" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition dark:hover:bg-[#2a2a2a]">
            <History className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="absolute right-4 top-14 z-10 w-72 max-h-80 overflow-y-auto card p-2 shadow-lg">
          <p className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">Saved conversations</p>
          {sessions === null ? (
            <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-brand-500" /></div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-400">No saved conversations yet.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => openSession(s.id)}
                className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors group"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">{s.title}</span>
                  <span className="block text-[11px] text-ink-400">{s.messageCount} messages</span>
                </span>
                <span onClick={(e) => deleteSession(s.id, e)} className="shrink-0 rounded p-1 text-ink-300 opacity-0 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition">
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
            <div className="h-12 w-12 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-glow">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
              Hi{userName ? ` ${userName.split(' ')[0]}` : ''}, I'm Oudaa AI.
            </p>
            <p className="text-sm text-ink-400 max-w-xs">
              Ask me how anything in the platform works — or, if you're on the committee, ask about your community's own data, like who hasn't paid this month.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}
        {sending && <ChatBubble role="assistant" content="" typing />}
      </div>

      {!aiConfigured && (
        <div className="shrink-0 mx-5 mb-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          The AI assistant isn\u2019t set up yet on this server — you can still browse the FAQ, or email support@oudaa.app.
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 p-4 border-t border-ink-100 dark:border-[#2e2e2e]">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Ask a question…"
            rows={1}
            className="input py-2.5 resize-none max-h-28"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="shrink-0 h-11 w-11 rounded-xl bg-brand-gradient text-white flex items-center justify-center shadow-glow hover:brightness-[1.06] active:brightness-95 transition-all disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ role, content, typing }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-brand-gradient text-white rounded-br-sm'
            : 'bg-ink-100 text-ink-800 rounded-bl-sm dark:bg-[#2a2a2a] dark:text-ink-100'
        }`}
      >
        {typing ? (
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
          </span>
        ) : content}
      </div>
    </div>
  )
}
