// Episode-level transcripts panel. Each transcript belongs to a specific
// episode (song); the project-level page just shows a read-only digest
// of every transcript across the project, linking back to the episode.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ApiTranscript } from '../api'
import DropboxFilePicker from './DropboxFilePicker'

export default function TranscriptsSection({
  projectId,
  songId,
  canWrite,
  projectRoot,
}: {
  projectId: string
  songId?: string
  canWrite: boolean
  // Project's Dropbox root, so the file picker is scoped to the show's
  // folder tree — users can navigate into subfolders but never above.
  projectRoot?: string | null
}) {
  const [transcripts, setTranscripts] = useState<ApiTranscript[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [starting, setStarting] = useState(false)

  async function load() {
    try {
      const { transcripts } = await api.transcripts(projectId)
      // Filter to this episode only if a songId is provided.
      setTranscripts(songId ? transcripts.filter((t) => t.songId === songId) : transcripts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [projectId, songId])

  // Refresh while any transcript is queued/transcribing
  useEffect(() => {
    if (!transcripts) return
    const inflight = transcripts.some((t) => t.status === 'queued' || t.status === 'transcribing')
    if (!inflight) return
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [transcripts])

  async function startNew(path: string, _name: string, size?: number) {
    setPicking(false)
    if (size && size > 10 * 1024 * 1024 * 1024) {
      setError(`File is ${(size / 1e9).toFixed(2)} GB — over the 10 GB transcription cap.`)
      return
    }
    setStarting(true)
    setError(null)
    try {
      await api.startTranscript({ projectId, songId, dropboxPath: path })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to start transcription')
    } finally {
      setStarting(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete transcript for "${name}"? This cannot be undone.`)) return
    try {
      await api.deleteTranscript(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete')
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📝 Transcripts</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Pick a media file from Dropbox · auto-transcribed via Deepgram · edit + export SRT.
          </p>
        </div>
        {canWrite && songId && (
          <button
            onClick={() => setPicking(true)}
            disabled={starting}
            className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
          >
            {starting ? 'Starting…' : '+ New transcription'}
          </button>
        )}
      </div>

      {error && <p className="text-urgent text-sm">{error}</p>}

      {transcripts === null ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : transcripts.length === 0 ? (
        <p className="text-muted/70 text-sm italic py-4 text-center border border-dashed border-line/60 rounded-xl">
          {songId
            ? 'No transcripts for this episode yet. Tap "+ New transcription".'
            : 'No transcripts yet. Open an episode to start one.'}
        </p>
      ) : (
        <div className="space-y-2">
          {transcripts.map((t) => (
            <TranscriptRow key={t.id} t={t} projectId={projectId} canWrite={canWrite} onDelete={() => void remove(t.id, t.fileName)} />
          ))}
        </div>
      )}

      {picking && (
        <DropboxFilePicker
          title="Pick a media file"
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

function TranscriptRow({
  t,
  projectId,
  canWrite,
  onDelete,
}: {
  t: ApiTranscript
  projectId: string
  canWrite: boolean
  onDelete: () => void
}) {
  const statusColor =
    t.status === 'done' ? 'text-stage-stems' :
    t.status === 'failed' ? 'text-urgent' :
    'text-stage-mastering'

  return (
    <div className="rounded-xl border border-line bg-ink/30 p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate">{t.fileName}</div>
        <div className="text-[11px] text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <span className={`uppercase tracking-wider font-bold ${statusColor}`}>
            {t.status === 'transcribing' ? 'Transcribing…' : t.status}
          </span>
          {t.durationSeconds && <span>{fmtDuration(t.durationSeconds)}</span>}
          {t.fileSizeBytes && <span>{(t.fileSizeBytes / 1e6).toFixed(1)} MB</span>}
        </div>
        {t.error && <div className="text-[11px] text-urgent mt-1">{t.error}</div>}
      </div>
      <div className="flex items-center gap-1.5">
        {t.status === 'done' && (
          <Link
            to={`/projects/${projectId}/transcripts/${t.id}`}
            className="text-[11px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-2.5 py-1 hover:bg-stage-mastering/10"
          >
            Open
          </Link>
        )}
        {canWrite && (
          <button
            onClick={onDelete}
            className="text-[11px] uppercase tracking-wider text-muted border border-line rounded-full px-2.5 py-1 hover:text-urgent hover:border-urgent/50"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

function fmtDuration(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
