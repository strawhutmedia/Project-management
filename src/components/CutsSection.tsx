// Episode cuts panel. Centerpiece of the podcast episode page —
// producer uploads cuts, the team and client trade notes (optionally
// timestamped to a moment in the cut), client approves.
//
// Renders a column of cards (newest at top). Each card:
//   - status badge (in review / needs changes / approved / superseded)
//   - label, who uploaded, when
//   - link to the file (Dropbox path or external URL)
//   - notes thread underneath: "at 12:34 audio drops" with resolve toggle
//   - inline "+ note" with optional timestamp input
import { useEffect, useRef, useState } from 'react'
import { api, type ApiCutNote, type ApiDropboxEntry, type ApiEpisodeCut } from '../api'
import { useAuth } from '../auth'

const STATUS_LABEL: Record<ApiEpisodeCut['status'], string> = {
  in_review: 'In review',
  needs_changes: 'Needs changes',
  approved: 'Approved',
  superseded: 'Superseded',
}

const STATUS_STYLE: Record<ApiEpisodeCut['status'], string> = {
  in_review: 'bg-stage-mastering/15 border-stage-mastering/40 text-stage-mastering',
  needs_changes: 'bg-urgent/15 border-urgent/40 text-urgent',
  approved: 'bg-stage-done/20 border-stage-done/40 text-stage-done',
  superseded: 'bg-ink/40 border-line text-muted',
}

function fmtTimestamp(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return ''
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseTimestamp(input: string): number | null {
  const t = input.trim()
  if (!t) return null
  const parts = t.split(':').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 1) return Math.round(parts[0] * 1000)
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000)
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000)
  return null
}

