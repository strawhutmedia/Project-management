// Per-show guest outreach tab. Admin-only.
//
// Two side-by-side panels: template editor on the left, prospect list
// on the right. The template holds the email that gets sent to every
// prospect with [name] and [unique_sentence] tokens swapped in per
// row. Prospects live in a scrollable list — add, edit inline, delete.
//
// Generating unique sentences + sending the campaign land next.
import { useEffect, useRef, useState } from 'react'
import { api, type ApiOutreachProspect, type ApiOutreachTemplate } from '../api'
import { useAuth } from '../auth'
import ProspectDetailModal from './ProspectDetailModal'

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

More about the show: [one_sheet_url]

Best,
Ryan`

export default function OutreachSection({ projectId }: { projectId: string }) {
  const { user } = useAuth()
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
  const [openProspect, setOpenProspect] = useState<ApiOutreachProspect | null>(null)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [sendingCampaign, setSendingCampaign] = useState(false)
  const [campaignResult, setCampaignResult] = useState<string | null>(null)
  // Calm, non-error banner for the "Generate all sentences" outcome.
  // Kept separate from `error` so a normal result (some written, some
  // still needing a note) never renders in the red error banner.
  const [generateResult, setGenerateResult] = useState<{ text: string; tone: 'success' | 'info' } | null>(null)
  // Test-send bar
  const [testTo, setTestTo] = useState(user?.email ?? 'ryan@strawhutmedia.com')
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  // Refs so token-insert buttons can drop a token at the current cursor
  // position rather than always appending to the end.
  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  function insertToken(field: 'subject' | 'body', token: string) {
    const el = field === 'subject' ? subjectRef.current : bodyRef.current
    const current = field === 'subject' ? subject : body
    const setter = field === 'subject' ? setSubject : setBody
    if (!el) { setter(current + token); return }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    setter(next)
    // Restore focus + move cursor to just after the inserted token.
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  // Keep the default test target in sync once the user loads.
  useEffect(() => {
    if (user?.email) setTestTo(user.email)
  }, [user?.email])

  async function sendTest() {
    if (!testTo.trim()) return
    setTestSending(true)
    setTestResult(null)
    setError(null)
    try {
      const r = await api.testSendOutreach(projectId, testTo.trim())
      setTestResult(`✓ Sent to ${r.to} · using preview name "${r.previewName}" · check your inbox in a moment.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'test send failed'
      setTestResult(`✕ ${msg}`)
    } finally {
      setTestSending(false)
    }
  }

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

  async function clearAll() {
    const total = prospects?.length ?? 0
    const sentOrReplied = (prospects ?? []).filter((p) => p.status === 'sent' || p.status === 'replied').length
    const message =
      sentOrReplied > 0
        ? `Delete all ${total} prospects?\n\n${sentOrReplied} have already been sent or replied — keep those and only delete the rest?`
        : `Delete all ${total} prospects? This can't be undone.`
    if (!confirm(message)) return
    // If any are sent, offer to keep them.
    const keepSent = sentOrReplied > 0 && confirm(`Keep the ${sentOrReplied} sent/replied prospects and only delete the other ${total - sentOrReplied}?`)
    try {
      const r = await api.clearAllOutreachProspects(projectId, keepSent)
      setError(null)
      setCampaignResult(`✓ Cleared ${r.deleted} prospect${r.deleted === 1 ? '' : 's'}.`)
      await loadProspects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'clear all failed')
    }
  }

  async function sendCampaign() {
    const readyList = (prospects ?? []).filter(
      (p) => p.status === 'ready' && p.email && p.unique_sentence?.trim(),
    )
    if (readyList.length === 0) {
      setError('No prospects are Ready. Each needs an email + a unique sentence.')
      return
    }
    const ok = confirm(
      `Send ${readyList.length} outreach emails?\n\n` +
      `Slate will jitter them 90-180s apart via your verified sending domains. ` +
      `Estimated wall-clock time: ${Math.round((readyList.length * 135) / 60)} minutes.\n\n` +
      `You can't stop the campaign once it starts. Test one to yourself first?`,
    )
    if (!ok) return
    setSendingCampaign(true)
    setError(null)
    setCampaignResult(null)
    try {
      const r = await api.sendOutreachCampaign(projectId)
      const split = r.perDomain.length > 1
        ? ` Rotating across ${r.domainsUsed} domains (~${r.perDomain.join('/')} sends each) to protect reputation.`
        : ` Sending from ${r.domainsUsed} verified domain. Add more in Sending domains to spread load.`
      setCampaignResult(
        `✓ Campaign queued: ${r.queued} emails will send over the next ~${r.estimatedMinutes} min. ` +
        `First fires around ${new Date(r.firstAt).toLocaleTimeString()}, last around ${new Date(r.lastAt).toLocaleTimeString()}.` +
        split,
      )
      await loadProspects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'campaign failed')
    } finally {
      setSendingCampaign(false)
    }
  }

  async function generateAllSentences() {
    if (!confirm('Generate a unique sentence for every prospect that doesn\'t already have one? Uses Claude and takes ~10s per 5 prospects.')) return
    setGeneratingAll(true)
    setError(null)
    setGenerateResult(null)
    try {
      const r = await api.generateAllUniqueSentences(projectId)
      // Reload so the list — and the "who still needs a note" list
      // below — reflects what actually got written.
      const fresh = await api.outreachProspects(projectId)
      setProspects(fresh.prospects)
      // Anyone still without a sentence needs a one-line note (either
      // none was given, or it was too thin for Claude to write anything
      // specific). We name them so it's obvious who to click.
      const needNote = fresh.prospects.filter((p) => !p.unique_sentence?.trim())
      const parts: string[] = []
      if (r.generated > 0) {
        parts.push(`✓ Wrote ${r.generated} sentence${r.generated === 1 ? '' : 's'}.`)
      }
      if (needNote.length > 0) {
        const names = needNote.slice(0, 3).map((p) => p.name).join(', ')
        const more = needNote.length > 3 ? `, and ${needNote.length - 3} more` : ''
        const who = needNote.length === 1 ? 'person needs' : 'people need'
        const them = needNote.length === 1 ? 'that person' : 'each one'
        parts.push(
          `${needNote.length} ${who} a quick one-line note first: ${names}${more}. ` +
          `Click ${them} in the list, add a sentence about who they are ` +
          `(what they do + something recent), then press Generate again.`,
        )
      }
      if (r.failed > 0) {
        parts.push(`${r.failed} hit a snag — try Generate again in a moment.`)
      }
      if (parts.length === 0) {
        parts.push('Everyone already has a sentence — nothing new to generate.')
      }
      setGenerateResult({
        text: parts.join(' '),
        tone: needNote.length === 0 && r.failed === 0 ? 'success' : 'info',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generate failed')
    } finally {
      setGeneratingAll(false)
    }
  }

  const readyCount = prospects?.filter((p) => p.status === 'ready').length ?? 0
  const needsEmailCount = prospects?.filter((p) => p.status === 'needs_email').length ?? 0
  const sentCount = prospects?.filter((p) => p.status === 'sent').length ?? 0
  const repliedCount = prospects?.filter((p) => p.status === 'replied').length ?? 0

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-4 sm:p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">✉ Guest outreach</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-2xl">
            Write the template once. Add prospects. Slate generates a unique sentence per person and sends
            everything jittered so it looks human. Replies land in <code>booking@strawhutmedia.com</code>.
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] uppercase tracking-wider text-muted flex-wrap">
          {prospects === null ? 'Loading…' : (
            <>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold whitespace-nowrap">
                {needsEmailCount} needs email
              </span>
              <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold whitespace-nowrap">
                {readyCount} ready
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold whitespace-nowrap">
                {sentCount} sent
              </span>
              <span className="px-2 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30 font-bold whitespace-nowrap">
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Subject</span>
                <TokenBar onInsert={(t) => insertToken('subject', t)} />
              </div>
              <input
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
              />
            </label>
            <label className="block">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
                  Body — click a chip to drop the token at your cursor
                </span>
                <TokenBar onInsert={(t) => insertToken('body', t)} />
              </div>
              <textarea
                ref={bodyRef}
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

            {/* Yellow test-send bar — always visible so it's obvious how
                to preview a real send. Fires a merged email through
                Resend to whatever address is in the box. */}
            <div className="rounded-xl border-2 border-amber-400/50 bg-amber-400/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧪</span>
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">Send test</div>
                  <div className="text-[10px] text-amber-100/70">
                    Fires a real email so you can see exactly what recipients will get. Uses the first prospect's context (or a stand-in if none).
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@strawhutmedia.com"
                  className="flex-1 min-w-[220px] bg-ink/40 border border-amber-400/40 rounded-full px-3 py-1.5 text-sm focus:outline-none focus:border-amber-300"
                />
                <button
                  onClick={() => void sendTest()}
                  disabled={testSending || !testTo.trim()}
                  className="text-[10px] uppercase tracking-wider text-amber-950 bg-amber-400 rounded-full px-3 py-1.5 hover:bg-amber-300 disabled:opacity-40 font-bold"
                >
                  {testSending ? 'Sending…' : '✉ Send test'}
                </button>
              </div>
              {testResult && (
                <div className={`text-[11px] ${testResult.startsWith('✓') ? 'text-emerald-300' : 'text-urgent'}`}>
                  {testResult}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Prospects list ──────────────────────────────────── */}
        <div className="space-y-3">
          {/* Campaign-status banner sits above the prospect controls
              because it's the outcome of the biggest button. */}
          {campaignResult && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              {campaignResult}
            </div>
          )}

          {generateResult && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                generateResult.tone === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-sky-500/40 bg-sky-500/10 text-sky-100'
              }`}
            >
              {generateResult.text}
            </div>
          )}

          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Prospects</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Ryan's ship-it button. Big, obvious, red-pink so it
                  reads as "irreversible action". */}
              {readyCount > 0 && (
                <button
                  onClick={() => void sendCampaign()}
                  disabled={sendingCampaign}
                  className="text-[10px] uppercase tracking-wider text-white bg-gradient-to-r from-urgent to-stage-mastering rounded-full px-3 py-1 hover:opacity-90 disabled:opacity-40 font-bold shadow-lg"
                  title={`Send ${readyCount} outreach emails now, jittered across your verified sending domains.`}
                >
                  {sendingCampaign ? 'Queueing…' : `🚀 Send campaign (${readyCount})`}
                </button>
              )}
              {prospects && prospects.some((p) => !p.unique_sentence) && (
                <button
                  onClick={() => void generateAllSentences()}
                  disabled={generatingAll}
                  className="text-[10px] uppercase tracking-wider text-emerald-950 bg-emerald-400 rounded-full px-3 py-1 hover:bg-emerald-300 disabled:opacity-40 font-bold"
                  title="Generate a Claude-written sentence for every prospect that's missing one."
                >
                  {generatingAll ? 'Generating…' : `✨ Generate all sentences (${prospects.filter((p) => !p.unique_sentence).length})`}
                </button>
              )}
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
              {prospects && prospects.length > 0 && (
                <button
                  onClick={() => void clearAll()}
                  className="text-[10px] uppercase tracking-wider text-urgent border border-urgent/40 rounded-full px-3 py-1 hover:bg-urgent/10 font-bold"
                  title={`Delete all ${prospects.length} prospects (with confirmation).`}
                >
                  🗑 Clear all ({prospects.length})
                </button>
              )}
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
                const hasSentence = !!p.unique_sentence?.trim()
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenProspect(p)}
                    className="w-full text-left rounded-lg border border-line bg-ink/30 hover:border-stage-mastering/60 hover:bg-ink/50 transition p-3 space-y-1 cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm group-hover:text-stage-mastering transition">{p.name}</span>
                      {p.full_name && p.full_name !== p.name && (
                        <span className="text-xs text-muted">({p.full_name})</span>
                      )}
                      <span className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${style.bg}`}>
                        {style.label}
                      </span>
                      {!hasSentence && !p.context && (
                        <span className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-300">
                          Add a note to generate
                        </span>
                      )}
                      {!hasSentence && p.context && (
                        <span className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
                          Ready to generate
                        </span>
                      )}
                      <div className="flex-1" />
                      <span
                        onClick={(e) => { e.stopPropagation(); void removeProspect(p) }}
                        role="button"
                        className="text-[10px] text-muted hover:text-urgent cursor-pointer opacity-0 group-hover:opacity-100"
                        title="Remove prospect"
                      >
                        ✕
                      </span>
                    </div>
                    <div className="text-[11px] text-muted space-y-0.5">
                      {p.email
                        ? <div>📧 <code>{p.email}</code></div>
                        : <div className="italic text-amber-300/80">📧 email not found yet — click to add</div>}
                      <div>👤 {RECIPIENT_LABEL[p.recipient_type]}{p.client_name ? ` · ${p.client_name}` : ''}</div>
                      {p.context && <div className="text-muted/80 italic truncate">💬 {p.context}</div>}
                      {hasSentence && (
                        <div className="mt-1 pt-1 border-t border-line/40">
                          <span className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">Unique sentence:</span>
                          <div className="text-emerald-100/80 italic">"{p.unique_sentence}"</div>
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {openProspect && (
        <ProspectDetailModal
          prospect={openProspect}
          onClose={() => setOpenProspect(null)}
          onChanged={() => { void loadProspects() }}
        />
      )}
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
    // Skip the CSV template header if someone pasted the whole file.
    // Detects "name..." in col 1 and "email..." in col 2 with no @ —
    // avoids treating it as a real prospect and producing garbage rows.
    const lower = line.toLowerCase()
    if (lower.startsWith('name') && lower.includes('email') && !line.includes('@')) continue
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
    // name, email(s), context, full_name, type, represents. Context comes
    // right after email because it's the third required field — the one
    // Claude uses to write the unique sentence. A cell can hold multiple
    // emails (person + manager + agent inline) — we split and emit one
    // prospect per email so each has its own send target.
    if (c1 && /@/.test(c1)) {
      const emails = extractEmails(c1)
      const type = normalizeType(c4)
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
          context: c2 || undefined,
          fullName: c3 || undefined,
          recipientType: type,
          clientName: c5 || undefined,
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

// Chip row of merge tokens. Each chip is a button — click drops the
// token at the cursor position of the field it's attached to. Kept
// tiny so it doesn't dominate the field header on mobile.
function TokenBar({ onInsert }: { onInsert: (token: string) => void }) {
  const tokens: { token: string; label: string; hint: string }[] = [
    { token: '[name]', label: '[name]', hint: 'Prospect first name — e.g. "Alex"' },
    { token: '[unique_sentence]', label: '[unique_sentence]', hint: 'Claude-written personalized sentence per prospect' },
    { token: '[one_sheet_url]', label: '[one_sheet_url]', hint: 'Public one-sheet URL (blank if unpublished)' },
  ]
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tokens.map((t) => (
        <button
          key={t.token}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onInsert(t.token) }}
          title={t.hint}
          className="text-[9px] font-mono text-stage-mastering border border-stage-mastering/40 rounded-full px-2 py-0.5 hover:bg-stage-mastering/10 font-bold"
        >
          + {t.label}
        </button>
      ))}
    </div>
  )
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
        <p className="pt-1">
          <a
            href="/api/outreach/template.csv"
            download="slate-outreach-template.csv"
            className="text-stage-tracking underline hover:text-stage-tracking/80 font-bold"
          >
            📥 Download CSV template
          </a>
          <span className="text-muted/70"> — fill in Excel/Sheets, copy the rows (header optional — we skip it), paste above.</span>
        </p>
        <p className="pt-1"><strong className="text-emerald-300">Only 3 fields matter:</strong> name, email, context. Everything else is optional.</p>
        <ul className="list-disc list-inside pl-2 space-y-0.5 text-[10px]">
          <li><code>alex@company.com</code> — email only, name auto-derived</li>
          <li><code>Alex, alex@company.com</code> — name, email</li>
          <li><code>Alex, alex@company.com, founder of X — just did Diary of a CEO</code> — name, email, context (recommended minimum)</li>
          <li><code>Sarah, sarah@caa.com, Emily Blunt's booking agent at CAA, Sarah Kim, agent, Emily Blunt</code> — full: name, email, context, full name, type (person/agent/manager/other), represents</li>
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
