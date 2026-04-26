import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiProject, type ApiSong } from '../api'
import { STAGES, STAGE_COLOR, STAGE_LABEL, STAGE_ICON } from '../types'
import StagePill from '../components/StagePill'

export default function SongPage() {
  const { projectId, songId } = useParams()
  const [project, setProject] = useState<ApiProject | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    api
      .project(projectId)
      .then(({ project }) => setProject(project))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [projectId])

  if (error) return <div className="text-muted">{error}</div>
  if (!project) return <p className="text-muted text-sm">Loading…</p>

  const song = project.songs.find((s) => s.id === songId) as ApiSong | undefined
  if (!song) {
    return (
      <div className="text-muted">
        Song not found.{' '}
        <Link to={`/projects/${project.id}`} className="underline">
          Back
        </Link>
      </div>
    )
  }

  const c = STAGE_COLOR[song.stage]
  const stageIndex = STAGES.indexOf(song.stage)

  return (
    <div className="space-y-10">
      <div>
        <Link
          to={`/projects/${project.id}`}
          className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold"
        >
          ← {project.name}
        </Link>
        <div className="mt-3 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className={`text-[10px] uppercase tracking-[0.3em] mb-2 font-bold ${c.text}`}>
              {STAGE_ICON[song.stage]} {STAGE_LABEL[song.stage]}
            </div>
            <h1 className={`font-display text-6xl leading-none`}>
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

      <div className={`relative rounded-3xl border ${c.border}/30 overflow-hidden`}>
        <div className={`absolute inset-0 ${c.bgStrong} opacity-60`} />
        <div className="absolute inset-0 bg-ink/40" />
        <div className="relative p-6">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4 font-bold">Pipeline</div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {STAGES.map((s, i) => {
              const sc = STAGE_COLOR[s]
              const passed = i <= stageIndex
              const current = i === stageIndex
              return (
                <div key={s} className="flex items-center gap-1.5 shrink-0">
                  <div
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold ${
                      passed
                        ? `${sc.bgStrong} ${sc.text} border ${sc.border}/50 ${current ? sc.glow : ''}`
                        : 'text-muted/60 border border-line'
                    }`}
                  >
                    <span className="text-[0.95em] leading-none">{STAGE_ICON[s]}</span>
                    {STAGE_LABEL[s]}
                  </div>
                  {i < STAGES.length - 1 && (
                    <div
                      className={`w-3 h-px ${passed && i < stageIndex ? sc.dot : 'bg-line'}`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 rounded-2xl border border-line bg-panel/60 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📝 What's left</h2>
            <button
              disabled
              className="text-xs text-muted opacity-60 cursor-not-allowed border border-line rounded-full px-3 py-1"
            >
              + Add task (next push)
            </button>
          </div>
          {song.tasks.length === 0 ? (
            <div className="text-sm text-muted py-8 text-center border border-dashed border-line rounded-xl">
              No tasks yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {song.tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg border border-line p-3 bg-ink/40"
                >
                  <input type="checkbox" checked={t.done} readOnly className="accent-stage-done" />
                  <span className={t.done ? 'line-through text-muted' : ''}>{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-line bg-panel/60 p-6">
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4 font-bold">🔗 Links</h2>
            <p className="text-sm text-muted">Comments, links, and Dropbox files coming next push.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
