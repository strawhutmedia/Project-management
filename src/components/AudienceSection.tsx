// Per-show audience (email list) card — the CRM capture surface.
//
// Shows list growth, the most recent captures, and (for writers) the
// secret capture URL to paste into ManyChat's External Request action.
// Slate never emails this list itself — broadcasts go out from the
// Resend dashboard, from whatever verified from-address the team picks.
import { useEffect, useState } from 'react'
import { api } from '../api'

type Overview = Awaited<ReturnType<typeof api.audienceOverview>>

export default function AudienceSection({ projectId, canWrite }: {
  projectId: string
  canWrite: boolean
}) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)

  async function load() {
    try {
      setData(await api.audienceOverview(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }
  useEffect(() => { void load() }, [projectId])

  async function copyUrl() {
    if (!data?.capture) return
    try {
      await navigator.clipboard.writeText(data.capture.url)
      setNote('Capture URL copied.')
    } catch {
      setNote(data.capture.url)
    }
  }

  async function toggleLeadAlerts() {
    if (!data) return
    try {
      const r = await api.audienceSetLeadAlerts(projectId, !data.leadAlerts)
      setNote(r.enabled
        ? 'Lead alerts ON — every new capture emails the admin immediately.'
        : 'Lead alerts off.')
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'failed')
    }
  }

  async function resync() {
    try {
      const r = await api.audienceResync(projectId)
      setNote(r.pushed > 0 ? `Re-pushed ${r.pushed} contacts to Resend.` : 'Everything already synced.')
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'failed')
    }
  }

  const s = data?.stats

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📬 Audience — Email List</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Every email captured by this show's comment-trigger funnel (ManyChat → Slate → Resend).
            Fans join per show — this list belongs to this show.
          </p>
        </div>
        {canWrite && (
          <a
            href={`/api/audience/projects/${projectId}/export.csv`}
            className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded-full px-3 py-1.5"
          >
            ⬇ CSV
          </a>
        )}
      </div>

      {error && <p className="text-urgent text-xs">{error}</p>}

      {s && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-line bg-ink/30 p-3">
            <p className="text-2xl font-bold text-text">{s.total.toLocaleString()}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold mt-0.5">Subscribers</p>
          </div>
          <div className="rounded-xl border border-line bg-ink/30 p-3">
            <p className="text-2xl font-bold text-stage-done">+{s.last7.toLocaleString()}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold mt-0.5">Last 7 days</p>
          </div>
          <div className="rounded-xl border border-line bg-ink/30 p-3">
            <p className="text-2xl font-bold text-stage-tracking">+{s.last30.toLocaleString()}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold mt-0.5">Last 30 days</p>
          </div>
        </div>
      )}

      {canWrite && data?.capture && (
        <div className="rounded-xl border border-stage-stems/40 bg-stage-stems/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-stage-stems font-bold">Capture URL (secret — paste into ManyChat)</p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void copyUrl()}
                className="text-[10px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-2.5 py-1 hover:bg-stage-stems/10"
              >
                Copy
              </button>
              <button
                onClick={() => setShowSetup(!showSetup)}
                className="text-[10px] uppercase tracking-wider font-bold text-muted border border-line rounded-full px-2.5 py-1 hover:text-text"
              >
                {showSetup ? 'Hide setup' : 'Setup steps'}
              </button>
            </div>
          </div>
          <p className="text-[11px] font-mono text-muted break-all">{data.capture.url}</p>
          {showSetup && (
            <ol className="text-[11px] text-muted/90 leading-relaxed list-decimal list-inside space-y-1">
              <li>In ManyChat, build the flow: comment trigger word → DM → ask for email (save to the Email system field).</li>
              <li>After the email step, add an <strong>External Request</strong> action: POST to the URL above.</li>
              <li>Body type JSON: <code className="text-muted/70">{'{"email":"{{email}}","name":"{{full_name}}","handle":"{{ig_username}}","trigger_word":"RAVEN"}'}</code></li>
              <li>Set the trigger_word value per flow so you can see which offer converts.</li>
              <li>That's it — every capture lands here and mirrors to this show's Resend audience automatically.</li>
            </ol>
          )}
          <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={data.leadAlerts}
              onChange={() => void toggleLeadAlerts()}
              className="accent-current"
            />
            <span>
              <strong className="text-text">Instant lead alerts</strong> — email the admin the moment a new
              contact is captured. Turn on for client-lead lists (sales pipeline); leave off for fan lists.
            </span>
          </label>
          {typeof s?.unsynced === 'number' && s.unsynced > 0 && (
            <button
              onClick={() => void resync()}
              className="text-[10px] uppercase tracking-wider font-bold text-stage-tracking border border-stage-tracking/40 rounded-full px-2.5 py-1 hover:bg-stage-tracking/10"
            >
              ↻ {s.unsynced} not yet in Resend — re-push
            </button>
          )}
        </div>
      )}

      {data && data.recent.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Recent captures</p>
          <div className="space-y-1">
            {data.recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink/30 border border-line px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs text-text truncate">{c.email}{c.name ? <span className="text-muted"> · {c.name}</span> : null}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2 text-[10px] text-muted">
                  {c.trigger_word && <span className="uppercase tracking-wider border border-line rounded-full px-1.5 py-0.5">{c.trigger_word}</span>}
                  <span>{timeAgo(c.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data && data.recent.length === 0 && (
        <p className="text-xs text-muted italic">
          No captures yet. Set up the ManyChat flow with the capture URL above, post a "comment
          the trigger word" CTA, and they'll start appearing here.
        </p>
      )}
      {note && <p className="text-[11px] text-muted">{note}</p>}

      {canWrite && data?.leadAlerts && <LeadFollowupsPanel projectId={projectId} />}
    </section>
  )
}

// Lead follow-ups — only rendered for lists flagged as sales pipelines.
// Claude drafts, a human edits and sends. Never used on fan lists (the
// server enforces this too — audience_lead_alerts must be true).
type FollowupLead = {
  id: string; email: string; name: string | null; handle: string | null
  source: string; trigger_word: string | null; created_at: string
  followup_notes: string | null
  followup_draft_subject: string | null; followup_draft_body: string | null
  followup_status: 'none' | 'drafted' | 'sent'
}

function LeadFollowupsPanel({ projectId }: { projectId: string }) {
  const [leads, setLeads] = useState<FollowupLead[]>([])
  const [bookingUrl, setBookingUrl] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  async function load() {
    try {
      const r = await api.audienceFollowups(projectId)
      setLeads(r.leads)
      setBookingUrl(r.bookingUrl ?? '')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [projectId])

  async function saveBookingUrl() {
    setSavingUrl(true)
    try {
      await api.audienceSetBookingUrl(projectId, bookingUrl.trim())
    } finally {
      setSavingUrl(false)
    }
  }

  return (
    <div className="rounded-xl border border-stage-mastering/40 bg-stage-mastering/5 p-4 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-stage-mastering font-bold">✉️ Lead Follow-Ups</p>
        <p className="text-[11px] text-muted/80 mt-1 leading-relaxed">
          Claude drafts a personal reply for each lead — you add context, edit, and send it yourself.
          Nothing sends without a click here.
        </p>
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Booking link (optional, used in drafts)</span>
        <div className="flex gap-1.5 mt-1">
          <input
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
            placeholder="https://strawhutmedia.com/book"
            className="flex-1 bg-ink/40 border border-line rounded px-2 py-1.5 text-xs text-text"
          />
          <button
            onClick={() => void saveBookingUrl()}
            disabled={savingUrl}
            className="text-[10px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded px-2.5 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </label>

      {loading && <p className="text-xs text-muted italic">Loading…</p>}
      {!loading && leads.length === 0 && (
        <p className="text-xs text-muted italic">No leads waiting on a follow-up.</p>
      )}
      <div className="space-y-2">
        {leads.map((lead) => (
          <LeadFollowupRow
            key={lead.id}
            lead={lead}
            open={openId === lead.id}
            onToggle={() => setOpenId(openId === lead.id ? null : lead.id)}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  )
}

function LeadFollowupRow({ lead, open, onToggle, onChanged }: {
  lead: FollowupLead
  open: boolean
  onToggle: () => void
  onChanged: () => void | Promise<void>
}) {
  const [notes, setNotes] = useState(lead.followup_notes ?? '')
  const [subject, setSubject] = useState(lead.followup_draft_subject ?? '')
  const [body, setBody] = useState(lead.followup_draft_body ?? '')
  const [busy, setBusy] = useState<'draft' | 'save' | 'send' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function saveNotes() {
    await api.audienceSetFollowupNotes(lead.id, notes)
  }
  async function draft() {
    setBusy('draft'); setError(null)
    try {
      await saveNotes()
      const r = await api.audienceDraftFollowup(lead.id)
      setSubject(r.subject); setBody(r.body)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(null)
    }
  }
  async function saveEdit() {
    setBusy('save'); setError(null)
    try {
      await api.audienceEditFollowup(lead.id, subject, body)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(null)
    }
  }
  async function send() {
    if (!confirm(`Send this email to ${lead.email}?`)) return
    setBusy('send'); setError(null)
    try {
      await saveEdit()
      await api.audienceSendFollowup(lead.id)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg bg-ink/30 border border-line overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
        <div className="min-w-0">
          <p className="text-xs text-text truncate">{lead.email}{lead.name ? <span className="text-muted"> · {lead.name}</span> : null}</p>
          <p className="text-[10px] text-muted mt-0.5">
            {lead.trigger_word ? `"${lead.trigger_word}" · ` : ''}{lead.source} · {timeAgo(lead.created_at)}
          </p>
        </div>
        <span className={`shrink-0 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full border ${
          lead.followup_status === 'drafted' ? 'text-stage-tracking border-stage-tracking/40' : 'text-muted border-line'
        }`}>
          {lead.followup_status === 'drafted' ? 'Drafted' : 'Needs draft'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-line/60 pt-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Context (what to say — this drives the draft)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void saveNotes()}
              rows={2}
              placeholder="e.g. Called and left VM, wants a true-crime show launched by Q1, budget-conscious"
              className="w-full mt-1 bg-ink/40 border border-line rounded px-2 py-1.5 text-xs text-text"
            />
          </label>
          <button
            onClick={() => void draft()}
            disabled={busy !== null}
            className="text-[10px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-50"
          >
            {busy === 'draft' ? 'Drafting…' : subject ? '↻ Regenerate draft' : '✨ Draft with Claude'}
          </button>
          {(subject || body) && (
            <>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full mt-1 bg-ink/40 border border-line rounded px-2 py-1.5 text-xs text-text font-bold"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Body</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="w-full mt-1 bg-ink/40 border border-line rounded px-2 py-2 text-xs text-text whitespace-pre-wrap"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void saveEdit()}
                  disabled={busy !== null}
                  className="text-[10px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded-full px-3 py-1.5 disabled:opacity-50"
                >
                  {busy === 'save' ? 'Saving…' : 'Save edits'}
                </button>
                <button
                  onClick={() => void send()}
                  disabled={busy !== null}
                  className="text-[10px] uppercase tracking-wider font-bold text-white bg-stage-mastering rounded-full px-3 py-1.5 disabled:opacity-50"
                >
                  {busy === 'send' ? 'Sending…' : `Send to ${lead.email}`}
                </button>
              </div>
            </>
          )}
          {error && <p className="text-urgent text-xs">{error}</p>}
        </div>
      )}
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}
