// Admin dashboard for the guest-outreach sending-domain pool.
//
// Lists every domain in the pool with its status + health score, and
// lets the admin add new domains, edit notes, toggle active, pin a
// show, or remove them. Route: /admin/outreach/domains
//
// Health scoring lands with the sender — for now the score columns
// stay blank until we have send stats to compute them from.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ApiSendingDomain, type ApiProject } from '../api'
import { useAuth } from '../auth'

const STATUS_STYLE: Record<ApiSendingDomain['status'], { bg: string; label: string }> = {
  pending:   { bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: 'Pending' },
  verifying: { bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: 'Verifying' },
  verified:  { bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: 'Verified' },
  failed:    { bg: 'bg-urgent/15 text-urgent border-urgent/30', label: 'Failed' },
  paused:    { bg: 'bg-slate-500/15 text-muted border-slate-500/30', label: 'Paused' },
}

export default function OutreachDomainsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [domains, setDomains] = useState<ApiSendingDomain[] | null>(null)
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  type SyncReport = Awaited<ReturnType<typeof api.syncOutreachDomainsWithResend>>
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null)

  async function load() {
    try {
      const r = await api.outreachDomains()
      setDomains(r.domains)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }

  async function loadProjects() {
    try {
      const r = await api.projects()
      // Only podcast projects are eligible as primary shows for outreach.
      setProjects(r.projects.filter((p) => p.kind === 'podcast'))
    } catch {
      setProjects([])
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    void load()
    void loadProjects()
  }, [isAdmin])

  async function addDomain(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim().toLowerCase()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      await api.addOutreachDomain({ name })
      setNewName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed')
    } finally {
      setBusy(false)
    }
  }

  async function syncWithResend() {
    setSyncing(true)
    setError(null)
    setSyncReport(null)
    try {
      const r = await api.syncOutreachDomainsWithResend()
      setSyncReport(r)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function togglePin(d: ApiSendingDomain, showId: string | null) {
    try {
      await api.updateOutreachDomain(d.id, { primaryShowId: showId })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed')
    }
  }

  async function toggleActive(d: ApiSendingDomain) {
    try {
      await api.updateOutreachDomain(d.id, { active: !d.active })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed')
    }
  }

  async function markVerified(d: ApiSendingDomain) {
    try {
      await api.updateOutreachDomain(d.id, { status: 'verified' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed')
    }
  }

  async function removeDomain(d: ApiSendingDomain) {
    if (!confirm(`Remove ${d.name} from the pool? Slate will stop sending from it.`)) return
    try {
      await api.deleteOutreachDomain(d.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-muted text-sm">
        Admins only.{' '}
        <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold mb-1">
          Guest outreach
        </div>
        <h1 className="text-2xl font-bold">Sending domains</h1>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Slate rotates cold-outreach sends across this pool so no single domain concentrates the volume. Add a
          domain here after you've verified it in Resend. When one domain's reputation dips, Slate auto-pauses it
          and falls back to the next healthiest — you'll get an email so you can buy a replacement.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/5 px-3 py-2 text-xs text-urgent">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-stage-tracking/40 bg-stage-tracking/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-stage-tracking font-bold">Resend cross-check</h2>
            <p className="text-[11px] text-muted/70 mt-1 max-w-xl">
              Ask Resend what domains this API key can actually see. If Slate says "verified"
              but Resend rejects the send, this is the diagnostic — it'll surface the mismatch
              and fix Slate's status to match reality.
            </p>
          </div>
          <button
            onClick={() => void syncWithResend()}
            disabled={syncing}
            className="text-[10px] uppercase tracking-wider text-stage-tracking border border-stage-tracking/40 rounded-full px-3 py-1.5 hover:bg-stage-tracking/10 disabled:opacity-40 font-bold whitespace-nowrap"
          >
            {syncing ? 'Checking…' : '🔄 Sync with Resend'}
          </button>
        </div>
        {syncReport && (
          <div className="space-y-3 text-[11px]">
            <div className="rounded-lg border border-line bg-ink/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold mb-2">
                What Resend sees ({syncReport.resendDomainsSeen.length})
              </div>
              {syncReport.resendDomainsSeen.length === 0 ? (
                <p className="text-urgent">
                  <strong>Resend sees zero domains for this API key.</strong> Either the key is
                  wrong, it belongs to a different Resend team, or no domains have been added
                  under this account.
                </p>
              ) : (
                <ul className="space-y-1 font-mono">
                  {syncReport.resendDomainsSeen.map((d) => (
                    <li key={d.name} className="flex items-center gap-2">
                      <span className="font-bold">{d.name}</span>
                      <span className={
                        d.status === 'verified'
                          ? 'text-emerald-300'
                          : d.status === 'pending'
                            ? 'text-amber-300'
                            : 'text-urgent'
                      }>
                        {d.status}
                      </span>
                      {d.region && <span className="text-muted/60">({d.region})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-line bg-ink/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold mb-2">
                Slate ↔ Resend diff ({syncReport.changes.length})
              </div>
              <ul className="space-y-1 font-mono">
                {syncReport.changes.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{c.name}</span>
                    <span className="text-muted/60">Slate:</span>
                    <span className={
                      c.after.status === 'verified' ? 'text-emerald-300'
                      : c.after.status === 'verifying' ? 'text-amber-300'
                      : c.after.status === 'failed' ? 'text-urgent'
                      : 'text-muted'
                    }>
                      {c.after.status}
                    </span>
                    <span className="text-muted/60">Resend:</span>
                    <span className={
                      c.resendVisibility === 'missing'
                        ? 'text-urgent'
                        : c.resendStatus === 'verified'
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                    }>
                      {c.resendVisibility === 'missing' ? 'not found' : c.resendStatus}
                    </span>
                    {c.action === 'updated' && (
                      <span className="text-[9px] uppercase tracking-wider text-stage-mastering font-bold">
                        ← updated
                      </span>
                    )}
                    {c.action === 'missing_in_resend' && (
                      <span className="text-[9px] uppercase tracking-wider text-urgent font-bold">
                        ← problem
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">Pool</h2>
          <p className="text-[11px] text-muted/70 mt-1">
            {domains ? `${domains.length} domain${domains.length === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>

        {domains && domains.length === 0 && (
          <p className="text-sm text-muted italic">
            No domains added yet. Add one below.
          </p>
        )}

        {domains && domains.length > 0 && (
          <div className="space-y-3">
            {domains.map((d) => {
              const style = STATUS_STYLE[d.status]
              return (
                <div key={d.id} className="rounded-xl border border-line bg-ink/30 p-4 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm font-bold">{d.name}</span>
                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${style.bg}`}>
                      {style.label}
                    </span>
                    {!d.active && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-slate-500/20 text-muted border border-slate-500/40">
                        Paused
                      </span>
                    )}
                    <div className="flex-1" />
                    <span className="text-[10px] text-muted">
                      Health:{' '}
                      {d.health_score == null ? (
                        <span className="italic">not scored yet</span>
                      ) : (
                        <span className={d.health_score >= 60 ? 'text-emerald-400' : d.health_score >= 40 ? 'text-amber-400' : 'text-urgent'}>
                          {d.health_score} / 100
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="text-muted">Pinned show:</span>
                    <select
                      value={d.primary_show_id ?? ''}
                      onChange={(e) => void togglePin(d, e.target.value || null)}
                      className="bg-ink/40 border border-line rounded-full px-2 py-1 text-[11px] focus:outline-none focus:border-stage-mastering"
                    >
                      <option value="">(any show)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>

                    <button
                      onClick={() => void toggleActive(d)}
                      className={`ml-auto text-[10px] uppercase tracking-wider font-bold border rounded-full px-2.5 py-1 ${
                        d.active
                          ? 'text-muted border-line hover:bg-ink/40'
                          : 'text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10'
                      }`}
                    >
                      {d.active ? 'Pause' : 'Resume'}
                    </button>

                    {d.status !== 'verified' && (
                      <button
                        onClick={() => void markVerified(d)}
                        className="text-[10px] uppercase tracking-wider text-emerald-300 border border-emerald-500/40 rounded-full px-2.5 py-1 hover:bg-emerald-500/10 font-bold"
                        title="Mark this domain as verified after you've confirmed it in Resend."
                      >
                        Mark verified
                      </button>
                    )}

                    <button
                      onClick={() => void removeDomain(d)}
                      className="text-[10px] uppercase tracking-wider text-urgent border border-urgent/40 rounded-full px-2.5 py-1 hover:bg-urgent/10 font-bold"
                    >
                      Remove
                    </button>
                  </div>

                  {d.notes && (
                    <div className="text-[11px] text-muted italic">
                      {d.notes}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel/60 p-5">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-3">
          Add a domain
        </h2>
        <form onSubmit={addDomain} className="flex items-center gap-2 flex-wrap">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="strawhut.media"
            className="flex-1 min-w-[220px] bg-ink/40 border border-line rounded-full px-3 py-1.5 text-sm focus:outline-none focus:border-stage-mastering"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-40 font-bold"
          >
            {busy ? 'Adding…' : '+ Add domain'}
          </button>
        </form>
        <p className="text-[11px] text-muted/70 mt-3">
          Add the domain <em>after</em> you've verified it in Resend. Slate will show it as Pending until you mark
          it Verified here — it doesn't check Resend directly yet.
        </p>
      </section>
    </div>
  )
}
