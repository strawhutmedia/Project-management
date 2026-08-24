import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiMember, type ApiProject } from '../api'
import { STAGE_COLOR, STAGES, stageLabel, stageIcon, type Song, type Stage, type StageLabels } from '../types'
import StagePill from '../components/StagePill'
import StageDistribution from '../components/StageDistribution'
import InlineEdit from '../components/InlineEdit'
import DropboxFolderPicker from '../components/DropboxFolderPicker'
import DropboxFilePicker from '../components/DropboxFilePicker'
import BudgetSection from '../components/BudgetSection'
import ProjectMembersSection from '../components/ProjectMembersSection'
import PodcastSocialsConfig from '../components/PodcastSocialsConfig'
import PodcastRssConfig from '../components/PodcastRssConfig'
import BrandProfileCard from '../components/BrandProfileCard'
import BrandAssetsCard from '../components/BrandAssetsCard'
import SocialStrategySection from '../components/SocialStrategySection'
import AudienceSection from '../components/AudienceSection'
import ShowBriefCard from '../components/ShowBriefCard'
import ShowChatCard from '../components/ShowChatCard'
import ScriptOverviewCard from '../components/ScriptOverviewCard'
import PresenceBar from '../components/PresenceBar'
import Stripboard from '../components/Stripboard'
import LocationsSection from '../components/LocationsSection'
import FilmPhaseBar, { type FilmPhase } from '../components/FilmPhaseBar'
import { useAuth } from '../auth'

