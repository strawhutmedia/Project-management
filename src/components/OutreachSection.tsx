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

// Deliberately generic — no mention of Riverside, video, or format
// specifics because those differ per show (Soul & Science is remote
// on Riverside; Private Talk is in-studio; etc.). Every show's editor
// customizes this to fit its actual format.
const DEFAULT_TEMPLATE_BODY = `Hi [name],

I'm producing a podcast at Straw Hut Media and we'd love to have you on.

[unique_sentence]

Our episodes run about 45 minutes and are edited into a polished cut. Guests get the audio + a highlight clip package to share wherever they'd like.

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
  const [bulkOpen, setBulkOpen] = useState(false)

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
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Prospects</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setBulkOpen((v) => !v); if (!bulkOpen) setAddOpen(false) }}
                className={`text-[10px] uppercase tracking-wider border rounded-full px-3 py-1 font-bold ${
                  bulkOpen
                    ? 'text-muted border-line'
                    : 'text-stage-tracking border-stage-tracking/40 hover:bg-stage-tracking/10'
                }`}
              >
                {bulkOpen ? 'Cancel' : '📋 Bulk import'}
              </button>
              <button
                onClick={() => { setAddOpen((v) => !v); if (!addOpen) setBulkOpen(false) }}
                className={`text-[10px] uppercase tracking-wider border rounded-full px-3 py-1 font-bold ${
                  addOpen
                    ? 'text-muted border-line'
                    : 'text-stage-mastering border-stage-mastering/40 hover:bg-stage-mastering/10'
                }`}
              >
                {addOpen ? 'Cancel' : '+ Add one'}
              </button>
            </div>
          </div>

          {bulkOpen && (
            <BulkImportPanel
              projectId={projectId}
              onImported={() => { setBulkOpen(false); void loadProspects() }}
            />
          )}

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

// Bulk import — paste rows from a spreadsheet or a plain list.
// Parses tab-separated (from Sheets/Excel copy) OR comma-separated OR
// pipe-separated. Also handles "just emails, one per line" as the
// dead-simplest case.
//
// Column format (order matters when using multi-column paste):
//   name | email | full_name | recipient_type | client_name | context
//
// For an email-only paste, name is auto-derived from the email's
// local part (alex@company.com → "Alex") so you can start with just a
// list of addresses and edit names later.
type ParsedRow = {
  name: string
  fullName?: string
  email?: string
  recipientType?: 'person' | 'agent' | 'manager' | 'other'
  clientName?: string
  context?: string
  error?: string
}

// Extract every email address from a string. Handles a cell like
// "sgrossman@untitledent.com info@theapex-pr.com" (two agents in one
// cell) by pulling BOTH so we can create two prospect rows — one per
// address — instead of stuffing them together as one send target.
function extractEmails(s: string | undefined): string[] {
  if (!s) return []
  const matches = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)
  if (!matches) return []
  // Dedup case-insensitively while preserving order.
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    const lc = m.toLowerCase()
    if (!seen.has(lc)) { seen.add(lc); out.push(lc) }
  }
  return out
}

function parseBulk(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const rows: ParsedRow[] = []
  for (const line of lines) {
    // Detect delimiter — prefer tab (spreadsheet paste), then pipe,
    // then comma. Splitting on the first one we find keeps commas
    // inside a context field intact.
    let parts: string[]
    if (line.includes('\t')) parts = line.split('\t').map((p) => p.trim())
    else if (line.includes('|')) parts = line.split('|').map((p) => p.trim())
    else if (line.includes(',')) parts = line.split(',').map((p) => p.trim())
    else parts = [line.trim()]

    const [c0, c1, c2, c3, c4, c5] = parts

    // Email-only paste — single field with one or more emails. Derive
    // a name from each address and emit one prospect per email.
    if (parts.length === 1 && /@/.test(c0)) {
      const emails = extractEmails(c0)
      for (const email of emails) {
        const local = email.split('@')[0]
        const name = local.split(/[._-]/)[0]
        rows.push({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          email,
        })
      }
      continue
    }

    // Multi-column paste. If c1 looks like an email, standard order is
    // name, email(s), full_name, type, client, context. A cell can hold
    // multiple emails (person + manager + agent inline) — we split and
    // emit one prospect per email so each has its own send target.
    if (c1 && /@/.test(c1)) {
      const emails = extractEmails(c1)
      const type = normalizeType(c3)
      if (emails.length === 0) {
        rows.push({
          name: c0 || '(unknown)',
          error: c0 ? 'bad_email' : 'name_required',
        })
        continue
      }
      for (const email of emails) {
        rows.push({
          name: c0 || '(unknown)',
          email,
          fullName: c2 || undefined,
          recipientType: type,
          clientName: c4 || undefined,
          context: c5 || undefined,
          error: c0 ? undefined : 'name_required',
        })
      }
      continue
    }

    // Only a name, no email. That's fine — status will be needs_email.
    rows.push({
      name: c0 || '(unknown)',
      error: c0 ? undefined : 'name_required',
    })
  }
  return rows
}

function normalizeType(s: string | undefined): ParsedRow['recipientType'] {
  const lc = (s || '').trim().toLowerCase()
  if (lc.startsWith('person') || lc === 'guest' || lc === 'them') return 'person'
  if (lc.startsWith('agent')) return 'agent'
  if (lc.startsWith('manager') || lc.startsWith('mgr')) return 'manager'
  if (lc) return 'other'
  return 'person'
}

function BulkImportPanel({
  projectId, onImported,
}: {
  projectId: string
  onImported: () => void
}) {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = text.trim() ? parseBulk(text) : []
  const validCount = parsed.filter((r) => !r.error).length
  const invalidCount = parsed.length - validCount

  async function submit() {
    if (validCount === 0) return
    setImporting(true)
    setError(null)
    try {
      const rows = parsed
        .filter((r) => !r.error)
        .map((r) => ({
          name: r.name,
          fullName: r.fullName,
          email: r.email,
          recipientType: r.recipientType,
          clientName: r.clientName,
          context: r.context,
        }))
      const result = await api.bulkImportProspects(projectId, rows)
      if (result.failed > 0) {
        setError(`Imported ${result.imported}, ${result.failed} failed. Reload to see what stuck.`)
      }
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bulk import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="rounded-lg border border-stage-tracking/40 bg-stage-tracking/5 p-3 space-y-3">
      <div className="text-[11px] text-muted space-y-1">
        <p><strong className="text-text">Paste from anywhere</strong> — spreadsheet, plain list, one per line.</p>
        <p>Supported formats (Slate detects automatically):</p>
        <ul className="list-disc list-inside pl-2 space-y-0.5 text-[10px]">
          <li><code>alex@company.com</code> — email only, name auto-derived</li>
          <li><code>Alex, alex@company.com</code> — name, email</li>
          <li><code>Alex, alex@company.com, Alex Rodriguez, agent, Sarah Kim, founder of X — just did Diary of a CEO</code> — full: name, email, full name, type (person/agent/manager/other), client, context</li>
          <li>Or tab-separated (copy from Google Sheets)</li>
        </ul>
        <p className="text-amber-300/80 pt-1">
          <strong>Multiple emails in one cell?</strong> Slate splits them into separate prospects (one send per address) — you get one row per email, not a joined mess.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={'Alex, alex@company.com, Alex Rodriguez, person, , founder of X\nsarah@agency.com\nTom, tom@bigfilm.com, , agent, Emily Blunt, Emily Blunt\'s booking agent'}
        className="w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-stage-tracking"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] text-muted">
          {parsed.length === 0 ? (
            <span className="italic">Paste to see a preview…</span>
          ) : (
            <>
              <span className="text-emerald-300 font-bold">{validCount} valid</span>
              {invalidCount > 0 && (
                <> · <span className="text-urgent font-bold">{invalidCount} invalid</span></>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => void submit()}
          disabled={importing || validCount === 0}
          className="text-[10px] uppercase tracking-wider text-stage-tracking border border-stage-tracking/40 rounded-full px-3 py-1.5 hover:bg-stage-tracking/10 disabled:opacity-40 font-bold"
        >
          {importing ? 'Importing…' : `Import ${validCount} prospect${validCount === 1 ? '' : 's'}`}
        </button>
      </div>
      {parsed.length > 0 && parsed.length <= 20 && (
        <div className="text-[10px] font-mono text-muted space-y-0.5 max-h-40 overflow-y-auto pt-2 border-t border-line/40">
          {parsed.map((r, i) => (
            <div key={i} className={r.error ? 'text-urgent' : 'text-text/80'}>
              <span className="text-muted/50 mr-2">{i + 1}.</span>
              {r.error ? `✕ ${r.error}` : `${r.name}${r.email ? ` <${r.email}>` : ' (no email yet)'}${r.recipientType && r.recipientType !== 'person' ? ` [${r.recipientType}]` : ''}`}
            </div>
          ))}
        </div>
      )}
      {parsed.length > 20 && (
        <div className="text-[10px] text-muted italic">
          Preview hidden for {parsed.length} rows. Import to see them all.
        </div>
      )}
      {error && <p className="text-xs text-urgent">{error}</p>}
    </div>
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
