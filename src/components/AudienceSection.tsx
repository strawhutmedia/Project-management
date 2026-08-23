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
    </section>
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