export default function ProjectPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [project, setProject] = useState<ApiProject | null>(null)
  const [members, setMembers] = useState<ApiMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showRootPicker, setShowRootPicker] = useState(false)
  const [showUploadEpisode, setShowUploadEpisode] = useState(false)
  const [showQuickTranscript, setShowQuickTranscript] = useState(false)

  async function reload() {
    if (!projectId) return
    try {
      const { project } = await api.project(projectId)
      setProject(project)
      try {
        const { members } = await api.projectMembers(projectId)
        setMembers(members)
      } catch {
        // members non-critical
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }

  useEffect(() => {
    void reload()
  }, [projectId])

  // Apply the film theme to <body> so the whole viewport flips to the
  // light paper palette. Cleared on unmount so other project pages
  // don't inherit. MUST run before the early returns to keep React's
  // hook order stable across renders.
  useEffect(() => {
    if (project?.kind === 'film') {
      document.body.setAttribute('data-theme', 'film')
      return () => { document.body.removeAttribute('data-theme') }
    }
  }, [project?.kind])

  // Live-refresh while any episode is still processing, so the page
  // updates itself (Processing → Ready) without a manual reload.
  useEffect(() => {
    const list = (project?.songs ?? []) as unknown as Array<{ processingState?: string | null }>
    const anyProcessing = list.some((s) => s.processingState === 'processing')
    if (!anyProcessing) return
    const id = setInterval(() => { void reload() }, 15_000)
    return () => clearInterval(id)
  }, [project])

  if (error) {
    return (
      <div className="text-muted">
        {error}.{' '}
        <Link to="/" className="underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  if (!project) return <p className="text-muted text-sm">Loading…</p>

  const songs = project.songs as unknown as Song[]

  async function saveName(next: string) {
    await api.updateProject(project!.id, { name: next })
    setProject({ ...project!, name: next })
  }

  async function saveSubtitle(next: string) {
    await api.updateProject(project!.id, { subtitle: next })
    setProject({ ...project!, subtitle: next })
  }

  async function saveRootFolder(next: string) {
    await api.updateProject(project!.id, { dropboxFolder: next })
    setProject({ ...project!, dropboxFolder: next })
  }

  async function saveChannelsSubfolder(next: string) {
    await api.updateProject(project!.id, { channelsSubfolder: next || null })
    setProject({ ...project!, channelsSubfolder: next || null })
  }

  const channelLabel =
    project.kind === 'podcast' ? 'episode' : project.kind === 'film' ? 'scene' : 'song'

  async function addChannel() {
    if (!project) return
    const title = prompt(`New ${channelLabel} title:`)
    if (!title || !title.trim()) return
    try {
      await api.addSong(project.id, { title: title.trim() })
      await reload()
    } catch (err) {
      alert(`Failed to add ${channelLabel}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  return (
    <div className="space-y-10" data-theme={project.kind === 'film' ? 'film' : undefined}>
      <PresenceBar projectId={project.id} />
      <div>
        <Link to="/" className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold">
          ← Projects
        </Link>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="w-full sm:flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-5">
            {project.kind === 'podcast' && project.coverArtUrl && (
              <img
                src={project.coverArtUrl}
                alt={`${project.name} cover art`}
                crossOrigin="anonymous"
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover border border-line shrink-0 shadow-lg"
              />
            )}
            <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted mb-2 font-bold">
              {project.kind}
            </div>
            <h1 className="font-display text-3xl sm:text-5xl leading-tight sm:leading-none break-words">
              {isAdmin ? (
                <InlineEdit
                  value={project.name}
                  onSave={saveName}
                  inputClassName="font-display text-3xl sm:text-5xl"
                  className="text-rainbow"
                />
              ) : (
                <span className="text-rainbow">{project.name}</span>
              )}
            </h1>
            <div className="text-muted mt-2 text-sm">
              {isAdmin ? (
                <InlineEdit
                  value={project.subtitle ?? ''}
                  onSave={saveSubtitle}
                  emptyLabel="+ Add subtitle"
                />
              ) : (
                project.subtitle && <span>{project.subtitle}</span>
              )}
            </div>
            {isAdmin && (
              <div className="text-[11px] text-muted mt-1 font-mono flex items-center flex-wrap gap-2">
                📦 Dropbox root:{' '}
                <span className="break-all">{project.dropboxFolder || <em className="text-muted/60 not-italic">— not set —</em>}</span>
                <button
                  onClick={() => setShowRootPicker(true)}
                  className="text-[10px] uppercase tracking-wider text-stage-stems border border-stage-stems/40 rounded-full px-2 py-0.5 hover:bg-stage-stems/10"
                >
                  📁 Pick
                </button>
                {project.dropboxFolder && (
                  <button
                    onClick={() => void saveRootFolder('')}
                    className="text-[10px] text-muted hover:text-urgent"
                    title="Clear"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            {isAdmin && project.kind !== 'film' && (
              <div className="text-[11px] text-muted mt-1 font-mono">
                📁 {channelLabel}s subfolder:{' '}
                <InlineEdit
                  value={project.channelsSubfolder ?? ''}
                  onSave={saveChannelsSubfolder}
                  emptyLabel="+ Set subfolder (e.g. episodes)"
                  inputClassName="text-[11px] font-mono"
                />
                <span className="ml-1 opacity-60">
                  (where new {channelLabel}s land inside the root)
                </span>
              </div>
            )}
            </div>
          </div>
          {project.kind === 'podcast' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowQuickTranscript(true)}
                className="rounded-xl border border-line text-muted hover:text-text hover:border-line/80 font-bold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap"
                title="Just a transcript — no social plan, no clips. Audio or video, fast and cheap."
              >
                🎙 Quick transcript
              </button>
              <button
                onClick={() => setShowUploadEpisode(true)}
                className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap"
                title="Upload a near-final video — Slate transcribes, writes the social plan, and cuts clips automatically"
              >
                📤 Upload episode
              </button>
            </div>
          ) : project.kind !== 'film' && (
            <button
              onClick={() => void addChannel()}
              className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap"
            >
              + New {channelLabel}
            </button>
          )}
        </div>
      </div>

      {project.kind !== 'film' && (
        <div className="relative rounded-3xl border border-line/70 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-stage-mastering/20 via-stage-producing/15 to-stage-mixing/20 opacity-80" />
          <div className="absolute inset-0 bg-ink/50" />
          <div className="relative p-6">
            <StageDistribution songs={songs} labels={project.stageLabels} kind={project.kind} />
          </div>
        </div>
      )}

      {project.kind === 'film' && (
        <FilmPhaseBar
          projectId={project.id}
          currentPhase={(project.filmPhase ?? 'pre') as FilmPhase}
          isAdmin={isAdmin}
          onChanged={reload}
        />
      )}

      {/* Show chat — super-admin only. Workspace admins (Ryan) get
          the Claude assistant; project members at any level don't see
          it. Gated server-side too. NON-FILM only — for film projects
          this gets folded into the Settings panel below. */}
      {user?.role === 'admin' && project.kind !== 'film' && <ShowChatCard projectId={project.id} />}

      {isAdmin && project.kind === 'album' && <ProjectRolesSection project={project} members={members} onSaved={reload} />}
      {isAdmin && project.kind === 'podcast' && <PodcastTeamSection project={project} members={members} onSaved={reload} />}
      {isAdmin && project.kind === 'podcast' && <PodcastRssConfig project={project} onSaved={reload} />}
      {isAdmin && project.kind === 'podcast' && <BrandAssetsCard project={project} onSaved={reload} />}
      {isAdmin && project.kind === 'podcast' && <BrandProfileCard project={project} members={members} onSaved={reload} />}
      {isAdmin && project.kind === 'podcast' && <AudienceSection projectId={project.id} canWrite={isAdmin} />}
      {isAdmin && project.kind === 'podcast' && <ShowBriefCard projectId={project.id} canWrite={isAdmin} />}
      {isAdmin && project.kind === 'podcast' && <SocialStrategySection projectId={project.id} canWrite={isAdmin} />}
      {isAdmin && project.kind === 'podcast' && <PodcastSocialsConfig project={project} members={members} onSaved={reload} />}

      {/* Members section — NON-FILM. Film projects fold this into the
          Settings panel below. */}
      {isAdmin && user?.id && project.kind !== 'film' && (
        <ProjectMembersSection projectId={project.id} members={members} currentUserId={user.id} onChanged={reload} />
      )}

      {/* FILM PROJECT LAYOUT:
            1. 🎬 Stripboard (embedded — the main work area)
            2. 💰 Budget summary
            3. ⚙️ Settings (collapsible: Script, Team, Members, Show Chat)
          The schedule + budget is what the team is in here to DO; everything
          else is configuration. */}
      {project.kind === 'film' && (
        <FilmExportsBar projectId={project.id} projectName={project.name} />
      )}

      {project.kind === 'film' && (
        <Stripboard projectId={project.id} isAdmin={isAdmin} projectName={project.name} />
      )}

      {project.kind === 'film' && <LocationsSection projectId={project.id} isAdmin={isAdmin} />}

      {project.kind === 'film' && <BudgetSection projectId={project.id} isAdmin={isAdmin} />}

      {project.kind === 'film' && (
        <FilmSettingsPanel
          project={project}
          members={members}
          isAdmin={isAdmin}
          isSuperAdmin={user?.role === 'admin'}
          currentUserId={user?.id ?? ''}
          onReload={reload}
        />
      )}

      {project.kind === 'podcast' && (
        <Link
          to={`/projects/${project.id}/transcripts`}
          className="block rounded-2xl border border-line bg-panel/60 p-5 hover:border-stage-mastering/60 hover:bg-panel transition group"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📝 Transcripts</div>
              <div className="text-sm font-bold mt-1 text-text">All transcriptions across episodes →</div>
              <div className="text-[11px] text-muted/80 mt-0.5">
                Per-episode transcripts live on each episode page · this is the project-wide library
              </div>
            </div>
            <span className="text-2xl text-muted group-hover:text-stage-mastering transition shrink-0">›</span>
          </div>
        </Link>
      )}

      {showRootPicker && (
        <DropboxFolderPicker
          initialPath={project.dropboxFolder ?? ''}
          onCancel={() => setShowRootPicker(false)}
          onSelect={(p) => {
            void saveRootFolder(p)
            setShowRootPicker(false)
          }}
        />
      )}

      {showUploadEpisode && (
        <UploadEpisodeDialog
          projectId={project.id}
          projectRoot={project.dropboxFolder ?? null}
          onClose={() => setShowUploadEpisode(false)}
          onCreated={async () => {
            setShowUploadEpisode(false)
            await reload()
          }}
        />
      )}

      {showQuickTranscript && (
        <QuickTranscriptDialog
          projectId={project.id}
          projectRoot={project.dropboxFolder ?? null}
          onClose={() => setShowQuickTranscript(false)}
        />
      )}

      <div className="space-y-8">
        {project.kind !== 'film' && STAGES.map((stage) => {
          const stageSongs = songs.filter((s) => s.stage === stage)
          // For podcasts: sort by release date (upcoming first; undated last)
          // so the project page reads as "what's next out the door."
          if (project.kind === 'podcast') {
            stageSongs.sort((a, b) => {
              const ad = (a as unknown as { releaseDate?: string | null }).releaseDate
              const bd = (b as unknown as { releaseDate?: string | null }).releaseDate
              if (ad && bd) return ad.localeCompare(bd)
              if (ad) return -1
              if (bd) return 1
              return 0
            })
          }
          if (stageSongs.length === 0) return null
          const c = STAGE_COLOR[stage]
          return (
            <section key={stage}>
              <div className="flex items-center gap-2.5 mb-4">
                <span className={`text-lg leading-none`}>{stageIcon(stage, project.stageLabels)}</span>
                <h2 className={`text-sm uppercase tracking-[0.25em] ${c.text} font-bold`}>
                  {stageLabel(stage, project.stageLabels)}
                </h2>
                <span className={`text-[11px] ${c.text} ${c.bgStrong} border ${c.border}/40 rounded-full px-2 py-0.5 font-bold`}>
                  {stageSongs.length}
                </span>
                <div
                  className="flex-1 h-px"
                  style={{ background: `linear-gradient(to right, ${c.hex}66, transparent)` }}
                />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {stageSongs.map((song) => (
                  <Link
                    key={song.id}
                    to={`/projects/${project.id}/songs/${song.id}`}
                    className={`group relative block rounded-2xl border ${c.border}/30 ${c.bg} p-5 transition hover:-translate-y-1 hover:${c.bgStrong} hover:${c.glow}`}
                  >
                    <div
                      className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${c.dot}`}
                    />
                    <div className="pl-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-2xl truncate group-hover:text-text leading-tight">
                          {song.title}
                        </div>
                        {song.subtitle && (
                          <div className={`text-[11px] uppercase tracking-wider mt-0.5 ${c.text} font-semibold`}>
                            {song.subtitle}
                          </div>
                        )}
                        {project.kind === 'podcast' && (song as unknown as { releaseDate?: string | null }).releaseDate && (
                          <div className="text-[11px] text-muted mt-1 font-mono">
                            📅 {(song as unknown as { releaseDate: string }).releaseDate}
                            <span className="text-muted/60"> · {projectReleaseLabel((song as unknown as { releaseDate: string }).releaseDate)}</span>
                          </div>
                        )}
                        {project.kind === 'podcast' && (song as unknown as { processingState?: string | null }).processingState && (
                          <div className="mt-2">
                            <ProcessingPill state={(song as unknown as { processingState: 'processing' | 'ready' | 'posted' }).processingState} />
                          </div>
                        )}
                      </div>
                      {/* Stage pill hidden on podcasts — the processing
                          state above replaces the 8-stage pipeline. */}
                      {project.kind !== 'podcast' && (
                        <StagePill stage={song.stage} size="xs" labels={project.stageLabels} />
                      )}
                    </div>
                    <div className="pl-3 mt-4 text-[11px] text-muted flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <span className="opacity-70">📝</span>
                        {song.tasks.filter((t) => !t.done).length} open
                      </span>
                      <span className="opacity-40">·</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="opacity-70">💬</span>
                        {song.comments.length}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

// Film team — five canonical film roles. Stored in project.defaultOwners
// under non-music keys so they don't collide with the music-stage workflow.
const FILM_ROLES: Array<{ key: string; label: string; icon: string }> = [
  { key: 'writer',        label: 'Writer',             icon: '✍️' },
  { key: 'producer',      label: 'Producer',           icon: '🎬' },
  { key: 'director',      label: 'Director',           icon: '🎥' },
  { key: 'asst_director', label: 'Assistant Director', icon: '📋' },
  { key: 'editor',        label: 'Editor',             icon: '✂️' },
]

// Podcast team — four canonical podcast roles. Same default_owners JSON
// store as film/album, with non-overlapping keys.
const PODCAST_ROLES: Array<{ key: string; label: string; icon: string }> = [
  { key: 'project_manager',    label: 'Project Manager',    icon: '🗂️' },
  { key: 'producer',           label: 'Producer',           icon: '🎙️' },
  { key: 'editor',             label: 'Editor',             icon: '✂️' },
  { key: 'executive_producer', label: 'Executive Producer', icon: '⭐' },
]

function FilmTeamSection({
  project,
  members,
  onSaved,
}: {
  project: ApiProject
  members: ApiMember[]
  onSaved: () => void | Promise<void>
}) {
  async function setRole(key: string, userId: string) {
    const next: Record<string, string> = {}
    for (const [k, owner] of Object.entries(project.defaultOwners ?? {})) {
      if (owner) next[k] = owner.id
    }
    if (userId) next[key] = userId
    else delete next[key]
    await api.updateProject(project.id, { defaultOwners: next })
    await onSaved()
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">
            🎬 Film Team
          </h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Core creative team for this film. Producer and Director are
            often multi-person on indie features (Ryan + Stephen + Alex =
            producers on this one); pick the primary contact here and add
            the rest as project members.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FILM_ROLES.map(({ key, label, icon }) => {
          const owner = project.defaultOwners?.[key]
          return (
            <div key={key}>
              <label className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">
                {icon} {label}
              </label>
              <select
                value={owner?.id ?? ''}
                onChange={(e) => void setRole(key, e.target.value)}
                className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || m.name}
                    {m.role === 'admin' ? ' (admin)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PodcastTeamSection({
  project,
  members,
  onSaved,
}: {
  project: ApiProject
  members: ApiMember[]
  onSaved: () => void | Promise<void>
}) {
  async function setRole(key: string, userId: string) {
    const next: Record<string, string> = {}
    for (const [k, owner] of Object.entries(project.defaultOwners ?? {})) {
      if (owner) next[k] = owner.id
    }
    if (userId) next[key] = userId
    else delete next[key]
    await api.updateProject(project.id, { defaultOwners: next })
    await onSaved()
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">
            🎙️ Podcast Team
          </h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Core team for this podcast. Add anyone else as a project member;
            this is just the primary contact per role.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PODCAST_ROLES.map(({ key, label, icon }) => {
          const owner = project.defaultOwners?.[key]
          return (
            <div key={key}>
              <label className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">
                {icon} {label}
              </label>
              <select
                value={owner?.id ?? ''}
                onChange={(e) => void setRole(key, e.target.value)}
                className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || m.name}
                    {m.role === 'admin' ? ' (admin)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ProjectRolesSection({
  project,
  members,
  onSaved,
}: {
  project: ApiProject
  members: ApiMember[]
  onSaved: () => void | Promise<void>
}) {
  const labels: StageLabels | undefined = project.stageLabels
  const STAGE_ROLES: Array<{ stage: Stage; label: string }> = [
    'writing',
    'tracking',
    'overdubs',
    'producing',
    'stems',
    'mixing',
    'mastering',
  ].map((s) => ({
    stage: s as Stage,
    label: `${stageIcon(s as Stage, labels)} ${stageLabel(s as Stage, labels)}`,
  }))

  async function setDefault(stage: Stage, userId: string) {
    const next: Record<string, string> = {}
    for (const [s, owner] of Object.entries(project.defaultOwners ?? {})) {
      if (owner) next[s] = owner.id
    }
    if (userId) next[stage] = userId
    else delete next[stage]
    await api.updateProject(project.id, { defaultOwners: next })
    await onSaved()
  }

  const hasAny = Object.values(project.defaultOwners ?? {}).some((v) => v != null)

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">
            👥 Default Roles
          </h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Set once here. Songs without an explicit owner for a stage inherit these defaults
            automatically — set Ryan = Tracking, Dillon = Overdubs, etc., and every song picks them up.
          </p>
        </div>
        {hasAny && (
          <span className="text-[10px] uppercase tracking-wider text-stage-stems bg-stage-stems/10 border border-stage-stems/40 rounded-full px-2 py-0.5 font-bold whitespace-nowrap">
            Active
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {STAGE_ROLES.map(({ stage, label }) => {
          const owner = project.defaultOwners?.[stage]
          return (
            <div key={stage}>
              <label className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">
                {label}
              </label>
              <select
                value={owner?.id ?? ""}
                onChange={(e) => void setDefault(stage, e.target.value)}
                className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
              >
                <option value="">— No default —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || m.name}
                    {m.role === "admin" ? " (admin)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Podcast upload-and-go dialog. Step 1: pick the near-final video.
// Step 2: optional release date. Submit fires the auto-pipeline server-
// side; user lands back on the project page and the new episode card
// shows the "Processing…" state immediately.
function UploadEpisodeDialog({
  projectId,
  projectRoot,
  onClose,
  onCreated,
}: {
  projectId: string
  projectRoot: string | null
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const [picking, setPicking] = useState(true)
  const [picked, setPicked] = useState<{ path: string; name: string; size?: number } | null>(null)
  const [releaseDate, setReleaseDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onFilePicked(path: string, name: string, size?: number) {
    setPicking(false)
    if (!/\.(mp4|mov|m4v)$/i.test(name)) {
      setError('Slate only accepts video — pick an .mp4, .mov, or .m4v.')
      return
    }
    setPicked({ path, name, size })
    setError(null)
  }

  async function submit() {
    if (!picked) return
    setSubmitting(true); setError(null)
    try {
      await api.uploadPodcastEpisode(projectId, {
        dropboxPath: picked.path,
        title: picked.name.replace(/\.(mp4|mov|m4v)$/i, '').replace(/[_\-]+/g, ' ').trim(),
        releaseDate: releaseDate || null,
      })
      await onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (picking) {
    // Hard refusal when the show doesn't have a Dropbox root set —
    // without it the picker would otherwise show the entire workspace.
    if (!projectRoot || !projectRoot.trim()) {
      return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4" onClick={onClose}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-urgent/40 bg-panel/95 p-5 space-y-3">
            <h3 className="text-sm font-display text-urgent uppercase tracking-widest">Set a Dropbox root first</h3>
            <p className="text-sm text-muted">
              This show doesn't have a Dropbox root configured yet. Pick one on the show page (📦 Dropbox root → Pick) so episode uploads stay inside that folder.
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">Close</button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <DropboxFilePicker
        title="Upload a near-final episode video"
        acceptExtensions={['.mp4', '.mov', '.m4v']}
        initialPath={projectRoot}
        restrictAbove={projectRoot}
        scopeProjectId={projectId}
        onSelect={onFilePicked}
        onCancel={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-line bg-panel/95 p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-display text-rainbow uppercase tracking-widest">📤 Upload episode</h3>
            <p className="text-[11px] text-muted mt-1 truncate" title={picked?.name}>{picked?.name}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">×</button>
        </div>

        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Release date (optional)</div>
          <input
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering"
          />
          <p className="text-[10px] text-muted/60 mt-1">
            When this episode goes public. Drives the scheduler's "this week's episode" rule.
          </p>
        </label>

        <div className="rounded-lg border border-line/40 bg-ink/30 p-3 text-[11px] text-muted space-y-1">
          <div><span className="text-stage-stems font-bold">What happens next (all automatic):</span></div>
          <div>1. Slate transcribes the video (~5–15 min for an hour episode)</div>
          <div>2. It picks the strongest moments for this show from the transcript</div>
          <div>3. It cuts 7–15 vertical clips with captions — right here in Slate</div>
          <div className="pt-1 text-muted/70">
            The episode shows a pulsing “Transcribing + cutting clips…” tag and flips to “Ready” on its own — the page refreshes itself, no need to reload. Clips land in the episode’s Clips panel.
          </div>
        </div>

        {error && <p className="text-urgent text-sm">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button onClick={() => setPicking(true)} disabled={submitting} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">
            ← Pick different file
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !picked}
            className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Start upload-and-go'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Lightweight "I just need a transcript" flow. Accepts audio OR video,
// runs Deepgram only — no episode row, no social plan, no clip job.
// Lands in the show's Transcripts library unattached.
function QuickTranscriptDialog({
  projectId,
  projectRoot,
  onClose,
}: {
  projectId: string
  projectRoot: string | null
  onClose: () => void
}) {
  const [picking, setPicking] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<{ transcriptId: string; name: string } | null>(null)

  async function onFilePicked(path: string, name: string) {
    setPicking(false)
    setSubmitting(true)
    setError(null)
    try {
      const { transcript } = await api.startTranscript({
        projectId,
        dropboxPath: path,
        songId: null,
      })
      setStarted({ transcriptId: transcript.id, name })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to start transcript')
      setPicking(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (picking) {
    if (!projectRoot || !projectRoot.trim()) {
      return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4" onClick={onClose}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-urgent/40 bg-panel/95 p-5 space-y-3">
            <h3 className="text-sm font-display text-urgent uppercase tracking-widest">Set a Dropbox root first</h3>
            <p className="text-sm text-muted">
              This show doesn't have a Dropbox root configured yet. Pick one on the show page so transcripts stay inside that folder.
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">Close</button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <DropboxFilePicker
        title="Pick a file to transcribe (audio or video)"
        acceptExtensions={['.mp3', '.m4a', '.wav', '.mp4', '.mov', '.m4v']}
        initialPath={projectRoot}
        restrictAbove={projectRoot}
        scopeProjectId={projectId}
        onSelect={onFilePicked}
        onCancel={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-line bg-panel/95 p-5 space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-display text-rainbow uppercase tracking-widest">🎙 Quick transcript</h3>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">×</button>
        </div>

        {submitting && <p className="text-muted text-sm">Starting transcription…</p>}

        {error && <p className="text-urgent text-sm">{error}</p>}

        {started && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="text-stage-stems font-bold">✓ Transcription started</span> for{' '}
              <span className="truncate inline-block max-w-[280px] align-bottom" title={started.name}>{started.name}</span>.
            </p>
            <p className="text-[11px] text-muted">
              Deepgram usually takes 5–15 minutes for an hour of audio. No social plan, no clips
              — just the transcript.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">
                Done
              </button>
              <Link
                to={`/projects/${projectId}/transcripts/${started.transcriptId}`}
                onClick={onClose}
                className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2"
              >
                Open transcript →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProcessingPill({ state }: { state: 'processing' | 'ready' | 'posted' }) {
  const styles: Record<typeof state, { label: string; cls: string }> = {
    processing: { label: 'Transcribing + cutting clips…', cls: 'text-stage-mastering border-stage-mastering/40 bg-stage-mastering/10' },
    ready:      { label: '✓ Ready',   cls: 'text-stage-stems border-stage-stems/40 bg-stage-stems/10' },
    posted:     { label: '🚀 Posted', cls: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  }
  const s = styles[state]
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border ${s.cls}`}
      title={state === 'processing' ? 'Slate is transcribing, picking moments, and cutting clips. This can take ~5–15 min. The page refreshes itself.' : undefined}
    >
      {state === 'processing' && (
        <span className="w-1.5 h-1.5 rounded-full bg-stage-mastering animate-pulse" />
      )}
      {s.label}
    </span>
  )
}

function projectReleaseLabel(yyyyMmDd: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'today'
  if (diff > 0) return `in ${diff}d`
  return `${-diff}d ago`
}


// Settings panel for film projects — collapses all the configuration
// (script, team, members, Claude chat) out of the way so the
// stripboard + budget are the dominant content. Expanded by default
// the first time, then producer can collapse it once they're working.
function FilmSettingsPanel({
  project,
  members,
  isAdmin,
  isSuperAdmin,
  currentUserId,
  onReload,
}: {
  project: ApiProject
  members: ApiMember[]
  isAdmin: boolean
  isSuperAdmin: boolean
  currentUserId: string
  onReload: () => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className="rounded-2xl border border-line bg-panel/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-panel/60 transition rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">⚙️ Settings</span>
          <span className="text-[11px] text-muted/70">
            script · team · members{isSuperAdmin ? ' · Claude chat' : ''}
          </span>
        </div>
        <span className="text-muted text-xl">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-5 pb-5 space-y-6 border-t border-line/40 pt-4">
          <ScriptOverviewCard projectId={project.id} isAdmin={isAdmin} />
          {isSuperAdmin && <ShowChatCard projectId={project.id} />}
          {isAdmin && <FilmTeamSection project={project} members={members} onSaved={onReload} />}
          {isAdmin && currentUserId && (
            <ProjectMembersSection projectId={project.id} members={members} currentUserId={currentUserId} onChanged={onReload} />
          )}
        </div>
      )}
    </section>
  )
}

// Export bar — surfaces the five industry-standard PDFs as one-click
// downloads. Anchors above the stripboard so producers see it when
// they land on the page.
function FilmExportsBar({ projectId, projectName }: { projectId: string; projectName: string }) {
  const baseUrl = `/api/exports/projects/${projectId}`
  const docs = [
    { href: `${baseUrl}/budget-topsheet.pdf`,   label: '💰 Budget Top Sheet',   hint: '1-page summary' },
    { href: `${baseUrl}/budget-detailed.pdf`,   label: '📊 Detailed Budget',    hint: 'Every line item' },
    { href: `${baseUrl}/stripboard.pdf`,        label: '🎬 Production Board',   hint: 'Stripboard, color-coded' },
    { href: `${baseUrl}/dood.pdf`,              label: '📅 Day-Out-of-Days',    hint: 'Cast × days matrix' },
    { href: `${baseUrl}/cast-list.pdf`,         label: '🎭 Cast List + Rates',  hint: 'Day rates × work days' },
  ]
  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📄 Exports</h2>
          <p className="text-[11px] text-muted/80 mt-0.5">
            Print-ready PDFs for {projectName} · investors, line producers, crew handouts.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {docs.map((d) => (
          <a
            key={d.href}
            href={d.href}
            download
            className="rounded-lg border border-line bg-ink/30 hover:bg-ink/50 hover:border-stage-mastering/40 transition px-3 py-2 group"
          >
            <div className="text-xs font-bold text-text">{d.label}</div>
            <div className="text-[10px] text-muted mt-0.5">{d.hint}</div>
            <div className="text-[10px] text-stage-mastering mt-1 group-hover:underline">Download PDF →</div>
          </a>
        ))}
      </div>
    </section>
  )
}
