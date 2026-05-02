// rev.com-style transcript editor with synced media playback.
//
// Phase 2 features added in this pass:
//   - Sticky <audio> or <video> player at the top, streaming from the
//     transcript's source file via a fresh Dropbox temp link.
//   - Click any block to seek the player to that block's start.
//   - "Speakers" panel listing every unique speaker with a rename
//     control that updates every block at once.
//   - Per-block ▶ button to play from that block's start.
//
// Phase 3 (later): word-level click-to-seek, drag word boundaries,
// SCC export.
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { api, type ApiTranscript, type ApiTranscriptBlock } from '../api'

const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.m4v', '.mkv']

function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXT.some((ext) => lower.endsWith(ext))
}

export default function TranscriptPage() {
  const { transcriptId, projectId } = useParams()
  const [transcript, setTranscript] = useState<ApiTranscript | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const mediaRef = useRef<HTMLMediaElement | null>(null)

  useEffect(() => {
    if (!transcriptId) return
    api.transcript(transcriptId)
      .then(({ transcript }) => setTranscript(transcript))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
    api.transcriptMediaUrl(transcriptId)
      .then(({ url }) => setMediaUrl(url))
      .catch(() => {
        // Non-fatal — editor still works without playback.
      })
  }, [transcriptId])

  // Track which block is "playing" by polling currentTime against block ranges.
  useEffect(() => {
    if (!transcript || !mediaRef.current) return
    const blocks = transcript.editedBlocks ?? []
    const el = mediaRef.current
    let raf = 0
    function tick() {
      const t = el.currentTime
      const found = blocks.find((b) => t >= b.start && t < b.end)
      if (found && found.id !== activeBlockId) setActiveBlockId(found.id)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [transcript, mediaUrl, activeBlockId])

  function scheduleSave(next: ApiTranscript) {
    setTranscript(next)
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await api.updateTranscript(next.id, {
            editedBlocks: next.editedBlocks,
            startOffsetMs: next.startOffsetMs,
            frameRate: next.frameRate,
            dropFrame: next.dropFrame,
          })
          setSavedAt(new Date())
        } catch (err) {
          setError(err instanceof Error ? err.message : 'save failed')
        }
      })()
    }, 800)
  }

  if (error) return <div className="text-muted">{error}. <Link to="/" className="underline">Back</Link></div>
  if (!transcript) return <p className="text-muted text-sm">Loading…</p>
  if (transcript.status !== 'done') {
    return <Navigate to={`/projects/${projectId ?? transcript.projectId}`} replace />
  }

  const blocks = transcript.editedBlocks ?? []
  const isVideo = isVideoFile(transcript.fileName)

  function updateBlock(idx: number, patch: Partial<ApiTranscriptBlock>) {
    const next = [...blocks]
    next[idx] = { ...next[idx], ...patch }
    scheduleSave({ ...transcript!, editedBlocks: next })
  }

  function renameSpeakerEverywhere(oldLabel: string, newLabel: string) {
    if (oldLabel === newLabel || !newLabel.trim()) return
    const next = blocks.map((b) => (b.speaker === oldLabel ? { ...b, speaker: newLabel.trim() } : b))
    scheduleSave({ ...transcript!, editedBlocks: next })
  }

  function seekTo(seconds: number) {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = Math.max(0, seconds)
    void el.play().catch(() => {})
  }

  // Unique speakers, ordered by first appearance + count.
  const speakerCounts = new Map<string, number>()
  for (const b of blocks) speakerCounts.set(b.speaker, (speakerCounts.get(b.speaker) ?? 0) + 1)
  const speakers = Array.from(speakerCounts.entries())

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <Link
          to={`/projects/${projectId ?? transcript.projectId}`}
          className="text-muted hover:text-text"
        >
          ← Project
        </Link>
        {savedAt && <span className="text-[11px] text-muted">Saved {timeSince(savedAt)} ago</span>}
      </div>

      {/* Sticky media player */}
      <div className="sticky top-0 z-20 -mx-5 px-5 py-2 bg-ink/90 backdrop-blur-md border-b border-line/50">
        {mediaUrl ? (
          isVideo ? (
            <video
              ref={mediaRef as React.MutableRefObject<HTMLVideoElement | null>}
              src={mediaUrl}
              controls
              preload="metadata"
              className="w-full max-h-72 rounded-lg bg-black"
            />
          ) : (
            <audio
              ref={mediaRef as React.MutableRefObject<HTMLAudioElement | null>}
              src={mediaUrl}
              controls
              preload="metadata"
              className="w-full"
            />
          )
        ) : (
          <p className="text-[11px] text-muted py-2">Loading media…</p>
        )}
      </div>

      <header className="rounded-2xl border border-line bg-panel/60 p-5 space-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📝 Transcript</div>
          <h1 className="font-display text-2xl mt-1 break-all">{transcript.fileName}</h1>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SettingsField
            label="Start offset (ms)"
            hint="Add to all timecodes"
            value={String(transcript.startOffsetMs)}
            onChange={(v) => scheduleSave({ ...transcript, startOffsetMs: parseInt(v) || 0 })}
          />
          <SettingsField
            label="Frame rate"
            hint="For SCC timecodes"
            value={String(transcript.frameRate)}
            options={['23.976', '24', '25', '29.97', '30']}
            onChange={(v) => scheduleSave({ ...transcript, frameRate: parseFloat(v) || 29.97 })}
          />
          <SettingsField
            label="Drop frame"
            value={transcript.dropFrame ? 'Yes' : 'No'}
            options={['Yes', 'No']}
            onChange={(v) => scheduleSave({ ...transcript, dropFrame: v === 'Yes' })}
          />
          <div className="self-end grid grid-cols-3 gap-1">
            <a
              href={api.transcriptSrtUrl(transcript.id)}
              title="Subtitles for video editors / social tools"
              className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[10px] px-2 py-2 text-center"
            >
              ⬇ SRT
            </a>
            <a
              href={api.transcriptVttUrl(transcript.id)}
              title="WebVTT — DaVinci Resolve, YouTube web, HTML5"
              className="rounded-lg border border-stage-mastering/40 text-stage-mastering font-bold uppercase tracking-wider text-[10px] px-2 py-2 text-center hover:bg-stage-mastering/10"
            >
              ⬇ VTT
            </a>
            <a
              href={api.transcriptTxtUrl(transcript.id)}
              title="Plain text with speakers — show notes, blog, summarise"
              className="rounded-lg border border-stage-stems/40 text-stage-stems font-bold uppercase tracking-wider text-[10px] px-2 py-2 text-center hover:bg-stage-stems/10"
            >
              ⬇ TXT
            </a>
          </div>
        </div>
      </header>

      {/* Speakers panel */}
      {speakers.length > 0 && (
        <section className="rounded-2xl border border-line bg-panel/60 p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎤 Speakers</div>
          <p className="text-[11px] text-muted/80">
            Rename a speaker here to update them across the entire transcript. Click 🔊 to play
            their first block.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {speakers.map(([name, count]) => (
              <SpeakerRow
                key={name}
                name={name}
                count={count}
                onRename={(next) => renameSpeakerEverywhere(name, next)}
                onPreview={() => {
                  const first = blocks.find((b) => b.speaker === name)
                  if (first) seekTo(first.start)
                }}
              />
            ))}
          </div>
        </section>
      )}

      <div className="space-y-2">
        {blocks.map((b, i) => (
          <BlockEditor
            key={b.id}
            block={b}
            offsetMs={transcript.startOffsetMs}
            isActive={b.id === activeBlockId}
            onTextChange={(text) => updateBlock(i, { text })}
            onSpeakerChange={(speaker) => updateBlock(i, { speaker })}
            onSpeakerRenameAll={(newLabel) => renameSpeakerEverywhere(b.speaker, newLabel)}
            onPlay={() => seekTo(b.start)}
          />
        ))}
      </div>
    </div>
  )
}

