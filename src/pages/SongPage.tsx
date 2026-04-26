import { Link, useParams } from 'react-router-dom'
import { PROJECTS } from '../data'
import { STAGES, STAGE_COLOR, STAGE_LABEL } from '../types'
import StagePill from '../components/StagePill'

export default function SongPage() {
  const { projectId, songId } = useParams()
  const project = PROJECTS.find((p) => p.id === projectId)
  const song = project?.songs.find((s) => s.id === songId)

  if (!project || !song) {
    return (
      <div className="text-muted">
        Song not found.{' '}
        <Link to="/" className="underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  const c = STAGE_COLOR[song.stage]
  const stageIndex = STAGES.indexOf(song.stage)

  return (
    <div className="space-y-8">
      <div>
        <Link
          to={`/projects/${project.id}`}
          className="text-[11px] uppercase tracking-wider text-muted hover:text-text"
        >
          ← {project.name}
        </Link>
        <div className="mt-2 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted mb-1">song</div>
            <h1 className="font-display text-5xl">{song.title}</h1>
            {song.subtitle && <p className="text-muted mt-1 text-sm">{song.subtitle}</p>}
          </div>
          <StagePill stage={song.stage} />
        </div>
      </div>

      <div className={`rounded-2xl border ${c.border}/30 ${c.bg} p-5`}>
        <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Pipeline</div>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {STAGES.map((s, i) => {
            const sc = STAGE_COLOR[s]
            const passed = i <= stageIndex
            return (
              <div key={s} className="flex items-center gap-1 shrink-0">
                <div
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold ${
                    passed ? `${sc.bg} ${sc.text} border ${sc.border}/40` : 'text-muted/60 border border-line'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${passed ? sc.dot : 'bg-line'}`} />
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

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 rounded-2xl border border-line bg-panel/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-wider text-muted">What's left</h2>
            <button
              disabled
              className="text-xs text-muted opacity-60 cursor-not-allowed border border-line rounded-full px-2.5 py-1"
            >
              + Add task
            </button>
          </div>
          {song.tasks.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center border border-dashed border-line rounded-xl">
              No tasks yet. Once you tell me what's left for this song, they'll show up here.
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
          <section className="rounded-2xl border border-line bg-panel/60 p-5">
            <h2 className="text-[11px] uppercase tracking-wider text-muted mb-3">People</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">Producer</span>
                <span>{song.producer ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Mixer</span>
                <span>{song.mixer ?? '—'}</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-panel/60 p-5">
            <h2 className="text-[11px] uppercase tracking-wider text-muted mb-3">Links</h2>
            {song.links.length === 0 ? (
              <p className="text-sm text-muted">
                Drop Dropbox or WeTransfer links here once we wire it up.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {song.links.map((l) => (
                  <li key={l.id}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-stage-stems hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-line bg-panel/60 p-5">
        <h2 className="text-[11px] uppercase tracking-wider text-muted mb-3">Comments</h2>
        <div className="text-sm text-muted py-6 text-center border border-dashed border-line rounded-xl">
          Comments + @mentions show up here once login is live.
        </div>
      </section>
    </div>
  )
}
