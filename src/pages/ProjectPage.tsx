import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiProject } from '../api'
import { STAGE_COLOR, STAGES, STAGE_LABEL, STAGE_ICON, type Song } from '../types'
import StagePill from '../components/StagePill'
import StageDistribution from '../components/StageDistribution'
import InlineEdit from '../components/InlineEdit'

export default function ProjectPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<ApiProject | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    api
      .project(projectId)
      .then(({ project }) => setProject(project))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
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
              <InlineEdit
                value={project.name}
                onSave={saveName}
                inputClassName="font-display text-5xl"
                className="text-rainbow"
              />
            </h1>
            <div className="text-muted mt-2 text-sm">
              <InlineEdit
                value={project.subtitle ?? ''}
                onSave={saveSubtitle}
                emptyLabel="+ Add subtitle"
              />
            </div>
            <div className="text-[11px] text-muted mt-1 font-mono">
              📦 Dropbox root:{' '}
              <InlineEdit
                value={project.dropboxFolder ?? ''}
                onSave={saveRootFolder}
                emptyLabel="+ Set root folder"
                inputClassName="text-[11px] font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="relative rounded-3xl border border-line/70 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-stage-mastering/20 via-stage-producing/15 to-stage-mixing/20 opacity-80" />
        <div className="absolute inset-0 bg-ink/50" />
        <div className="relative p-6">
          <StageDistribution songs={songs} />
        </div>
      </div>

      <div className="space-y-8">
        {STAGES.map((stage) => {
          const stageSongs = songs.filter((s) => s.stage === stage)
          if (stageSongs.length === 0) return null
          const c = STAGE_COLOR[stage]
          return (
            <section key={stage}>
              <div className="flex items-center gap-2.5 mb-4">
                <span className={`text-lg leading-none`}>{STAGE_ICON[stage]}</span>
                <h2 className={`text-sm uppercase tracking-[0.25em] ${c.text} font-bold`}>
                  {STAGE_LABEL[stage]}
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
                      <StagePill stage={song.stage} size="xs" />
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
