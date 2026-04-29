import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiMember, type ApiProject } from '../api'
import { STAGE_COLOR, STAGES, stageLabel, stageIcon, type Song, type Stage, type StageLabels } from '../types'
import StagePill from '../components/StagePill'
import StageDistribution from '../components/StageDistribution'
import InlineEdit from '../components/InlineEdit'
import DropboxFolderPicker from '../components/DropboxFolderPicker'
import BudgetSection from '../components/BudgetSection'
import { useAuth } from '../auth'

export default function ProjectPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [project, setProject] = useState<ApiProject | null>(null)
  const [members, setMembers] = useState<ApiMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showRootPicker, setShowRootPicker] = useState(false)

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
    <div className="space-y-10">
      <div>
        <Link to="/" className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold">
          ← Projects
        </Link>
        <div className="mt-3 flex items-end justify-between flex-wrap gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted mb-2 font-bold">
              {project.kind}
            </div>
            <h1 className="font-display text-5xl leading-none">
              {isAdmin ? (
                <InlineEdit
                  value={project.name}
                  onSave={saveName}
                  inputClassName="font-display text-5xl"
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
            {isAdmin && (
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
          <button
            onClick={() => void addChannel()}
            className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap"
          >
            + New {channelLabel}
          </button>
        </div>
      </div>

      <div className="relative rounded-3xl border border-line/70 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-stage-mastering/20 via-stage-producing/15 to-stage-mixing/20 opacity-80" />
        <div className="absolute inset-0 bg-ink/50" />
        <div className="relative p-6">
          <StageDistribution songs={songs} labels={project.stageLabels} kind={project.kind} />
        </div>
      </div>

      {isAdmin && <ProjectRolesSection project={project} members={members} onSaved={reload} />}

      <BudgetSection projectId={project.id} isAdmin={isAdmin} />

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

      <div className="space-y-8">
        {STAGES.map((stage) => {
          const stageSongs = songs.filter((s) => s.stage === stage)
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
                      </div>
                      <StagePill stage={song.stage} size="xs" labels={project.stageLabels} />
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

