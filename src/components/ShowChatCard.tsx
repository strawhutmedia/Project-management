// Per-show shared chat. Project members can post; Claude responds
// with the show's full context (brand voice, vocabulary, recent
// episodes, RSS link). Defaults to Sonnet 4.6 for cost — toggle
// "Use Opus" for harder questions. Daily $2 cap shown in the header.
import { useEffect, useRef, useState } from 'react'
import { api, type ApiShowChatMessage } from '../api'
import { useAuth } from '../auth'

export default function ShowChatCard({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ApiShowChatMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [useOpus, setUseOpus] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spentCents, setSpentCents] = useState(0)
  const [dailyCapCents, setDailyCapCents] = useState(200)
  const [expanded, setExpanded] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  async function load() {
    try {
      const r = await api.showChat(projectId)
      setMessages(r.messages)
      setSpentCents(r.spentCents24h)
      setDailyCapCents(r.dailyCapCents)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [projectId])
  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages?.length, expanded])

  async function send() {
    const content = draft.trim()
    if (!content) return
    setSending(true); setError(null); setDraft('')
    try {
      const r = await api.showChatSend(projectId, { content, useOpus })
      setMessages((prev) => [...(prev ?? []), r.userMessage, r.assistantMessage])
      setSpentCents(r.spentCents24h)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to send')
      setDraft(content)
    } finally {
      setSending(false)
    }
  }

  async function removeMessage(id: string) {
    if (!confirm('Delete this message?')) return
    try {
      await api.showChatDelete(projectId, id)
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  const spentDollars = (spentCents / 100).toFixed(2)
  const capDollars = (dailyCapCents / 100).toFixed(2)
  const overCap = spentCents >= dailyCapCents
  const pctOfCap = Math.min(1, spentCents / Math.max(1, dailyCapCents))

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">
            ✦ Show Chat
          </h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-xl">
            Shared thread for the team. Claude has this show's brand voice, vocabulary, and recent
            episodes as context. Everything you tell it becomes part of the thread, so context
            builds over time.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Today</div>
          <div className={`text-sm font-mono font-bold ${overCap ? 'text-urgent' : 'text-text'}`}>
            ${spentDollars} <span className="text-muted/60 font-normal">/ ${capDollars}</span>
          </div>
          <div className="w-32 h-1 mt-1 bg-ink/60 rounded-full overflow-hidden">
            <div
              className={`h-full ${overCap ? 'bg-urgent' : 'bg-stage-stems'} transition-all`}
              style={{ width: `${pctOfCap * 100}%` }}
            />
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">
          {error}
        </div>
      )}

      {messages === null ? (
        <p className="text-muted text-xs italic">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-muted/70 text-sm italic text-center py-4 border border-dashed border-line/60 rounded-xl">
          No messages yet. Say something to kick it off — "what's this show about?" or
          "help me brainstorm a teaser for ep 25."
        </p>
      ) : (
        <div className={`space-y-2 ${expanded ? 'max-h-[60vh]' : 'max-h-72'} overflow-y-auto pr-1`}>
          {(expanded ? messages : messages.slice(-6)).map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              currentUserId={user?.id ?? null}
              onDelete={() => void removeMessage(m.id)}
            />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-[11px] text-muted italic pl-10">
              <span className="inline-block w-2 h-2 rounded-full bg-stage-mastering animate-pulse" />
              Claude is thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {messages && messages.length > 6 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-[10px] uppercase tracking-wider text-muted hover:text-text border-t border-line/40 pt-2"
        >
          Show full history ({messages.length} messages)
        </button>
      )}

      <div className="border-t border-line/40 pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault(); void send()
            }
          }}
          rows={2}
          placeholder={overCap
            ? "Today's $2 budget for this show is used. Resets rolling 24h."
            : 'Ask Claude about the show, brainstorm with it, paste a script for critique…'}
          disabled={sending || overCap}
          className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering resize-y disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={useOpus}
              onChange={(e) => setUseOpus(e.target.checked)}
              disabled={sending}
            />
            Use Opus <span className="text-muted/60">(~5× cost — for hard questions)</span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted">⌘↵ to send</span>
            <button
              onClick={() => void send()}
              disabled={sending || !draft.trim() || overCap}
              className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-4 py-1.5 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function MessageBubble({
  message,
  currentUserId,
  onDelete,
}: {
  message: ApiShowChatMessage
  currentUserId: string | null
  onDelete: () => void
}) {
  const isAssistant = message.role === 'assistant'
  const isMine = !isAssistant && message.authorUserId === currentUserId
  const name = isAssistant ? 'Claude' : (message.authorDisplayName || 'Someone')
  const initial = name.charAt(0).toUpperCase()
  return (
    <div className={`group flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold shrink-0 ${
        isAssistant
          ? 'bg-gradient-to-br from-stage-mastering via-stage-producing to-stage-tracking text-white'
          : 'bg-ink/60 border border-line text-text'
      }`}>
        {isAssistant ? '✦' : initial}
      </div>
      <div className={`flex-1 max-w-[85%] ${isMine ? 'text-right' : ''}`}>
        <div className={`text-[9px] uppercase tracking-wider text-muted/70 font-bold mb-0.5 ${isMine ? 'text-right' : ''}`}>
          {name}
          {isAssistant && message.model && (
            <span className="ml-1 text-muted/50">· {message.model}</span>
          )}
          <span className="opacity-50 ml-1">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          <button
            onClick={onDelete}
            className="ml-2 text-muted/40 hover:text-urgent opacity-0 group-hover:opacity-100"
            title="Delete this message"
          >
            ✕
          </button>
        </div>
        <div className={`inline-block rounded-2xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap text-left ${
          isAssistant
            ? 'bg-stage-mastering/10 border border-stage-mastering/30 text-text'
            : isMine
              ? 'bg-gradient-to-br from-stage-tracking/30 to-stage-mastering/30 border border-stage-tracking/40 text-text'
              : 'bg-ink/40 border border-line text-text'
        }`}>
          {message.content}
        </div>
      </div>
    </div>
  )
}
