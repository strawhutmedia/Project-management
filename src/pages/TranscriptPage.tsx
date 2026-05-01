// Phase-1 transcript editor: block-level inline editing, speaker rename
// per-block, settings (start offset, frame rate, drop-frame), SRT export.
//
// Phase 2 will add: synced audio/video playback, click-a-word-to-seek,
// drag word boundaries, speaker rename across all instances at once,
// SCC export.
import { useEffect, useState, useRef } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { api, type ApiTranscript, type ApiTranscriptBlock } from '../api'

export default function TranscriptPage() {
  const { transcriptId, projectId } = useParams()
  const [transcript, setTranscript] = useState<ApiTranscript | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!transcriptId) return
    api.transcript(transcriptId)
      .then(({ transcript }) => setTranscript(transcript))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [transcriptId])

  // Debounced save: any local edits flush 800ms after last change.
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

  function updateBlock(idx: number, patch: Partial<ApiTranscriptBlock>) {
    const next = [...blocks]
    next[idx] = { ...next[idx], ...patch }
    scheduleSave({ ...transcript!, editedBlocks: next })
  }

  function renameSpeakerEverywhere(oldLabel: string, newLabel: string) {
    if (oldLabel === newLabel) return
    const next = blocks.map((b) => (b.speaker === oldLabel ? { ...b, speaker: newLabel } : b))
    scheduleSave({ ...transcript!, editedBlocks: next })
  }

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
          <a
            href={api.transcriptSrtUrl(transcript.id)}
            className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 self-end text-center"
          >
            ⬇ Export SRT
          </a>
        </div>
      </header>

      <div className="space-y-2">
        {blocks.map((b, i) => (
          <BlockEditor
            key={b.id}
            block={b}
            offsetMs={transcript.startOffsetMs}
            onTextChange={(text) => updateBlock(i, { text })}
            onSpeakerChange={(speaker) => updateBlock(i, { speaker })}
            onSpeakerRenameAll={(newLabel) => renameSpeakerEverywhere(b.speaker, newLabel)}
          />
        ))}
      </div>
    </div>
  )
}

function BlockEditor({
  block,
  offsetMs,
  onTextChange,
  onSpeakerChange,
  onSpeakerRenameAll,
}: {
  block: ApiTranscriptBlock
  offsetMs: number
  onTextChange: (text: string) => void
  onSpeakerChange: (speaker: string) => void
  onSpeakerRenameAll: (speaker: string) => void
}) {
  const [editingSpeaker, setEditingSpeaker] = useState(false)
  const [speakerDraft, setSpeakerDraft] = useState(block.speaker)

  return (
    <div className="rounded-xl border border-line/60 bg-ink/20 p-3 hover:border-line transition">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        {editingSpeaker ? (
          <div className="flex items-center gap-1.5 flex-1">
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
            <button
              onClick={() => { onSpeakerChange(speakerDraft); setEditingSpeaker(false) }}
              className="text-[10px] text-muted hover:text-text"
              title="Just this block"
            >
              save
            </button>
            <button
              onClick={() => { onSpeakerRenameAll(speakerDraft); setEditingSpeaker(false) }}
              className="text-[10px] text-stage-mastering hover:text-text"
              title="Rename across all blocks"
            >
              all
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setSpeakerDraft(block.speaker); setEditingSpeaker(true) }}
            className="text-[11px] uppercase tracking-wider font-bold text-stage-mastering hover:text-text"
          >
            {block.speaker}
          </button>
        )}
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
