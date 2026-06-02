// Slate ↔ Claude shared chat. Three-way thread between Ryan, Caroline,
// and Claude. Workspace admins only. Phase 1: text-only. Phase 2 will
// surface tool calls + diff previews + a push-to-prod button.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ApiAgentConversation, type ApiAgentMessage } from '../api'
import { useAuth } from '../auth'

// Mirrors server/routes/agent.ts allowlist. The server enforces this
// via 403 — the page-level check just renders a clearer message.
const AGENT_ALLOWED_EMAILS = new Set<string>(['ryan@strawhutmedia.com'])
const AGENT_ALLOWED_NAME_PATTERNS = [/caroline/i]

export default function AgentPage() {
  const { user } = useAuth()
  const email = (user?.email || '').toLowerCase()
  const name = (user?.display_name || user?.name || '').trim()
  const isAdmin =
    AGENT_ALLOWED_EMAILS.has(email) ||
    AGENT_ALLOWED_NAME_PATTERNS.some((rx) => rx.test(name))
  const [conversations, setConversations] = useState<ApiAgentConversation[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApiAgentMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  async function loadConversations() {
    try {
      const { conversations } = await api.agentConversations()
      setConversations(conversations)
      if (!activeId && conversations.length > 0) setActiveId(conversations[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }

  async function loadMessages(id: string) {
    try {
      const { messages } = await api.agentConversation(id)
      setMessages(messages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load messages')
    }
  }

  useEffect(() => { void loadConversations() }, [])
  useEffect(() => { if (activeId) void loadMessages(activeId) }, [activeId])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function startNew() {
    const title = prompt('Conversation title (optional):') || undefined
    try {
      const { conversation } = await api.agentCreateConversation(title || undefined)
      setConversations((prev) => [conversation, ...(prev ?? [])])
      setActiveId(conversation.id)
      setMessages([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  async function send() {
    if (!activeId || !draft.trim()) return
    const content = draft.trim()
    setSending(true); setError(null); setDraft('')
    try {
      const { userMessage, assistantMessage } = await api.agentSend(activeId, content)
      setMessages((prev) => [...prev, userMessage, assistantMessage])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to send')
      setDraft(content) // restore so they don't lose the draft
    } finally {
      setSending(false)
    }
  }

  async function removeConvo(id: string) {
    if (!confirm('Delete this conversation? The history is gone.')) return
    try {
      await api.agentDeleteConversation(id)
      setConversations((prev) => (prev ?? []).filter((c) => c.id !== id))
      if (activeId === id) {
        setActiveId(null)
        setMessages([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-muted text-sm">
        Slate ↔ Claude chat is locked to Ryan and Caroline only.{' '}
        <Link to="/" className="underline">Back to projects</Link>
      </div>
    )
  }

  const activeConvo = conversations?.find((c) => c.id === activeId) ?? null

  return (
    <div className="space-y-4">
      <div>
        <Link to="/" className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold">
          ← Home
        </Link>
        <h1 className="font-display text-4xl mt-2 text-rainbow">SLATE CHAT</h1>
        <p className="text-muted text-sm mt-1">
          Shared thread between Ryan, Caroline, and Claude. Everyone with admin access sees every
          message. Use this to ask how Slate works, describe changes you want, or sketch new
          features.{' '}
          <span className="text-muted/70">
            (Phase 1: chat-only — Claude can't ship code from here yet. Phase 2 wires that in.)
          </span>
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
        {/* Conversation list */}
        <aside className="rounded-2xl border border-line bg-panel/40 p-3 space-y-2 lg:sticky lg:top-24">
          <button
            onClick={() => void startNew()}
            className="w-full rounded-xl bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-3 py-2"
          >
            + New thread
          </button>
          {conversations === null ? (
            <p className="text-muted text-xs italic px-1">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="text-muted text-xs italic px-1">No conversations yet.</p>
          ) : (
            <ul className="space-y-1 max-h-[60vh] overflow-y-auto -mr-2 pr-2">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full text-left rounded-lg px-2.5 py-2 text-xs transition ${
                      activeId === c.id
                        ? 'bg-stage-mastering/10 border border-stage-mastering/40 text-text'
                        : 'border border-line/40 hover:border-line text-muted hover:text-text'
                    }`}
                  >
                    <div className="font-semibold truncate">{c.title}</div>
                    <div className="text-[10px] text-muted/60 mt-0.5">
                      {new Date(c.updatedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Active thread */}
        <section className="rounded-2xl border border-line bg-panel/40 min-h-[60vh] flex flex-col">
          {activeConvo ? (
            <>
              <header className="flex items-center justify-between gap-2 p-3 border-b border-line/60">
                <div className="text-sm font-bold truncate">{activeConvo.title}</div>
                <button
                  onClick={() => void removeConvo(activeConvo.id)}
                  className="text-[10px] uppercase tracking-wider text-muted hover:text-urgent border border-line rounded-full px-2 py-1"
                >
                  Delete
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <p className="text-muted text-sm italic text-center py-6">
                    Empty thread. Say hi 👋
                  </p>
                )}
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} currentUserId={user?.id ?? null} />
                ))}
                {sending && (
                  <div className="flex items-center gap-2 text-[11px] text-muted italic">
                    <span className="inline-block w-2 h-2 rounded-full bg-stage-mastering animate-pulse" />
                    Claude is thinking…
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <footer className="border-t border-line/60 p-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault(); void send()
                    }
                  }}
                  rows={3}
                  placeholder="Ask Claude anything about Slate, or describe a change you want…"
                  className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering resize-y"
                  disabled={sending}
                />
                <div className="flex items-center justify-between mt-2 text-[10px] text-muted">
                  <span>⌘↵ to send</span>
                  <button
                    onClick={() => void send()}
                    disabled={sending || !draft.trim()}
                    className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-4 py-1.5 disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex-1 grid place-items-center p-8 text-center text-muted text-sm">
              Pick a thread on the left, or tap + New thread to start one.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  currentUserId,
}: {
  message: ApiAgentMessage
  currentUserId: string | null
}) {
  const isAssistant = message.role === 'assistant'
  const isMine = !isAssistant && message.authorUserId === currentUserId
  const name = isAssistant ? 'Claude' : (message.authorDisplayName || 'Someone')
  const initial = name.charAt(0).toUpperCase()
  const translation = message.englishTranslation || null
  const lang = message.detectedLanguage || null
  const toolCalls = Array.isArray(message.toolCalls)
    ? (message.toolCalls as Array<{ id: string; name: string; input: Record<string, unknown> }>)
    : null
  return (
    <div className={`flex gap-3 ${isMine ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0 ${
        isAssistant
          ? 'bg-gradient-to-br from-stage-mastering via-stage-producing to-stage-tracking text-white'
          : 'bg-ink/60 border border-line text-text'
      }`}>
        {isAssistant ? '✦' : initial}
      </div>
      <div className={`flex-1 max-w-[80%] ${isMine ? 'text-right' : ''}`}>
        <div className={`text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-0.5 ${isMine ? 'text-right' : ''}`}>
          {name} <span className="opacity-50 ml-1">{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <div className={`inline-block rounded-2xl px-3.5 py-2.5 text-sm leading-snug whitespace-pre-wrap text-left ${
          isAssistant
            ? 'bg-stage-mastering/10 border border-stage-mastering/30 text-text'
            : isMine
              ? 'bg-gradient-to-br from-stage-tracking/30 to-stage-mastering/30 border border-stage-tracking/40 text-text'
              : 'bg-ink/40 border border-line text-text'
        }`}>
          {message.content}
        </div>
        {translation && (
          <div className={`mt-1 inline-block rounded-xl px-3 py-2 text-[12px] text-muted border border-line/60 bg-ink/30 text-left whitespace-pre-wrap ${isMine ? 'text-right' : ''}`}>
            <div className="text-[9px] uppercase tracking-wider text-muted/70 font-bold mb-0.5">
              English{lang ? ` (from ${lang})` : ''}
            </div>
            {translation}
          </div>
        )}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {toolCalls.map((tc) => (
              <div key={tc.id} className="text-[11px] inline-block rounded-lg border border-line/60 bg-ink/40 px-2 py-1 text-left">
                <span className="font-mono text-stage-mastering">🔧 {tc.name}</span>
                {typeof tc.input?.path === 'string' && (
                  <span className="text-muted/80 ml-1.5 font-mono">{tc.input.path}</span>
                )}
                {typeof tc.input?.commit_message === 'string' && (
                  <span className="text-muted/80 ml-1.5 italic">{(tc.input.commit_message as string).split('\n')[0]}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
