// Clip generation panel for podcast episodes. Slate's own pipeline:
// pick the episode video → Claude picks the moments from the transcript
// → ffmpeg cuts each as a framed 9:16 vertical with burned captions →
// they show here as playable, downloadable clips. No OpusClip.
import { useEffect, useRef, useState } from 'react'
import { api, type ApiClip, type ApiClipJob, type ClipJobOptions } from '../api'
import DropboxFilePicker from './DropboxFilePicker'

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

  async function load() {
    try {
      const { jobs } = await api.clipJobs(songId)
      setJobs(jobs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [songId])

  // Poll every 15s while any job is still cutting.
  useEffect(() => {
    if (!jobs) return
    const inflight = jobs.some((j) => j.status === 'queued' || j.status === 'processing')
    if (!inflight) return
    const id = setInterval(() => void load(), 15_000)
    return () => clearInterval(id)
  }, [jobs])

  function onFilePicked(path: string, name: string, size?: number) {
    setPicking(false)
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
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">✂️ Clips</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-md">
            Slate reads the transcript, picks the strongest moments, and cuts each into a
            vertical 9:16 short with burned-in captions. Needs the episode’s transcript first.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setPicking(true)}
            disabled={starting}
            className="rounded-xl bg-gradient-to-r from-stage-mixing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
          >
            {starting ? 'Starting…' : '+ Generate clips'}
          </button>
        )}
      </div>

      {error && <p className="text-urgent text-sm">{error}</p>}

      {jobs === null ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-muted/70 text-sm italic py-4 text-center border border-dashed border-line/60 rounded-xl">
          {canWrite
            ? 'No clips yet. Tap “+ Generate clips” and pick the episode video.'
            : 'No clips generated yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <ClipJobCard key={j.id} job={j} canWrite={canWrite} onDelete={() => void remove(j.id, j.fileName)} />
          ))}
        </div>
      )}

      {picking && (
        <DropboxFilePicker
          title="Pick the episode video to clip"
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
  const [clipCount, setClipCount] = useState<number | ''>(6)

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
            What should the clips lean into? (optional)
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={'e.g. The funniest moments where Cheri talks about her early SNL days. Skip ad reads and the intro.'}
            className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering resize-y"
          />
          <p className="text-[10px] text-muted/60 mt-1">
            Plain English — steers which moments Claude picks. Leave blank to let it choose the best.
          </p>
        </label>

        <label className="block max-w-[140px]">
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1"># of clips</div>
          <input
            type="number"
            min={1}
            max={20}
            value={clipCount}
            onChange={(e) => setClipCount(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering"
          />
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={submitting} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={() => onSubmit({
              prompt: prompt.trim() || null,
              clipCount: typeof clipCount === 'number' ? clipCount : null,
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
  onDelete,
}: {
  job: ApiClipJob
  canWrite: boolean
  onDelete: () => void
}) {
  const statusColor =
    job.status === 'done' ? 'text-stage-stems' :
    job.status === 'failed' ? 'text-urgent' :
    'text-stage-mastering'

  return (
    <div className="rounded-xl border border-line bg-ink/30 p-3 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate">{job.fileName}</div>
          <div className="text-[11px] text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className={`uppercase tracking-wider font-bold ${statusColor}`}>
              {job.status === 'processing' ? 'Cutting…' :
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
        {canWrite && (
          <button
            onClick={onDelete}
            className="text-[11px] uppercase tracking-wider text-muted hover:text-urgent border border-line rounded-full px-2.5 py-1"
          >
            ✕
          </button>
        )}
      </div>

      {job.status === 'processing' && (
        <p className="text-[11px] text-muted italic">
          Picking moments and cutting vertical clips — this can take a few minutes on a long episode.
        </p>
      )}

      {job.clips.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {job.clips.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClipCard({ clip }: { clip: ApiClip }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const asked = useRef(false)

  async function loadLink() {
    if (asked.current) return
    asked.current = true
    try {
      const r = await api.clipLink(clip.id)
      setUrl(r.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'link failed')
    }
  }

  useEffect(() => { void loadLink() }, [clip.id])

  const dur = clip.durationSeconds != null ? `${Math.round(clip.durationSeconds)}s` : ''

  return (
    <div className="rounded-lg border border-line bg-ink/40 overflow-hidden flex flex-col">
      <div className="relative bg-black aspect-[9/16] grid place-items-center">
        {url ? (
          <video src={url} controls playsInline className="w-full h-full object-contain" />
        ) : err ? (
          <span className="text-[10px] text-urgent px-2 text-center">{err}</span>
        ) : (
          <span className="text-[10px] text-muted animate-pulse">loading…</span>
        )}
      </div>
      <div className="p-2 space-y-1">
        <div className="text-[11px] font-bold leading-tight line-clamp-2" title={clip.title ?? ''}>
          {clip.title || 'Clip'}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span className="tabular-nums">{dur}{clip.captioned ? ' · captioned' : ''}</span>
          {url && (
            <a href={url} download className="uppercase tracking-wider font-bold text-stage-mastering hover:text-text">
              ↓ Save
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
