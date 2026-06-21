import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiProject } from '../api'
import StageDistribution from '../components/StageDistribution'
import DropboxFolderPicker from '../components/DropboxFolderPicker'
import type { Song } from '../types'

const KIND_GRADIENT: Record<string, string> = {
  album: 'from-stage-mastering/30 via-stage-producing/20 to-stage-mixing/30',
  podcast: 'from-stage-tracking/30 via-stage-overdubs/20 to-stage-mastering/30',
  film: 'from-stage-stems/30 via-stage-producing/20 to-stage-done/30',
}

type KindTab = 'podcast' | 'album' | 'film'

const TABS: Array<{ value: KindTab; label: string; emoji: string }> = [
  { value: 'podcast', label: 'Podcasts', emoji: '🎙️' },
  { value: 'album', label: 'Music', emoji: '🎵' },
  { value: 'film', label: 'Films', emoji: '🎬' },
]

const TAB_STORAGE_KEY = 'slate.dashboard.kindTab'
// Session-scoped flag: once you pick a workspace this session, we
// don't pop the picker again on refresh. Clearing it (via the
// header's "Switch workspace" link) sends you back to the picker.
const PICKED_SESSION_KEY = 'slate.dashboard.workspacePicked'

export default function Dashboard() {
  const [projects, setProjects] = useState<ApiProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // Persist the last-viewed tab so the user lands back where they were.
  const [tab, setTab] = useState<KindTab>(() => {
    if (typeof window === 'undefined') return 'podcast'
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY)
    return stored === 'album' || stored === 'film' || stored === 'podcast' ? stored : 'podcast'
  })
  const [pickerDismissed, setPickerDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(PICKED_SESSION_KEY) === '1'
  })

  useEffect(() => {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab)
  }, [tab])

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

  const counts: Record<KindTab, number> = { podcast: 0, album: 0, film: 0 }
  if (projects) {
    for (const p of projects) {
      if (p.kind === 'podcast' || p.kind === 'album' || p.kind === 'film') counts[p.kind]++
    }
  }
  // Available kinds = kinds where the user can see at least one project.
  // Super admins see everything; regular users only see what they're a
  // member of. We hide the picker entirely when they have access to
  // just one kind — no choice to make.
  const availableKinds = TABS.filter((t) => counts[t.value] > 0).map((t) => t.value)
  const showPicker = projects !== null && availableKinds.length > 1 && !pickerDismissed

  function chooseKind(k: KindTab) {
    setTab(k)
    setPickerDismissed(true)
    if (typeof window !== 'undefined') window.sessionStorage.setItem(PICKED_SESSION_KEY, '1')
  }

  // If they only have access to one kind, snap the tab to it and
  // never bother them with the picker.
  useEffect(() => {
    if (projects && availableKinds.length === 1 && tab !== availableKinds[0]) {
      setTab(availableKinds[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, availableKinds.length])

  const visibleProjects = projects?.filter((p) => p.kind === tab) ?? []
  const activeMeta = TABS.find((t) => t.value === tab)!

  // Flip to the light film theme only when the user is actually past
  // the workspace picker AND looking at the FILMS tab. The picker
  // itself should stay dark since it doesn't show film content yet.
  useEffect(() => {
    if (!showPicker && tab === 'film') {
      document.body.setAttribute('data-theme', 'film')
      return () => { document.body.removeAttribute('data-theme') }
    }
  }, [tab, showPicker])

  if (showPicker) {
    return (
      <WorkspacePicker
        available={availableKinds}
        counts={counts}
        onPick={chooseKind}
      />
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-6xl mb-2 text-rainbow">Projects</h1>
        <p className="text-muted text-sm max-w-xl">
          Albums, podcasts, and films in production at Straw Hut Media. Color tells you
          where each track stands.
        </p>
      </section>

      {/* Kind tabs — one focused workspace per medium so podcasts don't
          get tangled with music or films. */}
      <div className="flex flex-wrap gap-2 border-b border-line/60 pb-3">
        {TABS.map((t) => {
          const active = tab === t.value
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs uppercase tracking-wider font-bold transition ${
                active
                  ? 'bg-gradient-to-r from-stage-mastering to-stage-tracking text-white shadow-[0_0_20px_-6px_rgba(244,114,182,0.55)]'
                  : 'border border-line text-muted hover:text-text'
              }`}
            >
              <span>{t.emoji}</span>
              <span>{t.label}</span>
              <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${active ? 'bg-white/20' : 'bg-ink/40'}`}>
                {counts[t.value]}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">
          {error}
        </div>
      )}

      {!projects && !error && <p className="text-muted text-sm">Loading…</p>}

      {projects && visibleProjects.length === 0 && (
        <p className="text-muted text-sm italic py-8 text-center border border-dashed border-line/60 rounded-2xl">
          No {activeMeta.label.toLowerCase()} yet. Use “+ New project” below to add one.
        </p>
      )}

      {projects && (
        <section className="grid gap-5">
          {visibleProjects.map((p) => (
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
                <StageDistribution songs={p.songs as unknown as Song[]} labels={p.stageLabels} kind={p.kind} />
              </div>
            </Link>
          ))}

          <button
            onClick={() => setShowCreate(true)}
            className="rounded-3xl border-2 border-dashed border-line/70 bg-panel/20 p-6 text-left text-muted hover:text-text hover:border-stage-mastering/50 transition"
          >
            <div className="text-[10px] uppercase tracking-[0.3em] mb-1 font-bold">+ New {activeMeta.label.toLowerCase().replace(/s$/, '')}</div>
            <div className="text-sm">Starts on the {activeMeta.label} tab.</div>
          </button>
        </section>
      )}
      {showCreate && <CreateProjectModal defaultKind={tab} onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  )
}

function CreateProjectModal({
  defaultKind,
  onClose,
  onCreated,
}: {
  defaultKind?: 'album' | 'podcast' | 'film'
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [kind, setKind] = useState<'album' | 'podcast' | 'film'>(defaultKind ?? 'album')
  const [dropboxFolder, setDropboxFolder] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

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
    { value: 'podcast', label: 'Podcast', emoji: '🎙️' },
    { value: 'film', label: 'Film', emoji: '🎬' },
  ]

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl max-h-[88dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">New project</h2>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
              Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Code x Connor"
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
              placeholder="podcast for codestrap"
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
            <div className="flex gap-2">
              <button
                onClick={() => setShowPicker(true)}
                type="button"
                className="flex-1 text-left rounded-xl bg-ink/40 border border-line hover:border-stage-stems text-text px-3 py-2.5 text-sm font-mono break-all"
              >
                {dropboxFolder || (
                  <span className="text-muted/70">📁 Tap to browse Dropbox…</span>
                )}
              </button>
              {dropboxFolder && (
                <button
                  type="button"
                  onClick={() => setDropboxFolder('')}
                  className="text-muted hover:text-urgent text-sm px-2"
                  title="Clear"
                >
                  ✕
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted/70 mt-1">
              Each channel/episode/song you add will get its own subfolder under this path.
            </p>
          </div>
          {showPicker && (
            <DropboxFolderPicker
              initialPath={dropboxFolder}
              onCancel={() => setShowPicker(false)}
              onSelect={(p) => {
                setDropboxFolder(p)
                setShowPicker(false)
              }}
            />
          )}
          {error && <p className="text-urgent text-sm">{error}</p>}
          {kind === 'podcast' && (
            <p className="text-[11px] text-muted bg-stage-stems/10 border border-stage-stems/30 rounded-lg p-2.5">
              ℹ️ Podcasts use the codestrap workflow by default: 📅 Scheduled → 🎤 Prepped → 🎬
              Recorded → ✂️ Editing → 👀 Client Review → 🔧 Revisions → ✨ Finalized → 🚀 Released.
              Per-show label customization coming in a future push.
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

// First-thing-after-login picker. Three big buttons, only rendered for
// users who actually have access to multiple kinds. Pick one and you
// land in that workspace; the choice sticks until you switch.
function WorkspacePicker({
  available,
  counts,
  onPick,
}: {
  available: KindTab[]
  counts: Record<KindTab, number>
  onPick: (k: KindTab) => void
}) {
  const cardGradients: Record<KindTab, string> = {
    podcast: 'from-stage-tracking via-stage-overdubs to-stage-mastering',
    album: 'from-stage-mastering via-stage-producing to-stage-mixing',
    film: 'from-stage-stems via-stage-producing to-stage-done',
  }
  const tagline: Record<KindTab, string> = {
    podcast: 'Episodes · transcripts · daily socials · the scheduler.',
    album: 'Songs · sessions · mixers · the album pipeline.',
    film: 'Scenes · stripboard · budgets · phase tracking.',
  }
  return (
    <div className="space-y-10">
      <section>
        <h1 className="font-display text-6xl mb-2 text-rainbow">Where to?</h1>
        <p className="text-muted text-sm max-w-xl">
          Slate runs three studios. Pick one — you'll land in the workspace for it
          and stay there until you switch.
        </p>
      </section>

      <div className={`grid gap-5 ${available.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {available.map((k) => {
          const meta = TABS.find((t) => t.value === k)!
          return (
            <button
              key={k}
              onClick={() => onPick(k)}
              className="group relative aspect-[4/5] overflow-hidden rounded-3xl border border-line/70 bg-panel/40 transition hover:-translate-y-1 hover:shadow-[0_30px_80px_-30px_rgba(167,139,250,0.6)]"
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${cardGradients[k]} opacity-30 group-hover:opacity-50 transition`} />
              <div className="absolute inset-0 bg-ink/40" />
              <div className="relative h-full flex flex-col justify-between p-7 text-left">
                <div className="text-5xl">{meta.emoji}</div>
                <div className="space-y-2">
                  <div className="font-display text-4xl text-rainbow">{meta.label}</div>
                  <div className="text-[11px] text-muted">{tagline[k]}</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted/70 font-bold pt-2">
                    {counts[k]} {counts[k] === 1 ? 'project' : 'projects'}
                  </div>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted opacity-0 group-hover:opacity-100 transition">
                  Enter →
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
