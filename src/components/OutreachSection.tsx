// Per-show guest outreach tab. Admin-only.
//
// Two side-by-side panels: template editor on the left, prospect list
// on the right. The template holds the email that gets sent to every
// prospect with [name] and [unique_sentence] tokens swapped in per
// row. Prospects live in a scrollable list — add, edit inline, delete.
//
// Generating unique sentences + sending the campaign land next.
import { useEffect, useState } from 'react'
import { api, type ApiOutreachProspect, type ApiOutreachTemplate } from '../api'

const RECIPIENT_LABEL: Record<ApiOutreachProspect['recipient_type'], string> = {
  person: 'The guest',
  agent: 'Their agent',
  manager: 'Their manager',
  other: 'Other (PR, assistant)',
}

const STATUS_STYLE: Record<ApiOutreachProspect['status'], { bg: string; label: string }> = {
  needs_email: { bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: 'Needs email' },
  ready:       { bg: 'bg-sky-500/15 text-sky-300 border-sky-500/30',       label: 'Ready' },
  queued:      { bg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', label: 'Queued' },
  sent:        { bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: 'Sent' },
  replied:     { bg: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30', label: 'Replied!' },
  bounced:     { bg: 'bg-urgent/15 text-urgent border-urgent/30', label: 'Bounced' },
  opted_out:   { bg: 'bg-slate-500/15 text-muted border-slate-500/30', label: 'Opted out' },
  failed:      { bg: 'bg-urgent/15 text-urgent border-urgent/30', label: 'Failed' },
}

const DEFAULT_TEMPLATE_BODY = `Hi [name],

I'm producing a podcast at Straw Hut Media and we'd love to have you on.

[unique_sentence]

The show is a 45-minute conversation, recorded remotely on Riverside (video optional), edited into a polished cut. You'd get the audio + a clip package to share.

Would you have 30 minutes this month or next to jump on a call and see if it's a fit?

Best,
Ryan`

export default function OutreachSection({ projectId }: { projectId: string }) {
  const [template, setTemplate] = useState<ApiOutreachTemplate | null>(null)
  const [subject, setSubject] = useState('Guesting on our podcast — [name]')
  const [body, setBody] = useState(DEFAULT_TEMPLATE_BODY)
  const [replyTo, setReplyTo] = useState('booking@strawhutmedia.com')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [prospects, setProspects] = useState<ApiOutreachProspect[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  async function loadTemplate() {
    try {
      const r = await api.outreachTemplate(projectId)
      if (r.template) {
        setTemplate(r.template)
        setSubject(r.template.subject || 'Guesting on our podcast — [name]')
        setBody(r.template.body || DEFAULT_TEMPLATE_BODY)
        setReplyTo(r.template.reply_to || 'booking@strawhutmedia.com')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'template load failed')
    }
  }

  async function loadProspects() {
    try {
      const r = await api.outreachProspects(projectId)
      setProspects(r.prospects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'prospects load failed')
    }
  }

  useEffect(() => {
    void loadTemplate()
    void loadProspects()
  }, [projectId])

  async function saveTemplate() {
    setSaving(true)
    setError(null)
    try {
      await api.saveOutreachTemplate(projectId, { subject, body, replyTo })
      setSavedAt(Date.now())
      await loadTemplate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  async function removeProspect(p: ApiOutreachProspect) {
    if (!confirm(`Remove ${p.name}?`)) return
    try {
      await api.deleteOutreachProspect(p.id)
      await loadProspects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    }
  }

  const readyCount = prospects?.filter((p) => p.status === 'ready').length ?? 0
  const needsEmailCount = prospects?.filter((p) => p.status === 'needs_email').length ?? 0
  const sentCount = prospects?.filter((p) => p.status === 'sent').length ?? 0
  const repliedCount = prospects?.filter((p) => p.status === 'replied').length ?? 0

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">✉ Guest outreach</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-2xl">
            Write the template once. Add prospects. Slate generates a unique sentence per person and sends
            everything jittered so it looks human. Replies land in <code>booking@strawhutmedia.com</code>.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted">
          {prospects === null ? 'Loading…' : (
            <>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                {needsEmailCount} needs email
              </span>
              <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold">
                {readyCount} ready
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                {sentCount} sent
              </span>
              <span className="px-2 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30 font-bold">
                {repliedCount} replied
              </span>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/5 px-3 py-2 text-xs text-urgent">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ─── Template editor ─────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Template</h3>
            {savedAt && (
              <span className="text-[10px] text-muted">
                Saved {new Date(savedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="space-y-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
                Body — use [name] and [unique_sentence] to personalize
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={16}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-stage-mastering"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Reply-to</span>
              <input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
              />
            </label>
            <button
              onClick={() => void saveTemplate()}
              disabled={saving}
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-40 font-bold"
            >
              {saving ? 'Saving…' : template ? '💾 Update template' : '💾 Save template'}
            </button>
          </div>
        </div>

        {/* ─── Prospects list ──────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Prospects</h3>
            <button
              onClick={() => setAddOpen((v) => !v)}
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1 hover:bg-stage-mastering/10 font-bold"
            >
              {addOpen ? 'Cancel' : '+ Add prospect'}
            </button>
          </div>

          {addOpen && (
            <AddProspectForm
              projectId={projectId}
              onAdded={() => { setAddOpen(false); void loadProspects() }}
            />
          )}

          {prospects === null && <p className="text-xs text-muted italic">Loading…</p>}
          {prospects && prospects.length === 0 && !addOpen && (
            <p className="text-xs text-muted italic">
              No prospects yet. Add one to start building your outreach list.
            </p>
          )}
          {prospects && prospects.length > 0 && (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {prospects.map((p) => {
                const style = STATUS_STYLE[p.status]
                return (
                  <div key={p.id} className="rounded-lg border border-line bg-ink/30 p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{p.name}</span>
                      {p.full_name && p.full_name !== p.name && (
                        <span className="text-xs text-muted">({p.full_name})</span>
                      )}
                      <span className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${style.bg}`}>
                        {style.label}
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={() => void removeProspect(p)}
                        className="text-[10px] text-muted hover:text-urgent"
                        title="Remove prospect"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-[11px] text-muted space-y-0.5">
                      {p.email
                        ? <div>📧 <code>{p.email}</code></div>
                        : <div className="italic text-amber-300/80">📧 email not found yet — paste it when you have it</div>}
                      <div>👤 {RECIPIENT_LABEL[p.recipient_type]}{p.client_name ? ` · ${p.client_name}` : ''}</div>
                      {p.context && <div className="text-muted/80 italic">💬 {p.context}</div>}
                      {p.unique_sentence && (
                        <div className="mt-1 pt-1 border-t border-line/40">
                          <span className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">Unique sentence:</span>
                          <div className="text-emerald-100/80 italic">"{p.unique_sentence}"</div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function AddProspectForm({
  projectId, onAdded,
}: {
  projectId: string
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [recipientType, setRecipientType] = useState<ApiOutreachProspect['recipient_type']>('person')
  const [clientName, setClientName] = useState('')
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setBusy(true)
    setError(null)
    try {
      await api.addOutreachProspect(projectId, {
        name: name.trim(),
        fullName: fullName.trim() || undefined,
        email: email.trim() || undefined,
        recipientType,
        clientName: (recipientType === 'agent' || recipientType === 'manager') && clientName.trim()
          ? clientName.trim() : undefined,
        context: context.trim() || undefined,
      })
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-stage-mastering/40 bg-stage-mastering/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Name (for [name] token) *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex"
            required
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-stage-mastering"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Full name (optional)</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Alex Rodriguez"
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-stage-mastering"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Email (paste when you have it)</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="alex@company.com"
          className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-stage-mastering"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Who is this?</span>
          <select
            value={recipientType}
            onChange={(e) => setRecipientType(e.target.value as ApiOutreachProspect['recipient_type'])}
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-stage-mastering"
          >
            <option value="person">The guest themselves</option>
            <option value="agent">Their agent</option>
            <option value="manager">Their manager</option>
            <option value="other">Other (PR, assistant, unclear)</option>
          </select>
        </label>
        {(recipientType === 'agent' || recipientType === 'manager') && (
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Client (who they represent)</span>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Alex Rodriguez"
              className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-stage-mastering"
            />
          </label>
        )}
      </div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
          Context — Claude reads this to craft the unique sentence
        </span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          placeholder="e.g. Founder of X. Just launched Y. Recently guested on Diary of a CEO ep 342."
          className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-stage-mastering"
        />
      </label>
      {error && <p className="text-xs text-urgent">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-40 font-bold"
        >
          {busy ? 'Adding…' : '+ Add prospect'}
        </button>
      </div>
    </form>
  )
}
