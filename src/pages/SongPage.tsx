import { Link, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { api, type ApiDropboxEntry, type ApiSongDetail } from '../api'
import { STAGES, STAGE_COLOR, STAGE_LABEL, STAGE_ICON, type Stage } from '../types'
import StagePill from '../components/StagePill'
import InlineEdit from '../components/InlineEdit'
import AddLinkModal from '../components/AddLinkModal'
import { useAuth } from '../auth'

export default function SongPage() {
  const { projectId, songId } = useParams()
  const { user } = useAuth()
  const [song, setSong] = useState<ApiSongDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingStage, setSavingStage] = useState(false)

  async function reload() {
    if (!songId) return
    try {
      const { song } = await api.song(songId)
      setSong(song)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }

  useEffect(() => {
    void reload()
  }, [songId])

  if (error) return <div className="text-muted">{error}</div>
  if (!song) return <p className="text-muted text-sm">Loading…</p>

  const c = STAGE_COLOR[song.stage]
  const stageIndex = STAGES.indexOf(song.stage)

  async function setStage(stage: Stage) {
    if (!song || stage === song.stage) return
    setSavingStage(true)
    try {
      await api.updateSong(song.id, { stage })
      await reload()
    } finally {
      setSavingStage(false)
    }
  }

  async function saveTitle(next: string) {
    await api.updateSong(song!.id, { title: next })
    await reload()
  }

  async function saveSubtitle(next: string) {
    await api.updateSong(song!.id, { subtitle: next })
    await reload()
  }

  async function saveDropboxFolder(next: string) {
    await api.updateSong(song!.id, { dropboxFolder: next })
    await reload()
  }

  return (
    <div className="space-y-10">
      <div>
        <Link
          to={`/projects/${projectId}`}
          className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold"
        >
          ← {song.projectName}
        </Link>
        <div className="mt-3 flex items-end justify-between flex-wrap gap-4">
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] uppercase tracking-[0.3em] mb-2 font-bold ${c.text}`}>
              {STAGE_ICON[song.stage]} {STAGE_LABEL[song.stage]}
            </div>
            <h1 className="font-display text-5xl leading-none">
              <InlineEdit
                value={song.title}
                onSave={saveTitle}
                inputClassName="font-display text-5xl text-rainbow"
                className="text-rainbow"
              />
            </h1>
            <div className={`mt-2 text-sm ${c.text} uppercase tracking-wider font-semibold`}>
              <InlineEdit
                value={song.subtitle ?? ''}
                onSave={saveSubtitle}
                emptyLabel="+ Add subtitle"
              />
            </div>
          </div>
          <StagePill stage={song.stage} size="lg" glow />
        </div>
      </div>

      {/* Pipeline */}
      <div className={`relative rounded-3xl border ${c.border}/30 overflow-hidden`}>
        <div className={`absolute inset-0 ${c.bgStrong} opacity-60`} />
        <div className="absolute inset-0 bg-ink/40" />
        <div className="relative p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">Pipeline</div>
            <div className="text-[11px] text-muted">
              {savingStage ? 'Saving…' : 'Tap a stage to move'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {STAGES.map((s, i) => {
              const sc = STAGE_COLOR[s]
              const passed = i <= stageIndex
              const current = i === stageIndex
              return (
                <div key={s} className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => void setStage(s)}
                    disabled={savingStage || current}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold transition ${
                      passed
                        ? `${sc.bgStrong} ${sc.text} border ${sc.border}/50 ${current ? sc.glow : 'hover:opacity-80'}`
                        : 'text-muted/60 border border-line hover:text-text'
                    }`}
                  >
                    <span className="text-[0.95em] leading-none">{STAGE_ICON[s]}</span>
                    {STAGE_LABEL[s]}
                  </button>
                  {i < STAGES.length - 1 && (
                    <div className={`w-3 h-px ${passed && i < stageIndex ? sc.dot : 'bg-line'}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <TasksPanel song={song} onChange={reload} />
          <CommentsPanel song={song} onChange={reload} userId={user?.id ?? ''} userRole={user?.role ?? 'user'} />
        </div>
        <aside className="space-y-5">
          <LinksPanel song={song} onChange={reload} />
          <DropboxPanel song={song} onChange={reload} onSaveFolder={saveDropboxFolder} />
        </aside>
      </div>
    </div>
  )
}

function TasksPanel({ song, onChange }: { song: ApiSongDetail; onChange: () => void | Promise<void> }) {
  const [newTask, setNewTask] = useState('')
  const [adding, setAdding] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!newTask.trim()) return
    setAdding(true)
    try {
      await api.addTask(song.id, { title: newTask.trim(), stage: song.stage })
      setNewTask('')
      await onChange()
    } finally {
      setAdding(false)
    }
  }

  async function toggle(taskId: string, done: boolean) {
    await api.updateTask(taskId, { done })
    await onChange()
  }

  async function remove(taskId: string) {
    if (!confirm('Delete this task?')) return
    await api.deleteTask(taskId)
    await onChange()
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📝 What's left</h2>
        <span className="text-[11px] text-muted">
          {song.tasks.filter((t) => !t.done).length} open · {song.tasks.length} total
        </span>
      </div>

      <form onSubmit={add} className="flex gap-2 mb-4">
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded-xl bg-ink/40 border border-line text-text px-3 py-2 outline-none focus:border-stage-mastering text-sm"
        />
        <button
          type="submit"
          disabled={adding || !newTask.trim()}
          className="rounded-xl bg-stage-producing/20 border border-stage-producing/40 text-stage-producing font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
        >
          {adding ? '…' : '+ Add'}
        </button>
      </form>

      {song.tasks.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center border border-dashed border-line rounded-xl">
          No tasks yet. Add one above.
        </div>
      ) : (
        <ul className="space-y-2">
          {song.tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-lg border border-line p-3 bg-ink/40 group"
            >
              <input
                type="checkbox"
                checked={t.done}
                onChange={(e) => void toggle(t.id, e.target.checked)}
                className="accent-stage-done w-4 h-4 cursor-pointer"
              />
              <span className={`flex-1 ${t.done ? 'line-through text-muted' : ''}`}>{t.title}</span>
              <button
                onClick={() => void remove(t.id)}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-urgent transition"
                title="Delete task"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CommentsPanel({
  song,
  onChange,
  userId,
  userRole,
}: {
  song: ApiSongDetail
  onChange: () => void | Promise<void>
  userId: string
  userRole: string
}) {
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  async function post(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    try {
      await api.addComment(song.id, body.trim())
      setBody('')
      await onChange()
    } finally {
      setPosting(false)
    }
  }

  async function remove(commentId: string) {
    if (!confirm('Delete this comment?')) return
    await api.deleteComment(commentId)
    await onChange()
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4 font-bold">💬 Comments</h2>

      <form onSubmit={post} className="space-y-2 mb-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          rows={3}
          className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2 outline-none focus:border-stage-mastering text-sm resize-none"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={posting || !body.trim()}
            className="rounded-xl bg-gradient-to-r from-stage-stems/30 to-stage-mixing/30 border border-stage-mixing/40 text-stage-mixing font-bold uppercase tracking-wider text-xs px-3 py-1.5 disabled:opacity-50"
          >
            {posting ? '…' : 'Post'}
          </button>
        </div>
      </form>

      {song.comments.length === 0 ? (
        <p className="text-sm text-muted text-center py-4">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {song.comments.map((c) => {
            const canDelete = c.authorId === userId || userRole === 'admin'
            return (
              <li key={c.id} className="rounded-lg border border-line bg-ink/40 p-3 group">
                <div className="flex items-baseline justify-between mb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-stage-stems">{c.authorName}</span>
                    <span className="text-[11px] text-muted">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => void remove(c.id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-urgent transition"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{c.body}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function LinksPanel({
  song,
  onChange,
}: {
  song: ApiSongDetail
  onChange: () => void | Promise<void>
}) {
  const [showAdd, setShowAdd] = useState(false)

  async function remove(linkId: string) {
    if (!confirm('Remove this link?')) return
    await api.deleteLink(linkId)
    await onChange()
  }

  async function rename(linkId: string, label: string) {
    await api.updateLink(linkId, { label })
    await onChange()
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🔗 Links</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="text-[11px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-2.5 py-1 hover:bg-stage-stems/10"
        >
          + Add link
        </button>
      </div>
      {song.links.length === 0 ? (
        <p className="text-sm text-muted py-3 text-center">
          No links yet. Add a Dropbox file or any URL.
        </p>
      ) : (
        <ul className="space-y-2">
          {song.links.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-line bg-ink/40 p-2.5 group"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <InlineEdit
                    value={l.label}
                    onSave={(next) => rename(l.id, next)}
                    inputClassName="text-sm font-bold"
                    className="text-sm font-bold"
                  />
                </div>
                <button
                  onClick={() => void remove(l.id)}
                  className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-urgent transition shrink-0"
                  title="Remove link"
                >
                  ✕
                </button>
              </div>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] text-stage-stems hover:underline truncate"
              >
                {l.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {showAdd && (
        <AddLinkModal
          songId={song.id}
          songFolder={song.dropboxFolder}
          onClose={() => setShowAdd(false)}
          onAdded={() => void onChange()}
        />
      )}
    </section>
  )
}

function DropboxPanel({
  song,
  onChange,
  onSaveFolder,
}: {
  song: ApiSongDetail
  onChange: () => void | Promise<void>
  onSaveFolder: (next: string) => Promise<void>
}) {
  const [entries, setEntries] = useState<ApiDropboxEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState(song.dropboxFolder ?? '')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCurrentPath(song.dropboxFolder ?? '')
  }, [song.dropboxFolder])

  async function load(path: string) {
    setError(null)
    setEntries(null)
    if (!path) {
      setError('No Dropbox folder set.')
      return
    }
    try {
      const { entries } = await api.dropboxList(path)
      setEntries(entries)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      if (msg.startsWith('not_found')) {
        setError('Folder not yet created in Dropbox.')
      } else if (msg === 'not_connected') {
        setError("Dropbox isn't connected. Admin can connect from Settings.")
      } else {
        setError(msg)
      }
      setEntries([])
    }
  }

  useEffect(() => {
    void load(currentPath)
  }, [currentPath])

  async function createFolderAt(path: string) {
    setCreating(true)
    try {
      await api.dropboxCreateFolder(path)
      await load(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setCreating(false)
    }
  }

  async function createSongFolder() {
    if (!song.dropboxFolder) return
    await createFolderAt(song.dropboxFolder)
  }

  async function createSubfolder() {
    const name = newFolderName.trim()
    if (!name) return
    const path = `${currentPath.replace(/\/$/, '')}/${name}`
    await createFolderAt(path)
    setNewFolderName('')
    setShowNewFolder(false)
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      await api.dropboxUpload(currentPath, file)
      await load(currentPath)
      await onChange()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function navigateUp() {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '')
    setCurrentPath(parent || song.dropboxFolder || '')
  }

  const atRoot = currentPath === (song.dropboxFolder ?? '')

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📦 Dropbox</h2>
        {!atRoot && (
          <button onClick={navigateUp} className="text-[11px] text-stage-stems hover:underline">
            ← Up
          </button>
        )}
      </div>

      <div className="text-[11px] text-muted mb-3 break-all font-mono">
        <InlineEdit
          value={song.dropboxFolder ?? ''}
          onSave={onSaveFolder}
          emptyLabel="+ Set folder path"
          inputClassName="text-[11px] font-mono"
        />
      </div>
      {!atRoot && (
        <div className="text-[11px] text-muted mb-3 break-all font-mono opacity-70">
          📂 {currentPath}
        </div>
      )}

      {error === 'Folder not yet created in Dropbox.' && song.dropboxFolder ? (
        <div className="text-sm text-muted space-y-3 py-4 text-center border border-dashed border-line rounded-xl">
          <p>This folder doesn't exist in Dropbox yet.</p>
          <button
            onClick={() => void createSongFolder()}
            disabled={creating}
            className="text-xs uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-3 py-1.5 hover:bg-stage-stems/10"
          >
            {creating ? 'Creating…' : '+ Create folder in Dropbox'}
          </button>
        </div>
      ) : error ? (
        <div className="text-sm text-muted py-4 text-center border border-dashed border-line rounded-xl">
          {error}
        </div>
      ) : !entries ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <ul className="space-y-1.5 mb-3">
            {entries.length === 0 && (
              <li className="text-sm text-muted text-center py-3">Folder is empty.</li>
            )}
            {entries.map((e) => (
              <li key={e.path}>
                {e.type === 'folder' ? (
                  <button
                    onClick={() => setCurrentPath(e.path)}
                    className="w-full text-left text-sm flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-3 py-2 hover:bg-ink/60"
                  >
                    <span>📁</span>
                    <span className="flex-1 truncate">{e.name}</span>
                    <span className="text-muted text-xs">→</span>
                  </button>
                ) : (
                  <a
                    href={`https://www.dropbox.com/home${encodeURI(e.path)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-3 py-2 hover:bg-ink/60"
                  >
                    <span>{fileEmoji(e.name)}</span>
                    <span className="flex-1 truncate">{e.name}</span>
                    {e.size != null && (
                      <span className="text-[11px] text-muted">{formatBytes(e.size)}</span>
                    )}
                  </a>
                )}
              </li>
            ))}
          </ul>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              onChange={onUpload}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 text-[11px] uppercase tracking-wider font-bold text-stage-mixing border border-stage-mixing/40 rounded-full px-2.5 py-1.5 hover:bg-stage-mixing/10 disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : '⬆️ Upload file'}
              </button>
              <button
                onClick={() => setShowNewFolder((v) => !v)}
                className="flex-1 text-[11px] uppercase tracking-wider font-bold text-stage-tracking border border-stage-tracking/40 rounded-full px-2.5 py-1.5 hover:bg-stage-tracking/10"
              >
                + New folder
              </button>
            </div>
            {showNewFolder && (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createSubfolder()
                    if (e.key === 'Escape') setShowNewFolder(false)
                  }}
                  placeholder="Folder name"
                  className="flex-1 rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 outline-none text-sm"
                  autoFocus
                />
                <button
                  onClick={() => void createSubfolder()}
                  disabled={!newFolderName.trim() || creating}
                  className="rounded-lg bg-stage-tracking/20 border border-stage-tracking/40 text-stage-tracking font-bold text-xs px-3 disabled:opacity-50"
                >
                  {creating ? '…' : 'OK'}
                </button>
              </div>
            )}
            {uploadError && <p className="text-urgent text-xs">{uploadError}</p>}
          </div>
        </>
      )}
    </section>
  )
}

function fileEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['wav', 'mp3', 'aiff', 'flac', 'm4a', 'ogg'].includes(ext)) return '🎵'
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return '🎬'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (['pdf'].includes(ext)) return '📄'
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝'
  if (['zip', 'rar', '7z'].includes(ext)) return '📦'
  return '📄'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
