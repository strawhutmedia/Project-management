// Admin outreach hub. Lists every podcast show with quick outreach
// stats + a link to the sending-domains pool. Click a show to jump
// into its Outreach section on the project page.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ApiOutreachProspect, type ApiProject, type ApiSendingDomain } from '../api'
import { useAuth } from '../auth'

type ShowStats = {
  project: ApiProject
  total: number
  needsEmail: number
  ready: number
  sent: number
  replied: number
}

export default function OutreachHubPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [shows, setShows] = useState<ShowStats[] | null>(null)
  const [domains, setDomains] = useState<ApiSendingDomain[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      try {
        const [projRes, domRes] = await Promise.all([
          api.projects(),
          api.outreachDomains(),
        ])
        if (cancelled) return
        setDomains(domRes.domains)
        const podcasts = projRes.projects.filter((p) => p.kind === 'podcast')
        // Fetch prospects for each podcast in parallel; each call is
        // small and admin-only so this is fine.
        const stats = await Promise.all(podcasts.map(async (project) => {
          try {
            const r = await api.outreachProspects(project.id)
            return summarize(project, r.prospects)
          } catch {
            return summarize(project, [])
          }
        }))
        if (!cancelled) setShows(stats)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <div className="text-muted text-sm">
        Admins only. <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    )
  }

  const totalProspects = shows?.reduce((s, x) => s + x.total, 0) ?? 0
  const totalReady = shows?.reduce((s, x) => s + x.ready, 0) ?? 0
  const totalSent = shows?.reduce((s, x) => s + x.sent, 0) ?? 0
  const totalReplied = shows?.reduce((s, x) => s + x.replied, 0) ?? 0
  const activeDomains = domains?.filter((d) => d.active && d.status === 'verified').length ?? 0

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold mb-1">
          Guest outreach
        </div>
        <h1 className="text-2xl font-bold">Reach out to potential guests</h1>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Pick a show below to build its prospect list and edit its outreach template. All sends rotate across
          your verified sending domains so no single sender identity carries all the volume.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/5 px-3 py-2 text-xs text-urgent">
          {error}
        </div>
      )}

      {/* At-a-glance stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Sending domains" value={activeDomains} suffix="active" />
        <StatTile label="Total prospects" value={totalProspects} />
        <StatTile label="Ready to send" value={totalReady} accent="text-sky-300" />
        <StatTile label="Sent" value={totalSent} accent="text-emerald-300" />
        <StatTile label="Replied" value={totalReplied} accent="text-fuchsia-300" />
      </div>

      {/* Sending domains link */}
      <Link
        to="/admin/outreach/domains"
        className="block rounded-2xl border border-line bg-panel/60 p-5 hover:border-stage-mastering/40 transition group"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">📡</span>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Admin</div>
            <div className="font-bold text-lg group-hover:text-stage-mastering transition">Sending domains</div>
            <div className="text-[11px] text-muted">
              {domains ? `${domains.length} in pool · ${activeDomains} verified & active` : 'Loading…'}
            </div>
          </div>
          <span className="text-muted group-hover:text-stage-mastering transition">→</span>
        </div>
      </Link>

      {/* Podcast shows */}
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-3">Podcast shows</h2>
        {shows === null && <p className="text-xs text-muted italic">Loading…</p>}
        {shows && shows.length === 0 && (
          <p className="text-xs text-muted italic">
            No podcast projects yet. Create one first from the dashboard.
          </p>
        )}
        {shows && shows.length > 0 && (
          <div className="space-y-3">
            {shows.map((s) => (
              <Link
                key={s.project.id}
                to={`/admin/outreach/shows/${s.project.id}`}
                className="block rounded-2xl border border-line bg-panel/60 p-4 hover:border-stage-mastering/40 transition group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base sm:text-lg group-hover:text-stage-mastering transition truncate">
                      {s.project.name}
                    </div>
                    {s.project.subtitle && (
                      <div className="text-[11px] text-muted truncate">{s.project.subtitle}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px] uppercase tracking-wider font-bold">
                    {s.needsEmail > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                        {s.needsEmail} needs email
                      </span>
                    )}
                    {s.ready > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 whitespace-nowrap">
                        {s.ready} ready
                      </span>
                    )}
                    {s.sent > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                        {s.sent} sent
                      </span>
                    )}
                    {s.replied > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30 whitespace-nowrap">
                        {s.replied} replied
                      </span>
                    )}
                    {s.total === 0 && (
                      <span className="text-muted/60 italic normal-case font-normal">
                        No prospects — tap to start
                      </span>
                    )}
                  </div>
                  <span className="hidden sm:inline text-muted group-hover:text-stage-mastering transition">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function summarize(project: ApiProject, prospects: ApiOutreachProspect[]): ShowStats {
  return {
    project,
    total: prospects.length,
    needsEmail: prospects.filter((p) => p.status === 'needs_email').length,
    ready: prospects.filter((p) => p.status === 'ready').length,
    sent: prospects.filter((p) => p.status === 'sent').length,
    replied: prospects.filter((p) => p.status === 'replied').length,
  }
}

function StatTile({ label, value, accent, suffix }: { label: string; value: number; accent?: string; suffix?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel/60 px-3 py-3">
      <div className="text-[9px] uppercase tracking-wider text-muted font-bold">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent ?? ''}`}>{value}</div>
      {suffix && <div className="text-[10px] text-muted mt-0.5">{suffix}</div>}
    </div>
  )
}
