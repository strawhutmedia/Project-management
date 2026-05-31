// "Slate's read on this show" — admin-only card that asks Claude to
// analyze the show (cover art context, RSS description, recent episode
// titles, transcript samples, team roster) and propose how the team
// should be running its socials.
//
// Each proposal has an "Accept" button that writes it into the show's
// real settings (brand voice, example posts, default assignees). The
// posting-times and cadence suggestions stay informational until we
// wire per-show scheduler overrides.
import { useState } from 'react'
import { api, type ApiProject, type ApiBrandProfile, type ApiMember } from '../api'

const KIND_LABEL: Record<keyof ApiBrandProfile['weeklyCadence'], string> = {
  text: '✍️ Text',
  photo: '📷 Photo',
  reel: '🎬 Reel',
  story: '💬 Story',
}

const ASSIGNEE_LABEL: Record<keyof ApiBrandProfile['defaultAssignees'], string> = {
  story_video: '💬 Story (video)',
  story_photo: '💬 Story (photo)',
  reel_concept: '🎬 Reel',
  photo_concept: '📷 Photo',
}

export default function BrandProfileCard({
  project,
  members,
  onSaved,
}: {
  project: ApiProject
  members: ApiMember[]
  onSaved: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const profile = project.brandProfile ?? null
  const generatedAt = project.brandProfileAt

  async function generate() {
    if (profile && !confirm('Re-run the analysis? Claude will be called again and overwrite the saved read.')) return
    setBusy(true); setError(null)
    try {
      await api.generateBrandProfile(project.id)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function acceptBrandVoice() {
    if (!profile) return
    setAccepting('voice')
    try {
      await api.updateProject(project.id, { socialsBrandVoice: profile.brandVoice })
      await onSaved()
    } finally { setAccepting(null) }
  }

  async function acceptExamplePosts() {
    if (!profile) return
    setAccepting('examples')
    try {
      await api.updateProject(project.id, { socialsExamplePosts: profile.examplePosts })
      await onSaved()
    } finally { setAccepting(null) }
  }

  async function acceptAssignees() {
    if (!profile) return
    setAccepting('assignees')
    try {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(profile.defaultAssignees)) {
        if (typeof v === 'string' && v.length > 0) clean[k] = v
      }
      await api.updateProject(project.id, { socialsDefaultAssignees: clean as Parameters<typeof api.updateProject>[1]['socialsDefaultAssignees'] })
      await onSaved()
    } finally { setAccepting(null) }
  }

  function userName(id: string | null): string {
    if (!id) return 'Unassigned'
    const m = members.find((u) => u.id === id)
    return m ? (m.display_name || m.name) : `${id.slice(0, 8)}…`
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🧠 Slate's read on this show</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-xl">
            Claude analyzes the cover art, RSS description, recent episode titles, and your most-recent
            transcripts, then proposes brand voice, example posts, posting times, weekly cadence, and
            default assignees. Adopt the pieces you like.
          </p>
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
        >
          {busy ? 'Analyzing…' : profile ? '↻ Re-analyze' : '✨ Generate analysis'}
        </button>
      </div>

      {error && <p className="text-urgent text-sm">{error}</p>}

      {!profile && !busy && (
        <p className="text-muted/70 text-sm italic py-4 text-center border border-dashed border-line/60 rounded-xl">
          No analysis yet. Tap ✨ to ask Claude.
        </p>
      )}

      {profile && (
        <div className="space-y-5 pt-2">
          {generatedAt && (
            <p className="text-[10px] text-muted/60 -mb-2">Last analyzed {new Date(generatedAt).toLocaleString()}</p>
          )}

          {/* Reasoning */}
          <div className="rounded-lg bg-ink/40 border border-line/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Why these choices</div>
            <p className="text-sm leading-snug text-muted">{profile.reasoning}</p>
          </div>

          {/* Brand voice */}
          <ProposalRow
            label="Brand voice"
            currentLabel={project.socialsBrandVoice ?? '— not set —'}
            accepted={!!project.socialsBrandVoice && project.socialsBrandVoice === profile.brandVoice}
            busy={accepting === 'voice'}
            onAccept={acceptBrandVoice}
          >
            <p className="text-sm leading-snug">{profile.brandVoice}</p>
          </ProposalRow>

          {/* Example posts */}
          <ProposalRow
            label="Example posts"
            currentLabel={`${project.socialsExamplePosts?.length ?? 0} on file`}
            accepted={JSON.stringify(project.socialsExamplePosts ?? []) === JSON.stringify(profile.examplePosts)}
            busy={accepting === 'examples'}
            onAccept={acceptExamplePosts}
          >
            <ol className="space-y-2 pl-5 list-decimal text-sm">
              {profile.examplePosts.map((p, i) => (
                <li key={i} className="whitespace-pre-wrap leading-snug">{p}</li>
              ))}
            </ol>
          </ProposalRow>

          {/* Default assignees */}
          <ProposalRow
            label="Default assignees"
            currentLabel="match Slate"
            accepted={false}
            busy={accepting === 'assignees'}
            onAccept={acceptAssignees}
          >
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
              {(Object.keys(profile.defaultAssignees) as Array<keyof typeof profile.defaultAssignees>).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold w-32 shrink-0">
                    {ASSIGNEE_LABEL[k]}
                  </span>
                  <span className="truncate">→ {userName(profile.defaultAssignees[k])}</span>
                </li>
              ))}
            </ul>
          </ProposalRow>

          {/* Posting times (informational — scheduler uses global default for now) */}
          <div className="rounded-lg border border-line/40 p-3 bg-ink/20">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-2">
              Suggested PT posting times <span className="opacity-60">(informational)</span>
            </div>
            <ul className="space-y-1 text-sm">
              {(Object.keys(profile.postingTimes) as Array<keyof typeof profile.postingTimes>).map((k) => (
                <li key={k} className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold w-16 shrink-0">{KIND_LABEL[k]}</span>
                  <span className="font-mono">{profile.postingTimes[k].map(format12h).join(' · ') || '—'}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Cadence */}
          <div className="rounded-lg border border-line/40 p-3 bg-ink/20">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-2">
              Suggested weekly cadence <span className="opacity-60">(promote this week's episode)</span>
            </div>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {(Object.keys(profile.weeklyCadence) as Array<keyof typeof profile.weeklyCadence>).map((k) => (
                <li key={k} className="text-center rounded-lg border border-line/60 bg-ink/30 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">{KIND_LABEL[k]}</div>
                  <div className="text-2xl font-display">{profile.weeklyCadence[k]}</div>
                  <div className="text-[10px] text-muted/60">per week</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

function ProposalRow({
  label,
  currentLabel,
  accepted,
  busy,
  onAccept,
  children,
}: {
  label: string
  currentLabel: string
  accepted: boolean
  busy: boolean
  onAccept: () => void | Promise<void>
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-line/60 p-3 space-y-2 bg-ink/20">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">{label}</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted/60">Current: {currentLabel}</span>
          {accepted ? (
            <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-300 border border-emerald-400/40 rounded-full px-2.5 py-0.5">
              ✓ Accepted
            </span>
          ) : (
            <button
              onClick={() => void onAccept()}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-2.5 py-0.5 hover:bg-stage-mastering/10 disabled:opacity-50"
            >
              {busy ? '…' : 'Accept'}
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function format12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}