export default function CutsSection({
  songId,
  songFolder,
  canWrite,
}: {
  songId: string
  songFolder: string | null
  canWrite: boolean
}) {
  const [cuts, setCuts] = useState<ApiEpisodeCut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [selectedFile, setSelectedFile] = useState<ApiDropboxEntry | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await api.episodeCuts(songId)
      setCuts(r.cuts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [songId])

  async function createCut() {
    if (!selectedFile) return
    const label = newLabel.trim() || selectedFile.name
    setBusy(true); setError(null)
    try {
      await api.createEpisodeCut(songId, {
        label,
        description: newDescription.trim() || undefined,
        dropboxPath: selectedFile.path,
      })
      setNewLabel(''); setNewDescription(''); setSelectedFile(null); setAdding(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎧 Cuts</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Drop in rough cuts, picture locks, and final mixes. The team and
            client leave notes — including timestamped feedback like "at 12:34
            audio drops." Approve to lock the version.
          </p>
        </div>
        {canWrite && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full text-[10px] uppercase tracking-wider font-bold text-white bg-gradient-to-r from-stage-mastering to-stage-tracking px-3 py-1.5"
          >
            + Add cut
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">{error}</div>
      )}

      {adding && (
        <div className="rounded-xl border border-line/60 bg-ink/30 p-3 space-y-3">
          {!songFolder ? (
            <p className="text-sm text-muted py-2">
              This episode needs a Dropbox folder set first. Add one on the
              episode page, then share cuts from inside it.
            </p>
          ) : (
            <CutPicker
              rootPath={songFolder}
              selected={selectedFile}
              onSelect={(e) => {
                setSelectedFile(e)
                if (!newLabel.trim() && e) setNewLabel(e.name)
              }}
            />
          )}
          <input
            type="text"
            placeholder='Label (defaults to file name — e.g. "Rough cut v1", "Picture lock")'
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full rounded-lg bg-ink/40 border border-line text-text text-sm px-3 py-2 outline-none focus:border-stage-mastering"
          />
          <textarea
            placeholder="Note to the team / client (optional) — what changed, what to listen for, what you need feedback on"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-ink/40 border border-line text-text text-sm px-3 py-2 outline-none focus:border-stage-mastering resize-y"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => { setAdding(false); setNewLabel(''); setNewDescription(''); setSelectedFile(null) }}
              className="text-[10px] uppercase tracking-wider text-muted hover:text-text px-2 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={() => void createCut()}
              disabled={busy || !selectedFile}
              className="rounded-full text-[10px] uppercase tracking-wider font-bold text-white bg-stage-mastering px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Share cut'}
            </button>
          </div>
        </div>
      )}

      {cuts === null ? (
        <p className="text-muted text-xs italic">Loading…</p>
      ) : cuts.length === 0 ? (
        <p className="text-muted/70 text-sm italic text-center py-6 border border-dashed border-line/60 rounded-xl">
          No cuts yet. Click "+ Add cut" when you have a rough to share.
        </p>
      ) : (
        <div className="space-y-3">
          {cuts.map((c) => <CutCard key={c.id} cut={c} canWrite={canWrite} onChanged={load} />)}
        </div>
      )}
    </section>
  )
}

function CutCard({
  cut,
  canWrite,
  onChanged,
}: {
  cut: ApiEpisodeCut
  canWrite: boolean
  onChanged: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(cut.unresolvedCount > 0 || cut.status === 'in_review')
  const [notes, setNotes] = useState<ApiCutNote[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadNotes() {
    setLoading(true)
    try {
      const r = await api.cutNotes(cut.id)
      setNotes(r.notes)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (expanded && notes === null) void loadNotes()
  }, [expanded])

  async function setStatus(s: ApiEpisodeCut['status']) {
    await api.updateEpisodeCut(cut.id, { status: s })
    await onChanged()
  }

  async function removeCut() {
    if (!confirm(`Delete "${cut.label}"? Notes on this cut will also be deleted.`)) return
    await api.deleteEpisodeCut(cut.id)
    await onChanged()
  }

  const srcLink = cut.url || (cut.dropboxPath ? `/api/integrations/dropbox/file?path=${encodeURIComponent(cut.dropboxPath)}` : null)

  return (
    <div className="rounded-xl border border-line bg-ink/20 overflow-hidden">
      <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border ${STATUS_STYLE[cut.status]}`}>
              {STATUS_LABEL[cut.status]}
            </span>
            <span className="font-bold text-text truncate">{cut.label}</span>
            {cut.unresolvedCount > 0 && (
              <span className="text-[10px] font-mono text-urgent">
                {cut.unresolvedCount} open note{cut.unresolvedCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-1">
            {cut.uploadedByName ? `${cut.uploadedByName} · ` : ''}
            {new Date(cut.uploadedAt).toLocaleString()}
            {cut.dropboxPath && (
              <> · <span className="font-mono text-muted/70 truncate" title={cut.dropboxPath}>{cut.dropboxPath.split('/').pop()}</span></>
            )}
          </div>
          {cut.description && (
            <p className="text-sm text-text mt-2 leading-snug whitespace-pre-wrap">{cut.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {srcLink && (
            <a
              href={srcLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase tracking-wider font-bold text-stage-stems hover:underline px-2 py-1"
            >
              Open
            </a>
          )}
          {canWrite && (
            <>
              <select
                value={cut.status}
                onChange={(e) => void setStatus(e.target.value as ApiEpisodeCut['status'])}
                className="text-[10px] bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
              >
                <option value="in_review">In review</option>
                <option value="needs_changes">Needs changes</option>
                <option value="approved">Approved</option>
                <option value="superseded">Superseded</option>
              </select>
              <button
                onClick={() => void removeCut()}
                className="text-muted/40 hover:text-urgent px-2"
                title="Delete cut"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left text-[10px] uppercase tracking-wider text-muted hover:text-text border-t border-line/40 px-4 py-2 bg-ink/30"
      >
        {expanded ? '▾' : '▸'} {cut.noteCount} note{cut.noteCount === 1 ? '' : 's'} on this cut
      </button>

      {expanded && (
        <div className="border-t border-line/40 px-4 py-3 space-y-2 bg-ink/10">
          {loading ? (
            <p className="text-muted text-xs italic">Loading…</p>
          ) : (
            <>
              {(notes ?? []).map((n) => (
                <NoteRow key={n.id} note={n} canWrite={canWrite} onChanged={loadNotes} />
              ))}
              {canWrite && <AddNoteForm cutId={cut.id} onAdded={() => { void loadNotes(); void onChanged() }} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function NoteRow({
  note,
  canWrite,
  onChanged,
}: {
  note: ApiCutNote
  canWrite: boolean
  onChanged: () => Promise<void>
}) {
  const { user } = useAuth()
  const isMine = note.authorUserId === user?.id

  async function toggleResolved() {
    await api.updateCutNote(note.id, { resolved: !note.resolved })
    await onChanged()
  }

  async function remove() {
    if (!confirm('Delete this note?')) return
    await api.deleteCutNote(note.id)
    await onChanged()
  }

  return (
    <div className={`rounded-lg border px-3 py-2 ${
      note.resolved ? 'border-line/40 bg-ink/20 opacity-60' : 'border-line/60 bg-ink/40'
    }`}>
      <div className="flex items-start gap-2">
        {note.timestampMs != null && (
          <span className="text-[10px] font-mono font-bold text-stage-mastering shrink-0 mt-0.5">
            {fmtTimestamp(note.timestampMs)}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text leading-snug whitespace-pre-wrap">
            {note.content}
          </div>
          <div className="text-[10px] text-muted/80 mt-1">
            {note.authorName || 'Someone'} · {new Date(note.createdAt).toLocaleString()}
            {note.resolved && note.resolvedAt && (
              <> · ✓ resolved {new Date(note.resolvedAt).toLocaleDateString()}</>
            )}
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => void toggleResolved()}
              className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${
                note.resolved
                  ? 'text-muted border-line hover:text-text'
                  : 'text-stage-done border-stage-done/40 hover:bg-stage-done/10'
              }`}
            >
              {note.resolved ? 'Reopen' : '✓ Resolve'}
            </button>
            {isMine && (
              <button
                onClick={() => void remove()}
                className="text-muted/40 hover:text-urgent px-1"
                title="Delete"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AddNoteForm({
  cutId,
  onAdded,
}: {
  cutId: string
  onAdded: () => void
}) {
  const [content, setContent] = useState('')
  const [timestamp, setTimestamp] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  async function submit() {
    if (!content.trim()) return
    setBusy(true)
    try {
      await api.createCutNote(cutId, {
        content: content.trim(),
        timestampMs: timestamp.trim() ? parseTimestamp(timestamp) : null,
      })
      setContent(''); setTimestamp('')
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line/60 bg-ink/30 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={timestamp}
          onChange={(e) => setTimestamp(e.target.value)}
          placeholder="12:34 (opt.)"
          className="w-24 text-xs text-center font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
        />
        <span className="text-[10px] text-muted">timestamp (optional)</span>
      </div>
      <textarea
        ref={inputRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
        }}
        placeholder="Add a note — feedback, fixes, approvals. ⌘↵ to post."
        rows={2}
        className="w-full text-sm bg-ink/40 border border-line rounded px-2 py-1.5 outline-none focus:border-stage-mastering resize-y"
      />
      <div className="flex justify-end">
        <button
          onClick={() => void submit()}
          disabled={busy || !content.trim()}
          className="rounded-full text-[10px] uppercase tracking-wider font-bold text-white bg-stage-mastering px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post note'}
        </button>
      </div>
    </div>
  )
}

// Compact inline Dropbox file picker for sharing a cut. Starts at the
// episode's folder, lets you drill into subfolders, tap to select a
// file. Only files are selectable; folders just navigate.
function CutPicker({
  rootPath,
  selected,
  onSelect,
}: {
  rootPath: string
  selected: ApiDropboxEntry | null
  onSelect: (e: ApiDropboxEntry | null) => void
}) {
  const [currentPath, setCurrentPath] = useState(rootPath)
  const [entries, setEntries] = useState<ApiDropboxEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEntries(null)
    setError(null)
    api.dropboxList(currentPath)
      .then(({ entries }) => setEntries(entries))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'failed'
        setError(msg.startsWith('not_found') ? "Folder doesn't exist." : msg)
        setEntries([])
      })
  }, [currentPath])

  const atRoot = currentPath === rootPath

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span className="font-mono truncate" title={currentPath}>{currentPath}</span>
        {!atRoot && (
          <button
            onClick={() => {
              const parent = currentPath.replace(/\/[^/]+\/?$/, '')
              setCurrentPath(parent || rootPath)
              onSelect(null)
            }}
            className="text-stage-stems hover:underline whitespace-nowrap ml-2"
          >
            ← Up
          </button>
        )}
      </div>
      {error ? (
        <p className="text-[11px] text-muted py-2 text-center border border-dashed border-line/60 rounded-lg">{error}</p>
      ) : !entries ? (
        <p className="text-[11px] text-muted italic">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-[11px] text-muted/70 py-2 text-center italic">Folder is empty.</p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.path}>
              {e.type === 'folder' ? (
                <button
                  onClick={() => { setCurrentPath(e.path); onSelect(null) }}
                  className="w-full text-left text-xs flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-2.5 py-1.5 hover:bg-ink/60"
                >
                  <span>📁</span>
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-muted">→</span>
                </button>
              ) : (
                <button
                  onClick={() => onSelect(e)}
                  className={`w-full text-left text-xs flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
                    selected?.path === e.path
                      ? 'border-stage-mastering bg-stage-mastering/10'
                      : 'border-line bg-ink/30 hover:bg-ink/60'
                  }`}
                >
                  <span>{fileEmoji(e.name)}</span>
                  <span className="flex-1 truncate">{e.name}</span>
                  {selected?.path === e.path && (
                    <span className="text-stage-mastering text-[10px]">✓</span>
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fileEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['wav', 'mp3', 'aiff', 'flac', 'm4a', 'ogg'].includes(ext)) return '🎵'
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return '🎬'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (['pdf'].includes(ext)) return '📄'
  return '📄'
}
