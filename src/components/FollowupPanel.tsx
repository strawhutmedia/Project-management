import { useEffect, useRef, useState } from 'react'
import { api, type ApiFollowupPreview } from '../api'
import { useAuth } from '../auth'
import { TokenBar } from './OutreachTokens'

// Caroline's follow-up lane. A gated, one-and-done nudge to prospects who got
// the initial email but never replied. The whole panel is built around a
// preview-then-send safety flow:
//   1. Write + save the follow-up email.
//   2. "Preview who gets it" → the EXACT list (names + emails), before anything
//      sends. Hard exclusions (replied / bounced / opted-out / already
//      followed-up) are enforced server-side; they can never appear here.
//   3. Optional test-send to yourself.
//   4. Send — queues the (optionally deselected) list on the durable loop,
//      jittered 90-180s apart, same as the initial campaign.

const DEFAULT_FOLLOWUP_SUBJECT = 'Following up — [name]'
const DEFAULT_FOLLOWUP_BODY = `Hi [name],

Just floating this back to the top of your inbox in case it slipped by.

[unique_sentence]

We'd still love to have [guest] on. [location]

If the timing isn't right, no worries at all — just say the word and I'll check back down the road.

More about the show: [one_sheet_url]

Best,
[sender]`

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default function FollowupPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  const [subject, setSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT)
  const [body, setBody] = useState(DEFAULT_FOLLOWUP_BODY)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const [minDays, setMinDays] = useState(4)
  const [preview, setPreview] = useState<ApiFollowupPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [testTo, setTestTo] = useState(user?.email ?? 'ryan@strawhutmedia.com')
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  function insertToken(field: 'subject' | 'body', token: string) {
    const el = field === 'subject' ? subjectRef.current : bodyRef.current
    const current = field === 'subject' ? subject : body
    const setter = field === 'subject' ? setSubject : setBody
    if (!el) { setter(current + token); return }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    setter(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    let alive = true
    void api.outreachTemplate(projectId).then((r) => {
      if (!alive) return
      if (r.template?.followup_subject?.trim()) setSubject(r.template.followup_subject)
      if (r.template?.followup_body?.trim()) setBody(r.template.followup_body)
      setTemplateLoaded(true)
    }).catch(() => { if (alive) setTemplateLoaded(true) })
    return () => { alive = false }
  }, [projectId])

  async function saveTemplate() {
    setSaving(true)
    setError(null)
    try {
      await api.saveFollowupTemplate(projectId, { subject, body })
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the follow-up email.')
    } finally {
      setSaving(false)
    }
  }

  async function loadPreview(days = minDays) {
    setLoadingPreview(true)
    setError(null)
    setSendResult(null)
    try {
      const r = await api.followupPreview(projectId, days)
      setPreview(r)
      // Default: everyone eligible is selected.
      setSelected(new Set(r.eligible.map((e) => e.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the preview.')
    } finally {
      setLoadingPreview(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function sendTest() {
    if (!testTo.trim()) return
    setTestSending(true)
    setTestResult(null)
    try {
      const r = await api.testSendFollowup(projectId, testTo.trim())
      setTestResult(`✓ Test follow-up sent to ${r.to} (previewing ${r.previewName}).`)
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Test send failed.')
    } finally {
      setTestSending(false)
    }
  }

  async function send() {
    if (!preview || selected.size === 0) return
    const n = selected.size
    if (!window.confirm(
      `Send a follow-up to ${n} ${n === 1 ? 'person' : 'people'}?\n\n`
      + `These are contacts who got the first email but never replied. Each gets ONE follow-up, `
      + `spaced out so it looks human. Anyone who replies before their turn is automatically skipped.`,
    )) return
    setSending(true)
    setError(null)
    setSendResult(null)
    try {
      const r = await api.sendFollowupCampaign(projectId, {
        prospectIds: Array.from(selected),
        minDays,
      })
      setSendResult(
        `✓ Queued ${r.queued} follow-up${r.queued === 1 ? '' : 's'}. `
        + (r.scheduled
          ? `Starting ${new Date(r.startAt).toLocaleString()}.`
          : `Sending now, jittered 90-180s apart — last one around ${new Date(r.lastAt).toLocaleTimeString()}.`),
      )
      // Refresh so the just-queued people drop out of the eligible list.
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue the follow-ups.')
    } finally {
      setSending(false)
    }
  }

  const templateReady = Boolean(subject.trim() && body.trim())
  const eligible = preview?.eligible ?? []

  return (
    <section className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.04] p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-indigo-300 font-bold">↻ Follow-up nudge</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-2xl">
            Nudge the people who got your first email but never replied — one follow-up each, never anyone who
            already replied, bounced, or opted out. You see the exact list before a single email sends.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-indigo-300/70 whitespace-nowrap">
          {open ? '▲ Hide' : '▼ Open'}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-urgent/40 bg-urgent/5 px-3 py-2 text-xs text-urgent">{error}</div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ── Follow-up template ── */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Follow-up email</h3>
                {savedAt && <span className="text-[10px] text-muted">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
              </div>
              <label className="block">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Subject</span>
                  <TokenBar onInsert={(t) => insertToken('subject', t)} />
                </div>
                <input
                  ref={subjectRef}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Body</span>
                  <TokenBar onInsert={(t) => insertToken('body', t)} />
                </div>
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  disabled={!templateLoaded}
                  className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400"
                />
              </label>
              <button
                onClick={() => void saveTemplate()}
                disabled={saving || !templateReady}
                className="text-[10px] uppercase tracking-wider text-indigo-300 border border-indigo-400/40 rounded-full px-3 py-1.5 hover:bg-indigo-400/10 disabled:opacity-40 font-bold"
              >
                {saving ? 'Saving…' : '💾 Save follow-up'}
              </button>

              {/* Test-send */}
              <div className="rounded-xl border-2 border-amber-400/50 bg-amber-400/10 p-3 space-y-2 mt-1">
                <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">🧪 Test the follow-up</div>
                <div className="text-[10px] text-amber-100/70">
                  Fires the follow-up to one address so you can eyeball it first. Save your edits before testing.
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="you@strawhutmedia.com"
                    className="flex-1 min-w-[200px] bg-ink/40 border border-amber-400/40 rounded-full px-3 py-1.5 text-sm focus:outline-none focus:border-amber-300"
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
                  <div className={`text-[11px] ${testResult.startsWith('✓') ? 'text-emerald-300' : 'text-urgent'}`}>{testResult}</div>
                )}
              </div>
            </div>

            {/* ── Preview + send ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Who gets a follow-up</h3>
                <label className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span className="uppercase tracking-wider font-bold">Sent ≥</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={minDays}
                    onChange={(e) => setMinDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                    className="w-14 bg-ink/40 border border-line rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-400"
                  />
                  <span>days ago</span>
                </label>
              </div>

              <button
                onClick={() => void loadPreview()}
                disabled={loadingPreview}
                className="text-[10px] uppercase tracking-wider text-indigo-200 bg-indigo-500/20 border border-indigo-400/40 rounded-full px-3 py-1.5 hover:bg-indigo-500/30 disabled:opacity-40 font-bold"
              >
                {loadingPreview ? 'Loading…' : '👁 Preview who gets it'}
              </button>

              {preview && (
                <>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 font-bold">
                      {eligible.length} eligible
                    </span>
                    {preview.followupQueued > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold">
                        {preview.followupQueued} queued
                      </span>
                    )}
                    {preview.followupSent > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                        {preview.followupSent} already followed up
                      </span>
                    )}
                  </div>

                  {!preview.templateReady && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                      Write and save the follow-up email before you can send.
                    </div>
                  )}

                  {eligible.length === 0 ? (
                    <p className="text-xs text-muted italic">
                      Nobody's eligible right now — either everyone replied, or their first email is more recent than {minDays} days.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-[10px] text-muted">
                        <button onClick={() => setSelected(new Set(eligible.map((e) => e.id)))} className="uppercase tracking-wider hover:text-fg font-bold">Select all</button>
                        <button onClick={() => setSelected(new Set())} className="uppercase tracking-wider hover:text-fg font-bold">Clear</button>
                      </div>
                      <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
                        {eligible.map((e) => (
                          <label
                            key={e.id}
                            className="flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-2.5 py-1.5 cursor-pointer hover:border-indigo-400/40"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(e.id)}
                              onChange={() => toggle(e.id)}
                              className="accent-indigo-400"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm truncate">{e.name} <span className="text-muted">· {e.email}</span></div>
                              <div className="text-[10px] text-muted/80">
                                First emailed {daysAgo(e.sentAt)}
                                {e.opened ? ` · 👁 opened ${e.openCount}×` : ' · not opened'}
                                {e.batchLabel ? ` · ${e.batchLabel}` : ''}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>

                      <button
                        onClick={() => void send()}
                        disabled={sending || selected.size === 0 || !preview.templateReady}
                        className="w-full text-[11px] uppercase tracking-wider font-bold text-white bg-indigo-500 rounded-full px-4 py-2.5 hover:bg-indigo-400 disabled:opacity-40"
                      >
                        {sending ? 'Queuing…' : `↻ Send follow-up to ${selected.size} selected`}
                      </button>
                    </>
                  )}
                </>
              )}

              {sendResult && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">{sendResult}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
