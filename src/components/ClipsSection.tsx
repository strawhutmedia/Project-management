// AI clip generation panel for podcast episodes. Mirrors the transcripts
// flow: pick a Dropbox media file → submit to OpusClip → poll for clips
// → display them as preview cards with download buttons.
import { useEffect, useState } from 'react'
import { api, type ApiClipJob } from '../api'
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

  // Poll every 15s while any job is queued/processing
  useEffect(() => {
    if (!jobs) return
    const inflight = jobs.some((j) => j.status === 'queued' || j.status === 'processing')
    if (!inflight) return
    const id = setInterval(() => void load(), 15_000)
    return () => clearInterval(id)
  }, [jobs])

  async function startNew(path: string, _name: string, size?: number) {
    setPicking(false)
    if (size && size > 30 * 1024 * 1024 * 1024) {
      setError(`File is ${(size / 1e9).toFixed(2)} GB — over OpusClip's 30 GB cap.`)
      return
    }
    setStarting(true)
    setError(null)
    try {
      await api.startClipJob({ projectId, songId, dropboxPath: path })
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
          <p className="text-[11px] text-muted/80 mt-1">
            Pick a video file from Dropbox · AI-generated short clips via OpusClip · download for socials.
          </p>
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
          onSelect={(path, name, size) => void startNew(path, name, size)}
          onCancel={() => setPicking(false)}
        />
      )}
    </section>
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
              {job.status === 'processing' ? 'Processing…' :
               job.status === 'queued' ? 'Queued' :
               job.status}
            </span>
            {job.clips.length > 0 && (
              <span>{job.clips.length} {job.clips.length === 1 ? 'clip' : 'clips'}</span>
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

      {job.clips.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {job.clips.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClipCard({ clip }: { clip: { id: string; title: string | null; durationSeconds: number | null; previewUrl: string | null; downloadUrl: string | null; thumbnailUrl: string | null; score: number | null } }) {
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
          {clip.downloadUrl && (
            <a
              href={clip.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="uppercase tracking-wider font-bold text-stage-mastering hover:text-text"
            >
              ⬇ Download
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
