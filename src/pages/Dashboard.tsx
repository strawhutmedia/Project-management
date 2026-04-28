import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiProject } from '../api'
import StageDistribution from '../components/StageDistribution'
import type { Song } from '../types'

const KIND_GRADIENT: Record<string, string> = {
  album: 'from-stage-mastering/30 via-stage-producing/20 to-stage-mixing/30',
  podcast: 'from-stage-tracking/30 via-stage-overdubs/20 to-stage-mastering/30',
  film: 'from-stage-stems/30 via-stage-producing/20 to-stage-done/30',
}

export default function Dashboard() {
  const [projects, setProjects] = useState<ApiProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    try {
      const { projects } = await api.projects()
      setProjects(projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-10">
      <section>
        <h1 className="font-display text-6xl mb-2 text-rainbow">Projects</h1>
        <p className="text-muted text-sm max-w-xl">
          Albums, podcast seasons, and films in production at Straw Hut Media. Color tells you
          where each track stands.
        </p>
      </section>

      {error && (
        <div className="rounded-xl border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">
          {error}
        </div>
      )}

      {!projects && !error && <p className="text-muted text-sm">Loading…</p>}

      {projects && (
        <section className="grid gap-5">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="group relative block rounded-3xl border border-line/70 bg-panel/40 hover:bg-panel/60 transition overflow-hidden hover:-translate-y-0.5 hover:shadow-[0_20px_60px_-30px_rgba(167,139,250,0.55)]"
            >
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${
                  KIND_GRADIENT[p.kind] ?? KIND_GRADIENT.album
                } opacity-70`}
              />
              <div className="absolute inset-0 bg-ink/40 pointer-events-none" />
              <div className="relative p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-muted mb-2 font-bold">
                      {p.kind}
                    </div>
                    <h2 className="font-display text-4xl text-rainbow">{p.name}</h2>
                    {p.subtitle && <p className="text-sm text-muted mt-1.5">{p.subtitle}</p>}
                  </div>
                  <span className="text-xs text-muted opacity-0 group-hover:opacity-100 transition">
                    Open →
                  </span>
                </div>
                <StageDistribution songs={p.songs as unknown as Song[]} />
              </div>
            </Link>
          ))}

          <button
            onClick={() => setShowCreate(true)}
            className="rounded-3xl border-2 border-dashed border-line/70 bg-panel/20 p-6 text-left text-muted hover:text-text hover:border-stage-mastering/50 transition"
          >
            <div className="text-[10px] uppercase tracking-[0.3em] mb-1 font-bold">+ New project</div>
            <div className="text-sm">Album, podcast season, or film.</div>
          </button>
        </section>
      )}
      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  )
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [kind, setKind] = useState<'album' | 'podcast' | 'film'>('album')
  const [dropboxFolder, setDropboxFolder] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const { project } = await api.createProject({
        name: name.trim(),
        subtitle: subtitle.trim() || undefined,
        kind,
        dropboxFolder: dropboxFolder.trim() || undefined,
      })
      await onCreated()
      onClose()
      navigate(`/projects/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setSubmitting(false)
    }
  }

  const kinds: Array<{ value: 'album' | 'podcast' | 'film'; label: string; emoji: string }> = [
    { value: 'album', label: 'Album', emoji: '🎵' },
    { value: 'podcast', label: 'Podcast season', emoji: '🎙️' },
    { value: 'film', label: 'Film', emoji: '🎬' },
  ]

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">New project</h2>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
              Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work Club Season 5"
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
              Subtitle (optional)
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="12 episodes · launching Sept"
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
              Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {kinds.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={`rounded-xl border p-3 text-sm transition ${
                    kind === k.value
                      ? 'border-stage-mastering bg-stage-mastering/10 text-text'
                      : 'border-line bg-ink/30 text-muted hover:text-text hover:border-line'
                  }`}
                >
                  <div className="text-2xl mb-1">{k.emoji}</div>
                  <div className="text-[11px] uppercase tracking-wider font-bold">{k.label}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
              Dropbox root folder (optional)
            </label>
            <input
              type="text"
              value={dropboxFolder}
              onChange={(e) => setDropboxFolder(e.target.value)}
              placeholder="/2_CLIENTS/Work Club"
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm font-mono"
            />
            <p className="text-[11px] text-muted/70 mt-1">
              Each channel/episode/song you add will get its own subfolder under this path.
            </p>
          </div>
          {error && <p className="text-urgent text-sm">{error}</p>}
          {kind === 'podcast' && (
            <p className="text-[11px] text-muted bg-stage-tracking/10 border border-stage-tracking/30 rounded-lg p-2.5">
              ⚠️ Heads up: podcast pipelines currently use the music stage labels (Writing → Tracking
              → Comp → ...). Tell Ryan your actual Work Club workflow stages and he'll customize them.
            </p>
          )}
          {kind === 'film' && (
            <p className="text-[11px] text-muted bg-stage-tracking/10 border border-stage-tracking/30 rounded-lg p-2.5">
              ⚠️ Heads up: film pipelines currently use the music stage labels. Custom film stages
              coming in a later push.
            </p>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-line">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-line text-muted hover:text-text font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="flex-1 rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}
