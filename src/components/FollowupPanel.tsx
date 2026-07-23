import { useEffect, useRef, useState } from 'react'
import { api, type ApiFollowupPreview } from '../api'
import { useAuth } from '../auth'
import { TokenBar } from './OutreachTokens'

// Follow-up emails — a friendly reminder to people who got the first email but
// never wrote back. Built to be simple to follow top-to-bottom, and safe:
//   • The screen shows the EXACT people who will get a reminder before anything
//     sends. Anyone who already replied, bounced, or opted out never appears.
//   • Each person gets ONE reminder, ever.
// (Server enforces all of that too — see server/routes/outreach.ts.)

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

// Small numbered badge that heads each step.
function StepNum({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0 ${
        done ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white'
      }`}
    >
      {done ? '✓' : n}
    </span>
  )
}

export default function FollowupPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  const [subject, setSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT)
  const [body, setBody] = useState(DEFAULT_FOLLOWUP_BODY)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [savedSubject, setSavedSubject] = useState('')
  const [savedBody, setSavedBody] = useState('')
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
      const s = r.template?.followup_subject?.trim() ? r.template.followup_subject : DEFAULT_FOLLOWUP_SUBJECT
      const b = r.template?.followup_body?.trim() ? r.template.followup_body : DEFAULT_FOLLOWUP_BODY
      setSubject(s); setBody(b)
      // Track what's saved so we can tell the user when they have unsaved edits.
      setSavedSubject(r.template?.followup_subject?.trim() ? r.template.followup_subject : '')
      setSavedBody(r.template?.followup_body?.trim() ? r.template.followup_body : '')
      setTemplateLoaded(true)
    }).catch(() => { if (alive) setTemplateLoaded(true) })
    return () => { alive = false }
  }, [projectId])

  async function saveTemplate() {
    setSaving(true)
    setError(null)
    try {
      await api.saveFollowupTemplate(projectId, { subject, body })
      setSavedSubject(subject); setSavedBody(body)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the message. Try again.')
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
      setSelected(new Set(r.eligible.map((e) => e.id))) // everyone checked by default
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the list. Try again.')
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
      setTestResult(`✓ Test sent to ${r.to}. Check that inbox to see how the reminder looks.`)
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Could not send the test. Save your message first, then try again.')
    } finally {
      setTestSending(false)
    }
  }

  async function send() {
    if (!preview || selected.size === 0) return
    const n = selected.size
    if (!window.confirm(
      `Send a reminder to ${n} ${n === 1 ? 'person' : 'people'}?\n\n`
      + `• Each person gets one reminder only.\n`
      + `• Slate sends them one at a time with a short gap, so it looks natural.\n`
      + `• If anyone replies before their turn, they're skipped automatically.`,
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
        `✓ Done! ${r.queued} reminder${r.queued === 1 ? '' : 's'} on the way. `
        + `Slate sends them one at a time — the last one goes out around ${new Date(r.lastAt).toLocaleTimeString()}. `
        + `You don't need to keep this page open.`,
      )
      await loadPreview() // refresh so the sent people drop off the list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send. Try again.')
    } finally {
      setSending(false)
    }
  }

  const messageWritten = Boolean(subject.trim() && body.trim())
  const messageSaved = messageWritten && subject === savedSubject && body === savedBody
  const eligible = preview?.eligible ?? []

  return (
    <section className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.04] p-4 sm:p-5">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-indigo-300 font-bold">✉ Send follow-up reminders</h2>
          <p className="text-xs text-muted/90 mt-1 max-w-2xl leading-relaxed">
            A friendly nudge to the people who got your first email but haven't written back yet.
          </p>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-indigo-300/80 whitespace-nowrap border border-indigo-400/30 rounded-full px-3 py-1">
          {open ? 'Close' : 'Open'}
        </span>
      </button>

      {open && (
        <div className="mt-5 space-y-4">
          {/* Plain-language "how this works" note */}
          <div className="rounded-xl bg-indigo-500/10 border border-indigo-400/20 px-4 py-3 text-xs text-indigo-100/90 leading-relaxed">
            <span className="font-bold text-indigo-200">How this works:</span> Slate only reminds people who
            haven't replied. Everyone else — anyone who already answered, or asked to stop — is left out
            automatically. Each person gets <span className="font-bold">one reminder, ever</span>. You'll always
            see the exact list before anything sends.
          </div>

          {error && (
            <div className="rounded-lg border border-urgent/40 bg-urgent/5 px-3 py-2 text-xs text-urgent">{error}</div>
          )}

          {/* ── STEP 1 — Write the message ── */}
          <div className="rounded-xl border border-line bg-ink/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <StepNum n={1} done={messageSaved} />
              <h3 className="text-sm font-bold">Write the reminder</h3>
              {savedAt && messageSaved && <span className="text-[11px] text-emerald-300 ml-auto">Saved ✓</span>}
              {!messageSaved && messageWritten && templateLoaded && (
                <span className="text-[11px] text-amber-300 ml-auto">Not saved yet</span>
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed">
              Words in brackets fill in on their own — <code className="text-indigo-300">[name]</code> becomes each
              person's name, <code className="text-indigo-300">[sender]</code> becomes your name. Tap a bracket
              button to drop one in. When you're happy, tap <span className="font-bold">Save</span>.
            </p>

            <label className="block">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <span className="text-[11px] font-bold text-muted">Subject line</span>
                <TokenBar onInsert={(t) => insertToken('subject', t)} />
              </div>
              <input
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              />
            </label>

            <label className="block">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <span className="text-[11px] font-bold text-muted">Message</span>
                <TokenBar onInsert={(t) => insertToken('body', t)} />
              </div>
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={13}
                disabled={!templateLoaded}
                className="w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-indigo-400"
              />
            </label>

            <button
              onClick={() => void saveTemplate()}
              disabled={saving || !messageWritten || messageSaved}
              className="text-xs font-bold text-white bg-indigo-500 rounded-lg px-4 py-2 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : messageSaved ? 'Saved ✓' : '💾 Save message'}
            </button>
          </div>

          {/* ── STEP 2 — See who gets it ── */}
          <div className="rounded-xl border border-line bg-ink/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <StepNum n={2} done={Boolean(preview)} />
              <h3 className="text-sm font-bold">See who will get a reminder</h3>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              These are people who got the first email but haven't replied. You can uncheck anyone you want to skip.
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void loadPreview()}
                disabled={loadingPreview}
                className="text-xs font-bold text-indigo-100 bg-indigo-500/25 border border-indigo-400/40 rounded-lg px-4 py-2 hover:bg-indigo-500/40 disabled:opacity-40"
              >
                {loadingPreview ? 'Loading…' : preview ? '↻ Refresh the list' : '👁 Show me the list'}
              </button>
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                <span>Only people first emailed over</span>
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

            {preview && (
              <div className="space-y-2">
                {eligible.length === 0 ? (
                  <p className="text-xs text-muted italic bg-ink/30 rounded-lg px-3 py-3">
                    Nobody needs a reminder right now — either everyone has replied, or their first email went out
                    less than {minDays} days ago. Try lowering the number above, or check back later.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted">
                        <span className="font-bold text-fg">{selected.size}</span> of {eligible.length} selected
                      </span>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setSelected(new Set(eligible.map((e) => e.id)))} className="text-indigo-300 hover:text-indigo-200 font-bold">Check all</button>
                        <button onClick={() => setSelected(new Set())} className="text-muted hover:text-fg font-bold">Uncheck all</button>
                      </div>
                    </div>
                    <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                      {eligible.map((e) => (
                        <label
                          key={e.id}
                          className="flex items-center gap-3 rounded-lg border border-line bg-ink/30 px-3 py-2 cursor-pointer hover:border-indigo-400/40"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => toggle(e.id)}
                            className="w-4 h-4 accent-indigo-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate">{e.name}</div>
                            <div className="text-[11px] text-muted truncate">{e.email}</div>
                          </div>
                          <div className="text-[11px] text-muted text-right shrink-0">
                            <div>First email {daysAgo(e.sentAt)}</div>
                            <div className={e.opened ? 'text-sky-300' : 'text-muted/70'}>
                              {e.opened ? `👁 opened it ${e.openCount}×` : 'not opened'}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    {preview.followupSent > 0 && (
                      <p className="text-[11px] text-muted">
                        {preview.followupSent} {preview.followupSent === 1 ? 'person has' : 'people have'} already
                        gotten a reminder — they won't get another.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── STEP 3 — Test it (optional) ── */}
          <div className="rounded-xl border border-line bg-ink/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <StepNum n={3} />
              <h3 className="text-sm font-bold">Send yourself a test <span className="text-muted font-normal text-xs">(optional, but a good idea)</span></h3>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              This sends the reminder to just you, so you can see exactly how it looks before the real thing.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@strawhutmedia.com"
                className="flex-1 min-w-[200px] bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              />
              <button
                onClick={() => void sendTest()}
                disabled={testSending || !testTo.trim()}
                className="text-xs font-bold text-indigo-100 bg-indigo-500/25 border border-indigo-400/40 rounded-lg px-4 py-2 hover:bg-indigo-500/40 disabled:opacity-40"
              >
                {testSending ? 'Sending…' : '✉ Send test to me'}
              </button>
            </div>
            {testResult && (
              <div className={`text-xs ${testResult.startsWith('✓') ? 'text-emerald-300' : 'text-urgent'}`}>{testResult}</div>
            )}
          </div>

          {/* ── STEP 4 — Send ── */}
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <StepNum n={4} />
              <h3 className="text-sm font-bold">Send the reminders</h3>
            </div>
            {!messageSaved && (
              <p className="text-xs text-amber-300">First, save your message up in Step 1.</p>
            )}
            {messageSaved && !preview && (
              <p className="text-xs text-amber-300">First, show the list in Step 2.</p>
            )}
            {messageSaved && preview && selected.size === 0 && eligible.length > 0 && (
              <p className="text-xs text-amber-300">Check at least one person in Step 2.</p>
            )}
            <button
              onClick={() => void send()}
              disabled={sending || !messageSaved || !preview || selected.size === 0}
              className="w-full text-sm font-bold text-white bg-indigo-500 rounded-lg px-4 py-3 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending
                ? 'Sending…'
                : selected.size > 0
                  ? `Send reminder to ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`
                  : 'Send reminders'}
            </button>
            {sendResult && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-100 leading-relaxed">{sendResult}</div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
