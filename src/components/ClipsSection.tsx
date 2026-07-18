// Clip generation panel for podcast episodes. Slate's own pipeline:
// pick the episode video → Claude picks the moments from the transcript
// → ffmpeg cuts each as a framed 9:16 vertical with burned captions →
// they show here as playable, downloadable clips. No OpusClip.
import { useEffect, useRef, useState } from 'react'
import { api, type ApiClip, type ApiClipCaption, type ApiClipJob, type ClipJobOptions } from '../api'
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
            Slate reads the transcript, finds the strongest moments for this show, and cuts
            7–15 vertical 9:16 shorts with burned-in captions. Runs automatically on upload;
            needs the episode’s transcript first.
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
  const [clipCount, setClipCount] = useState<number | ''>(12)

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
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState<ApiClip>(clip)
  const bust = useRef(0)

  async function loadLink() {
    setUrl(null); setErr(null)
    try {
      const r = await api.clipLink(current.id)
      // Cache-bust so a re-rendered clip doesn't show the stale video.
      setUrl(`${r.url}${r.url.includes('?') ? '&' : '?'}v=${bust.current}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'link failed')
    }
  }

  useEffect(() => { void loadLink() }, [current.id])

  const dur = current.durationSeconds != null ? `${Math.round(current.durationSeconds)}s` : ''
  const canEdit = (current.captions?.length ?? 0) > 0

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
        <div className="text-[11px] font-bold leading-tight line-clamp-2" title={current.title ?? ''}>
          {current.title || 'Clip'}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span className="tabular-nums">{dur}{current.captioned ? ' · captioned' : ''}</span>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button onClick={() => setEditing(true)} className="uppercase tracking-wider font-bold text-muted hover:text-text">
                ✎ Captions
              </button>
            )}
            {url && (
              <a href={url} download className="uppercase tracking-wider font-bold text-stage-mastering hover:text-text">↓ Save</a>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <CaptionEditor
          clip={current}
          onClose={() => setEditing(false)}
          onSaved={(c) => { setCurrent(c); bust.current += 1; setEditing(false) }}
        />
      )}
    </div>
  )
}

// Synced caption editor — video on one side, its on-screen caption lines
// on the other. Click a line to jump the video there; the playing line
// highlights; edit the text in place; Save re-renders the clip.
function CaptionEditor({
  clip, onClose, onSaved,
}: {
  clip: ApiClip
  onClose: () => void
  onSaved: (updated: ApiClip) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [lines, setLines] = useState<ApiClipCaption[]>(clip.captions ?? [])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const activeRowRef = useRef<HTMLDivElement | null>(null)
  const clipStart = clip.startSeconds ?? 0

  useEffect(() => {
    api.clipLink(clip.id).then((r) => setUrl(r.url)).catch((e) => setErr(e instanceof Error ? e.message : 'link failed'))
  }, [clip.id])

  useEffect(() => { activeRowRef.current?.scrollIntoView({ block: 'nearest' }) }, [activeIdx])

  const rel = (s: number) => Math.max(0, s - clipStart)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  function seekTo(i: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = rel(lines[i].startSeconds)
    void v.play()
  }
  function onTime() {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setActiveIdx(lines.findIndex((l) => t >= rel(l.startSeconds) - 0.05 && t < rel(l.endSeconds)))
  }

  async function save() {
    setSaving(true); setErr(null)
    try {
      const r = await api.editClipCaptions(clip.id, lines)
      onSaved(r.clip)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/85 backdrop-blur-sm p-3" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92vh] rounded-2xl border border-line bg-panel flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
          <div>
            <h3 className="text-sm font-black">Edit captions</h3>
            <p className="text-[11px] text-muted truncate max-w-[70vw]">{clip.title || 'Clip'} — fix a spelling, click a line to jump there</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">×</button>
        </div>

        <div className="flex flex-col md:flex-row min-h-0 flex-1">
          {/* Video */}
          <div className="md:w-[46%] bg-black grid place-items-center p-3 shrink-0">
            {url ? (
              <video ref={videoRef} src={url} controls playsInline onTimeUpdate={onTime}
                className="max-h-[38vh] md:max-h-[70vh] w-auto rounded-lg" />
            ) : (
              <span className="text-[11px] text-muted animate-pulse py-10">loading video…</span>
            )}
          </div>

          {/* Caption lines */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
            {lines.length === 0 && <p className="text-[12px] text-muted italic">No caption lines on this clip.</p>}
            {lines.map((ln, i) => (
              <div
                key={i}
                ref={i === activeIdx ? activeRowRef : null}
                className={`flex items-start gap-2 rounded-lg border p-1.5 transition-colors ${
                  i === activeIdx ? 'border-stage-mastering/60 bg-stage-mastering/10' : 'border-line/50 bg-ink/30'
                }`}
              >
                <button
                  onClick={() => seekTo(i)}
                  className="shrink-0 tabular-nums text-[10px] font-mono text-muted hover:text-stage-mastering border border-line rounded px-1.5 py-1 mt-0.5"
                  title="Jump the video here"
                >
                  {fmt(rel(ln.startSeconds))}
                </button>
                <input
                  value={ln.text}
                  onChange={(e) => setLines((prev) => prev.map((p, j) => j === i ? { ...p, text: e.target.value } : p))}
                  onFocus={() => seekTo(i)}
                  className="flex-1 min-w-0 rounded bg-panel/60 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line/60">
          <span className="text-[11px] text-urgent">{err}</span>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[11px] text-stage-mastering animate-pulse">re-rendering…</span>}
            <button onClick={onClose} disabled={saving} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">Cancel</button>
            <button onClick={() => void save()} disabled={saving || lines.length === 0}
              className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & re-render'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
