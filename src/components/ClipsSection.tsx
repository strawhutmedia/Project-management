// AI clip generation panel for podcast episodes. Mirrors the transcripts
// flow: pick a Dropbox media file → submit to OpusClip → poll for clips
// → display them as preview cards with download buttons.
import { useEffect, useState } from 'react'
import { api, type ApiClipJob, type ApiOpusAccount, type ClipJobOptions } from '../api'
import DropboxFilePicker from './DropboxFilePicker'
import { useAuth } from '../auth'

export default function ClipsSection({
  projectId,
  songId,
  canWrite,
  projectRoot,
}: {
  projectId: string
  songId: string
  canWrite: boolean
  projectRoot?: string | null
}) {
  const [jobs, setJobs] = useState<ApiClipJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ path: string; name: string; size?: number } | null>(null)
  const [starting, setStarting] = useState(false)
  const [account, setAccount] = useState<ApiOpusAccount | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  async function load() {
    try {
      const { jobs } = await api.clipJobs(songId)
      setJobs(jobs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [songId])

  // Best-effort OpusClip balance pull. If their API doesn't expose it
  // via any of the patterns we try, we hide the chip.
  useEffect(() => {
    void api.opusAccount().then(setAccount).catch(() => setAccount({ available: false }))
  }, [])

  // Poll every 15s while any job is queued/processing
  useEffect(() => {
    if (!jobs) return
    const inflight = jobs.some((j) => j.status === 'queued' || j.status === 'processing')
    if (!inflight) return
    const id = setInterval(() => void load(), 15_000)
    return () => clearInterval(id)
  }, [jobs])

  // File picked → stash and open the options panel. Submission happens
  // from there so the user can drive count / focus / length first.
  function onFilePicked(path: string, name: string, size?: number) {
    setPicking(false)
    if (size && size > 30 * 1024 * 1024 * 1024) {
      setError(`File is ${(size / 1e9).toFixed(2)} GB — over OpusClip's 30 GB cap.`)
      return
    }
    setPendingFile({ path, name, size })
    setError(null)
  }

  async function submitWithOptions(options: ClipJobOptions) {
    if (!pendingFile) return
    setStarting(true); setError(null)
    try {
      await api.startClipJob({ projectId, songId, dropboxPath: pendingFile.path, options })
      setPendingFile(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to start clip job')
    } finally {
      setStarting(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete clip job for "${name}"? Generated clips will also be removed from Slate.`)) return
    try {
      await api.deleteClipJob(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete')
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">✂️ Clips</h2>
            <p className="text-[11px] text-muted/80 mt-1">
              Pick a video, tell Slate what kind of clips you want, OpusClip cuts them.
            </p>
          </div>
          <OpusBalanceChip account={account} />
        </div>
        {canWrite && (
          <button
            onClick={() => setPicking(true)}
            disabled={starting}
            className="rounded-xl bg-gradient-to-r from-stage-mixing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
          >
            {starting ? 'Starting…' : '+ New clip job'}
          </button>
        )}
      </div>

      {error && <p className="text-urgent text-sm">{error}</p>}

      {jobs === null ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-muted/70 text-sm italic py-4 text-center border border-dashed border-line/60 rounded-xl">
          {canWrite
            ? 'No clip jobs yet. Tap "+ New clip job" to pick a Dropbox video.'
            : 'No clips generated yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <ClipJobCard
              key={j.id}
              job={j}
              canWrite={canWrite}
              isAdmin={isAdmin}
              onDelete={() => void remove(j.id, j.fileName)}
            />
          ))}
        </div>
      )}

      {picking && (
        <DropboxFilePicker
          title="Pick a video for clip generation"
          acceptExtensions={['.mp4', '.mov', '.webm', '.m4v', '.mkv']}
          initialPath={projectRoot ?? undefined}
          restrictAbove={projectRoot ?? undefined}
          scopeProjectId={projectId}
          onSelect={onFilePicked}
          onCancel={() => setPicking(false)}
        />
      )}

      {pendingFile && (
        <ClipOptionsDialog
          fileName={pendingFile.name}
          submitting={starting}
          onCancel={() => setPendingFile(null)}
          onSubmit={submitWithOptions}
        />
      )}
    </section>
  )
}

function OpusBalanceChip({ account }: { account: ApiOpusAccount | null }) {
  if (!account || !account.available) return null
  const minutes = account.minutesRemaining
  const total = account.minutesTotal
  if (minutes == null && account.creditsRemaining == null) {
    return (
      <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border border-line text-muted" title="OpusClip account reachable but balance fields not exposed via the endpoint we found">
        OpusClip: ✓ linked
      </span>
    )
  }
  const low = minutes != null && total != null && minutes / total < 0.2
  const label = minutes != null
    ? `${minutes} min${total ? ` / ${total}` : ''}`
    : `${account.creditsRemaining} cr${account.creditsTotal ? ` / ${account.creditsTotal}` : ''}`
  return (
    <a
      href="https://clip.opus.pro/"
      target="_blank"
      rel="noreferrer"
      className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border ${
        low ? 'border-urgent/60 text-urgent bg-urgent/10' : 'border-stage-stems/40 text-stage-stems'
      }`}
      title="OpusClip remaining balance — click to open OpusClip"
    >
      OpusClip: {label}
    </a>
  )
}

function ClipOptionsDialog({
  fileName,
  submitting,
  onCancel,
  onSubmit,
}: {
  fileName: string
  submitting: boolean
  onCancel: () => void
  onSubmit: (options: ClipJobOptions) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [clipCount, setClipCount] = useState<number | ''>(10)
  const [minDuration, setMinDuration] = useState<number | ''>(15)
  const [maxDuration, setMaxDuration] = useState<number | ''>(60)
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/80 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-display text-rainbow uppercase tracking-widest">Generate clips</h3>
            <p className="text-[11px] text-muted truncate mt-1">{fileName}</p>
          </div>
          <button onClick={onCancel} className="text-muted hover:text-text text-xl leading-none">×</button>
        </div>

        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">
            What kind of clips do you want?
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={'e.g. Focus on the funniest moments where Cheri talks about her early SNL days. Skip ad breaks and the intro music.'}
            className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering resize-y"
          />
          <p className="text-[10px] text-muted/60 mt-1">
            Plain English. Used as a hint to OpusClip's AI when picking moments. Leave blank to let
            it choose freely.
          </p>
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1"># of clips</div>
            <input
              type="number"
              min={1}
              max={50}
              value={clipCount}
              onChange={(e) => setClipCount(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering"
            />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Min length (s)</div>
            <input
              type="number"
              min={5}
              max={180}
              value={minDuration}
              onChange={(e) => setMinDuration(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering"
            />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Max length (s)</div>
            <input
              type="number"
              min={10}
              max={300}
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering"
            />
          </label>
        </div>
        <p className="text-[10px] text-muted/60 -mt-2">
          Heads-up: OpusClip's API doesn't publicly document every parameter. We send these
          best-effort — their AI may still pick its own count/length if it disagrees.
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={submitting} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={() => onSubmit({
              prompt: prompt.trim() || null,
              clipCount: typeof clipCount === 'number' ? clipCount : null,
              minDuration: typeof minDuration === 'number' ? minDuration : null,
              maxDuration: typeof maxDuration === 'number' ? maxDuration : null,
            })}
            disabled={submitting}
            className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Generate clips'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClipJobCard({
  job,
  canWrite,
  isAdmin,
  onDelete,
}: {
  job: ApiClipJob
  canWrite: boolean
  isAdmin: boolean
  onDelete: () => void
}) {
  const statusColor =
    job.status === 'done' ? 'text-stage-stems' :
    job.status === 'failed' ? 'text-urgent' :
    'text-stage-mastering'

  const [rawOpen, setRawOpen] = useState(false)
  const [raw, setRaw] = useState<{ createResponse: unknown; pollResponse: unknown } | null>(null)
  async function loadRaw() {
    setRawOpen(true)
    if (raw) return
    try {
      const r = await api.clipJobRaw(job.id)
      setRaw(r)
    } catch {
      setRaw({ createResponse: 'fetch failed', pollResponse: null })
    }
  }

  const opusUrl = job.opusProjectId ? `https://clip.opus.pro/projects/${job.opusProjectId}` : null

  return (
    <div className="rounded-xl border border-line bg-ink/30 p-3 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate">{job.fileName}</div>
          <div className="text-[11px] text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className={`uppercase tracking-wider font-bold ${statusColor}`}>
              {job.status === 'processing' ? 'Processing…' :
               job.status === 'queued' ? 'Queued' :
               job.status}
            </span>
            {job.clips.length > 0 && (
              <span>{job.clips.length} {job.clips.length === 1 ? 'clip' : 'clips'}</span>
            )}
            {job.options?.prompt && (
              <span className="italic truncate max-w-[280px]" title={job.options.prompt}>
                “{job.options.prompt}”
              </span>
            )}
          </div>
          {job.error && <div className="text-[11px] text-urgent mt-1">{job.error}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          {opusUrl && (
            <a
              href={opusUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-2.5 py-1 hover:bg-stage-mastering/10 whitespace-nowrap"
              title="Open this project in OpusClip to preview + download all clips"
            >
              ↗ Open in OpusClip
            </a>
          )}
          {isAdmin && (
            <button
              onClick={() => void loadRaw()}
              className="text-[10px] uppercase tracking-wider text-muted hover:text-text border border-line rounded-full px-2 py-1"
              title="Show raw OpusClip API response (admin only)"
            >
              { } raw
            </button>
          )}
          {isAdmin && (
            <button
              onClick={async () => {
                try {
                  const r = raw ?? await api.clipJobRaw(job.id)
                  if (!raw) setRaw(r)
                  await navigator.clipboard.writeText(JSON.stringify(r, null, 2))
                  alert('Raw OpusClip response copied to clipboard.')
                } catch (err) {
                  alert('Copy failed: ' + (err instanceof Error ? err.message : String(err)))
                }
              }}
              className="text-[10px] uppercase tracking-wider text-muted hover:text-text border border-line rounded-full px-2 py-1"
              title="Copy raw OpusClip JSON to clipboard"
            >
              📋 copy raw
            </button>
          )}
          {canWrite && (
            <button
              onClick={onDelete}
              className="text-[11px] uppercase tracking-wider text-muted hover:text-urgent border border-line rounded-full px-2.5 py-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {rawOpen && (
        <details open className="rounded-lg border border-line/60 bg-ink/40 p-2 text-[10px]">
          <summary className="cursor-pointer text-muted uppercase tracking-wider font-bold">
            Raw OpusClip response · <button onClick={() => setRawOpen(false)} className="text-muted/60 hover:text-text">close</button>
          </summary>
          <div className="mt-2 space-y-3">
            <div>
              <div className="text-muted/70 font-bold mb-1">CREATE response</div>
              <pre className="overflow-x-auto bg-ink/60 rounded p-2 text-text/80 whitespace-pre-wrap break-words">
                {JSON.stringify(raw?.createResponse, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-muted/70 font-bold mb-1">Latest POLL response</div>
              <pre className="overflow-x-auto bg-ink/60 rounded p-2 text-text/80 whitespace-pre-wrap break-words">
                {JSON.stringify(raw?.pollResponse, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      )}

      {job.clips.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {job.clips.map((c) => (
            <ClipCard key={c.id} clip={c} opusProjectId={job.opusProjectId ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClipCard({ clip, opusProjectId }: {
  clip: { id: string; title: string | null; durationSeconds: number | null; previewUrl: string | null; downloadUrl: string | null; thumbnailUrl: string | null; score: number | null }
  opusProjectId: string | null
}) {
  const hasPlayable = !!clip.previewUrl || !!clip.thumbnailUrl
  // Until OpusClip's per-clip export endpoint is wired, the only way to
  // actually see/download a clip is in OpusClip's UI. Make every card
  // a link there as the default behavior.
  const opusUrl = opusProjectId ? `https://clip.opus.pro/projects/${opusProjectId}` : null
  return (
    <div className="rounded-lg border border-line/60 bg-panel/40 overflow-hidden flex flex-col">
      <div className="aspect-[9/16] bg-ink relative">
        {clip.previewUrl ? (
          <video
            src={clip.previewUrl}
            poster={clip.thumbnailUrl ?? undefined}
            controls
            preload="metadata"
            className="w-full h-full object-cover"
          />
        ) : clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} alt={clip.title ?? ''} className="w-full h-full object-cover" />
        ) : opusUrl ? (
          <a
            href={opusUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full h-full grid place-items-center text-muted text-xs hover:bg-ink/60 transition gap-1"
            title="OpusClip hasn't returned a preview URL — open in OpusClip to view + download"
          >
            <span className="text-2xl">↗</span>
            <span className="text-[10px] uppercase tracking-wider">Open in OpusClip</span>
          </a>
        ) : (
          <div className="w-full h-full grid place-items-center text-muted text-xs">No preview</div>
        )}
        {clip.score != null && (
          <span className="absolute top-1.5 right-1.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-stage-mastering/80 text-white rounded-full px-1.5 py-0.5">
            {Math.round(clip.score)}
          </span>
        )}
      </div>
      <div className="p-2 space-y-1">
        {clip.title && (
          <div className="text-[11px] font-bold leading-tight line-clamp-2">{clip.title}</div>
        )}
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
          {clip.durationSeconds != null && <span>{Math.round(clip.durationSeconds)}s</span>}
          {clip.downloadUrl ? (
            <a
              href={clip.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="uppercase tracking-wider font-bold text-stage-mastering hover:text-text"
            >
              ⬇ Download
            </a>
          ) : opusUrl && !hasPlayable ? (
            <a
              href={opusUrl}
              target="_blank"
              rel="noreferrer"
              className="uppercase tracking-wider font-bold text-stage-mastering hover:text-text"
            >
              ↗ OpusClip
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
