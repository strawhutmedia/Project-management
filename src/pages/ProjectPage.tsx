import { Link, useParams } from 'react-router-dom'
import { PROJECTS } from '../data'
import { STAGE_COLOR, STAGES, STAGE_LABEL } from '../types'
import StagePill from '../components/StagePill'
import StageDistribution from '../components/StageDistribution'

export default function ProjectPage() {
  const { projectId } = useParams()
  const project = PROJECTS.find((p) => p.id === projectId)

  if (!project) {
    return (
      <div className="text-muted">
        Project not found.{' '}
        <Link to="/" className="underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-[11px] uppercase tracking-wider text-muted hover:text-text">
          ← Projects
        </Link>
        <div className="mt-2 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted mb-1">
              {project.kind}
            </div>
            <h1 className="font-display text-5xl">{project.name}</h1>
            {project.subtitle && <p className="text-muted mt-1 text-sm">{project.subtitle}</p>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel/60 p-5">
        <StageDistribution songs={project.songs} />
      </div>

      <div className="space-y-6">
        {STAGES.map((stage) => {
          const songs = project.songs.filter((s) => s.stage === stage)
          if (songs.length === 0) return null
          const c = STAGE_COLOR[stage]
          return (
            <section key={stage}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                <h2 className={`text-xs uppercase tracking-[0.25em] ${c.text} font-semibold`}>
                  {STAGE_LABEL[stage]}
                </h2>
                <span className="text-[11px] text-muted">{songs.length}</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {songs.map((song) => (
                  <Link
                    key={song.id}
                    to={`/projects/${project.id}/songs/${song.id}`}
                    className={`group block rounded-xl bg-panel/70 hover:bg-panel transition border-l-4 ${c.border} border-y border-r border-line p-4`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-display text-xl truncate group-hover:text-text">
                          {song.title}
                        </div>
                        {song.subtitle && (
                          <div className="text-xs text-muted">{song.subtitle}</div>
                        )}
                      </div>
                      <StagePill stage={song.stage} size="xs" />
                    </div>
                    <div className="mt-3 text-[11px] text-muted flex items-center gap-3">
                      <span>{song.tasks.filter((t) => !t.done).length} open tasks</span>
                      <span>·</span>
                      <span>{song.comments.length} comments</span>
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
