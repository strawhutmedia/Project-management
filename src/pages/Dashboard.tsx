import { Link } from 'react-router-dom'
import { PROJECTS } from '../data'
import StageDistribution from '../components/StageDistribution'

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-5xl mb-1">Projects</h1>
        <p className="text-muted text-sm">
          Albums, podcast seasons, and films in production at Straw Hut Media.
        </p>
      </section>

      <section className="grid gap-4">
        {PROJECTS.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className="group block rounded-2xl border border-line bg-panel/60 hover:bg-panel transition p-6"
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted mb-1">
                  {p.kind}
                </div>
                <h2 className="font-display text-3xl group-hover:text-stage-mastering transition">
                  {p.name}
                </h2>
                {p.subtitle && <p className="text-sm text-muted mt-1">{p.subtitle}</p>}
              </div>
              <span className="text-xs text-muted opacity-0 group-hover:opacity-100 transition">
                Open →
              </span>
            </div>
            <StageDistribution songs={p.songs} />
          </Link>
        ))}

        <button
          disabled
          className="rounded-2xl border border-dashed border-line/70 bg-panel/30 p-6 text-left text-muted hover:text-text transition opacity-60 cursor-not-allowed"
        >
          <div className="text-[10px] uppercase tracking-[0.25em] mb-1">+ New project</div>
          <div className="text-sm">
            Add an album, podcast season, or film. Available once login is wired up.
          </div>
        </button>
      </section>
    </div>
  )
}
