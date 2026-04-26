import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiDropboxEntry, type ApiSongDetail } from '../api'
import { STAGES, STAGE_COLOR, STAGE_LABEL, STAGE_ICON, type Stage } from '../types'
import StagePill from '../components/StagePill'
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
          <div>
            <div className={`text-[10px] uppercase tracking-[0.3em] mb-2 font-bold ${c.text}`}>
              {STAGE_ICON[song.stage]} {STAGE_LABEL[song.stage]}
            </div>
            <h1 className="font-display text-6xl leading-none">
              <span className="text-rainbow">{song.title}</span>
            </h1>
            {song.subtitle && (
              <p className={`mt-2 text-sm ${c.text} uppercase tracking-wider font-semibold`}>
                {song.subtitle}
              </p>
            )}
          </div>
          <StagePill stage={song.stage} size="lg" glow />
        </div>
      </div>

      {/* Pipeline (clickable to change stage) */}
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
                        : 'text-muted/60 border border-line hover:border-line hover:text-text'
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
          <DropboxPanel song={song} />
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

function DropboxPanel({ song }: { song: ApiSongDetail }) {
  const [entries, setEntries] = useState<ApiDropboxEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [currentPath, setCurrentPath] = useState(song.dropboxFolder ?? '')

  useEffect(() => {
    setCurrentPath(song.dropboxFolder ?? '')
  }, [song.dropboxFolder])

  async function load(path: string) {
    setError(null)
    setEntries(null)
    if (!path) {
      setError('No Dropbox folder set for this song.')
      return
    }
    try {
      const { entries } = await api.dropboxList(path)
      setEntries(entries)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      if (msg.startsWith('not_found')) {
        setError('Folder doesn\'t exist in Dropbox yet.')
      } else if (msg === 'not_connected') {
        setError('Dropbox isn\'t connected. Admin can connect from Settings.')
      } else {
        setError(msg)
      }
      setEntries([])
    }
  }

  useEffect(() => {
    void load(currentPath)
  }, [currentPath])

  async function createFolder() {
    if (!song.dropboxFolder) return
    setCreating(true)
    try {
      await api.dropboxCreateFolder(song.dropboxFolder)
      await load(song.dropboxFolder)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setCreating(false)
    }
  }

  function navigateInto(folderPath: string) {
    setCurrentPath(folderPath)
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
          <button
            onClick={navigateUp}
            className="text-[11px] text-stage-stems hover:underline"
          >
            ← Up
          </button>
        )}
      </div>

      <p className="text-[11px] text-muted mb-3 break-all font-mono">
        {currentPath || '(no folder set)'}
      </p>

      {error === 'Folder doesn\'t exist in Dropbox yet.' && song.dropboxFolder ? (
        <div className="text-sm text-muted space-y-3 py-4 text-center border border-dashed border-line rounded-xl">
          <p>This folder doesn't exist in Dropbox yet.</p>
          <button
            onClick={() => void createFolder()}
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
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted text-center py-4">Folder is empty.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.path}>
              {e.type === 'folder' ? (
                <button
                  onClick={() => navigateInto(e.path)}
                  className="w-full text-left text-sm flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-3 py-2 hover:bg-ink/60"
                >
                  <span>📁</span>
                  <span className="flex-1 truncate">{e.name}</span>
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
