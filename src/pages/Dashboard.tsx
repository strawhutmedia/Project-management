import { Link } from 'react-router-dom'
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

  useEffect(() => {
    api
      .projects()
      .then(({ projects }) => setProjects(projects))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
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
            disabled
            className="rounded-3xl border-2 border-dashed border-line/70 bg-panel/20 p-6 text-left text-muted hover:text-text transition opacity-60 cursor-not-allowed"
          >
            <div className="text-[10px] uppercase tracking-[0.3em] mb-1 font-bold">+ New project</div>
            <div className="text-sm">
              Create a new project. Coming next push.
            </div>
          </button>
        </section>
      )}
    </div>
  )
}