function SpeakerRow({
  name,
  count,
  onRename,
  onPreview,
}: {
  name: string
  count: number
  onRename: (next: string) => void
  onPreview: () => void
}) {
  const [draft, setDraft] = useState(name)
  useEffect(() => { setDraft(name) }, [name])
  const dirty = draft !== name
  return (
    <div className="rounded-xl border border-line bg-ink/30 p-2.5 flex items-center gap-2">
      <button
        onClick={onPreview}
        className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-2 py-0.5 hover:bg-stage-mastering/10"
        title="Play first block from this speaker"
      >
        🔊
      </button>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRename(draft)
          if (e.key === 'Escape') setDraft(name)
        }}
        onBlur={() => dirty && onRename(draft)}
        className="flex-1 bg-transparent text-sm font-bold outline-none border-b border-transparent focus:border-stage-mastering/60"
      />
      <span className="text-[10px] text-muted shrink-0">{count} {count === 1 ? 'block' : 'blocks'}</span>
    </div>
  )
}

function BlockEditor({
  block,
  offsetMs,
  isActive,
  onTextChange,
  onSpeakerChange,
  onSpeakerRenameAll,
  onPlay,
}: {
  block: ApiTranscriptBlock
  offsetMs: number
  isActive: boolean
  onTextChange: (text: string) => void
  onSpeakerChange: (speaker: string) => void
  onSpeakerRenameAll: (speaker: string) => void
  onPlay: () => void
}) {
  const [editingSpeaker, setEditingSpeaker] = useState(false)
  const [speakerDraft, setSpeakerDraft] = useState(block.speaker)

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        isActive
          ? 'border-stage-mastering bg-stage-mastering/10 shadow-[0_0_0_2px_rgba(255,180,255,0.25)_inset]'
          : 'border-line/60 bg-ink/20 hover:border-line'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onPlay}
            className="text-[11px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-2 py-0.5 hover:bg-stage-mastering/10 shrink-0"
            title="Play from this block"
          >
            ▶
          </button>
          {editingSpeaker ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={speakerDraft}
                onChange={(e) => setSpeakerDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.shiftKey) onSpeakerRenameAll(speakerDraft)
                    else onSpeakerChange(speakerDraft)
                    setEditingSpeaker(false)
                  } else if (e.key === 'Escape') {
                    setSpeakerDraft(block.speaker)
                    setEditingSpeaker(false)
                  }
                }}
                className="text-[11px] uppercase tracking-wider font-bold text-stage-mastering bg-ink/40 border border-stage-mastering/40 rounded px-1.5 py-0.5 outline-none"
              />
              <button onClick={() => { onSpeakerChange(speakerDraft); setEditingSpeaker(false) }} className="text-[10px] text-muted hover:text-text">save</button>
              <button onClick={() => { onSpeakerRenameAll(speakerDraft); setEditingSpeaker(false) }} className="text-[10px] text-stage-mastering hover:text-text">all</button>
            </div>
          ) : (
            <button
              onClick={() => { setSpeakerDraft(block.speaker); setEditingSpeaker(true) }}
              className="text-[11px] uppercase tracking-wider font-bold text-stage-mastering hover:text-text truncate"
            >
              {block.speaker}
            </button>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted shrink-0">
          {fmtTime(block.start + offsetMs / 1000)}–{fmtTime(block.end + offsetMs / 1000)}
        </span>
      </div>
      <textarea
        value={block.text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={Math.max(2, Math.ceil(block.text.length / 80))}
        className="w-full bg-transparent text-sm leading-relaxed outline-none border border-transparent focus:border-stage-mastering/40 rounded p-1 resize-y"
      />
    </div>
  )
}

function SettingsField({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  options?: string[]
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">{label}</div>
      {options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-ink/40 border border-line text-text text-xs rounded-lg px-2 py-1.5 outline-none focus:border-stage-mastering"
        >
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-ink/40 border border-line text-text text-xs rounded-lg px-2 py-1.5 outline-none focus:border-stage-mastering"
        />
      )}
      {hint && <div className="text-[10px] text-muted/60 mt-0.5">{hint}</div>}
    </label>
  )
}

function fmtTime(sec: number): string {
  if (sec < 0) sec = 0
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

function timeSince(d: Date): string {
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}
