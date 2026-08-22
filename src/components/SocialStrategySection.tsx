// Per-show social media strategy dashboard.
//
// Ten Claude-driven strategy tools shown as cards. Each card:
//   - shows the doc's status ("Not yet generated" / "Generated 3d ago")
//   - Run button → prompts for input if the tool has a [paste] field,
//                  otherwise fires straight into a Claude call
//   - View button → opens a modal showing the full document
//
// The document types are rich JSON — the modal renders each kind's
// shape with a dedicated pretty-print. Editing is inline via a
// "raw JSON" fallback for now; per-kind edit forms come in a later
// pass once the shape stabilizes.
import { useEffect, useState } from 'react'
import { api, type ApiStrategyDocument, type StrategyKind } from '../api'

type Tool = {
  kind: StrategyKind
  label: string
  purpose: string
  needsPaste: boolean
  pasteHint?: string
  accent: string
}

// Order matters — this is the recommended sequence to build up a
// show's strategy, and downstream tools reference upstream ones.
const TOOLS: Tool[] = [
  {
    kind: 'strategy',
    label: '1. Full Social Media Strategy',
    purpose: 'The complete system: positioning, content direction, audience, posting rhythm, engagement habits, tracking, monetization. Run this first — everything else gets its context from here.',
    needsPaste: true,
    pasteHint: 'Anything you want the strategist to know that isn\'t already on the show record — recent numbers, upcoming pushes, past-run experiments, sponsor pressure, available time per week, etc.',
    accent: 'stage-mastering',
  },
  {
    kind: 'profile_audit',
    label: '2. Fix the Profile',
    purpose: 'Audit of bio, picture, content, positioning, consistency, and engagement — what\'s helping, what\'s hurting, and the biggest fixes. Fix the account before feeding it more content.',
    needsPaste: true,
    pasteHint: 'The profile link, plus paste the current bio text and describe the profile picture, pinned posts, and recent content. The more you paste, the sharper the audit.',
    accent: 'stage-writing',
  },
  {
    kind: 'audience',
    label: '3. Audience Psychology Breakdown',
    purpose: 'Frustrations, desires, fears, daily content habits — turned into scroll-stopping messaging angles.',
    needsPaste: false,
    accent: 'stage-tracking',
  },
  {
    kind: 'authority',
    label: '4. Authority Positioning Plan',
    purpose: 'What separates this show from every competitor. Signature content moves that build authority.',
    needsPaste: false,
    accent: 'stage-overdubs',
  },
  {
    kind: 'pillars',
    label: '5. Content Pillars That Convert',
    purpose: '5 pillars the show posts about consistently, each mapped to a goal (reach / trust / buy).',
    needsPaste: false,
    accent: 'stage-producing',
  },
  {
    kind: 'calendar',
    label: '6. 30-Day Content Plan',
    purpose: 'A month of hooks in one sitting. Every day: idea, written-out hook, key message, CTA, format, post type (educational / entertaining / personal / authority / community), and goal.',
    needsPaste: false,
    accent: 'stage-stems',
  },
  {
    kind: 'ideas',
    label: '7. Never Run Out of Ideas',
    purpose: 'Idea bank sorted by beginner / intermediate / advanced audience levels — so the show stops writing the same beginner post forever. Evergreen, problem-solving ideas first.',
    needsPaste: false,
    accent: 'stage-done',
  },
  {
    kind: 'winners',
    label: '8. Copy Your Own Winners',
    purpose: 'Paste past posts (with numbers if you have them) — get the patterns behind the strongest and weakest ones, plus a repeatable formula. Your best posts already hold it.',
    needsPaste: true,
    pasteHint: 'Paste 5-15 past posts, each with whatever performance you know (likes, saves, shares, comments). Label them however is easiest — "Post 1: … (2.1k likes)".',
    accent: 'stage-overdubs',
  },
  {
    kind: 'monetization',
    label: '9. Audience Monetization Strategy',
    purpose: 'Offer ideas, pricing, content angles that convert followers to buyers, funnel stages.',
    needsPaste: false,
    accent: 'urgent',
  },
  {
    kind: 'post',
    label: '10. Write the Caption Last',
    purpose: 'One natural, brand-voice caption on a specific topic: first-sentence hook, clear value, strong CTA. Caption last, never first — it works because the tools above already told it who you are.',
    needsPaste: true,
    pasteHint: 'The topic. Be specific — "why our last episode\'s guest changed her mind about AI music" beats "AI music".',
    accent: 'stage-mixing',
  },
]

export default function SocialStrategySection({
  projectId, canWrite,
}: {
  projectId: string
  canWrite: boolean
}) {
  const [docs, setDocs] = useState<Record<string, ApiStrategyDocument | undefined>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openDoc, setOpenDoc] = useState<Tool | null>(null)
  const [runningTool, setRunningTool] = useState<Tool | null>(null)

  async function load() {
    try {
      const r = await api.socialStrategyDocs(projectId)
      setDocs(r.documents)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [projectId])

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🧠 Social Media Strategy</h2>
        <p className="text-[11px] text-muted/80 mt-1">
          Ten strategist tools per show, in run order. Build these once and every text post,
          carousel, and daily plan generation references them for context.
        </p>
      </div>

      {loading && <p className="text-xs text-muted italic">Loading…</p>}
      {error && <p className="text-urgent text-xs">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TOOLS.map((tool) => {
          const doc = docs[tool.kind]
          return (
            <ToolCard
              key={tool.kind}
              tool={tool}
              doc={doc}
              canWrite={canWrite}
              onRun={() => setRunningTool(tool)}
              onView={() => setOpenDoc(tool)}
            />
          )
        })}
      </div>

      {runningTool && (
        <RunModal
          tool={runningTool}
          projectId={projectId}
          onClose={() => setRunningTool(null)}
          onDone={async () => {
            setRunningTool(null)
            await load()
          }}
        />
      )}

      {openDoc && docs[openDoc.kind] && (
        <ViewModal
          tool={openDoc}
          doc={docs[openDoc.kind]!}
          onClose={() => setOpenDoc(null)}
          canWrite={canWrite}
          onEdited={load}
          projectId={projectId}
        />
      )}
    </section>
  )
}

function ToolCard({ tool, doc, canWrite, onRun, onView }: {
  tool: Tool
  doc?: ApiStrategyDocument
  canWrite: boolean
  onRun: () => void
  onView: () => void
}) {
  const generated = !!doc && doc.status === 'generated'
  return (
    <div className={`rounded-xl border border-line bg-ink/30 p-3 space-y-2 hover:border-${tool.accent}/40 transition`}>
      <div>
        <p className={`text-xs font-bold text-${tool.accent}`}>{tool.label}</p>
        <p className="text-[10px] text-muted/80 mt-1 leading-relaxed">{tool.purpose}</p>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-line/40">
        <div className="text-[10px] text-muted">
          {generated
            ? `Generated ${timeAgo(doc.updated_at)}`
            : <span className="italic">Not yet generated</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {generated && (
            <button
              onClick={onView}
              className="text-[10px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded-full px-2 py-1"
            >
              View
            </button>
          )}
          {canWrite && (
            <button
              onClick={onRun}
              className={`text-[10px] uppercase tracking-wider font-bold text-${tool.accent} border border-${tool.accent}/40 rounded-full px-2 py-1 hover:bg-${tool.accent}/10`}
            >
              {generated ? '↻ Regenerate' : '✨ Run'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RunModal({ tool, projectId, onClose, onDone }: {
  tool: Tool
  projectId: string
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Detect whether the show's brief is filled in — if not, warn that
  // output quality will be significantly weaker. Users can still
  // proceed, but they see the tradeoff.
  const [briefStatus, setBriefStatus] = useState<'unknown' | 'empty' | 'partial' | 'filled'>('unknown')
  useEffect(() => {
    let cancelled = false
    api.showBrief(projectId).then((r) => {
      if (cancelled) return
      const b = r.brief ?? {}
      const filledCount = Object.values(b).filter((v) => typeof v === 'string' && v.trim()).length
      setBriefStatus(filledCount === 0 ? 'empty' : filledCount < 4 ? 'partial' : 'filled')
    }).catch(() => { if (!cancelled) setBriefStatus('unknown') })
    return () => { cancelled = true }
  }, [projectId])

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await api.generateSocialStrategyDoc(projectId, tool.kind, input || undefined)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-card border border-line shadow-2xl">
        <header className="p-5 border-b border-line">
          <div className={`text-[10px] uppercase tracking-wider text-${tool.accent} font-bold`}>Run tool</div>
          <h2 className="text-lg font-bold text-text mt-0.5">{tool.label}</h2>
          <p className="text-xs text-muted mt-1">{tool.purpose}</p>
        </header>
        <div className="p-5 space-y-3">
          {briefStatus === 'empty' && (
            <div className="rounded-lg border border-urgent/40 bg-urgent/5 p-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-urgent font-bold">⚠ Show Brief is empty</p>
              <p className="text-xs text-muted">
                Output quality will be significantly weaker without a brief. Consider filling out the Show Brief
                (above this section) first — Claude will have real facts to work from instead of guessing from
                the show name.
              </p>
            </div>
          )}
          {briefStatus === 'partial' && (
            <div className="rounded-lg border border-stage-tracking/40 bg-stage-tracking/5 p-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-stage-tracking font-bold">↑ Show Brief is partial</p>
              <p className="text-xs text-muted">
                A few questions in the Show Brief are still blank. Filling more of them before running this tool
                usually meaningfully improves the output.
              </p>
            </div>
          )}
          {tool.needsPaste ? (
            <label className="space-y-1 block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
                Your input {tool.needsPaste && <span className="text-urgent">(required)</span>}
              </span>
              <textarea
                rows={5}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full bg-ink/40 border border-line rounded px-3 py-2 text-sm text-text font-mono"
                placeholder={tool.pasteHint}
              />
            </label>
          ) : (
            <p className="text-[11px] text-muted italic">
              No extra input needed — Claude pulls from the Show Brief, the show record, and any strategy docs
              already generated.
            </p>
          )}
          {error && <p className="text-urgent text-sm">{error}</p>}
        </div>
        <footer className="p-5 border-t border-line flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded-full px-3 py-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void run()}
            disabled={busy || (tool.needsPaste && !input.trim())}
            className={`text-[11px] uppercase tracking-wider font-bold text-white bg-${tool.accent} rounded-full px-4 py-2 disabled:opacity-50`}
          >
            {busy ? 'Generating…' : '✨ Generate'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ViewModal({ tool, doc, onClose, canWrite, onEdited, projectId }: {
  tool: Tool
  doc: ApiStrategyDocument
  onClose: () => void
  canWrite: boolean
  onEdited: () => void | Promise<void>
  projectId: string
}) {
  const [editing, setEditing] = useState(false)
  const [rawJson, setRawJson] = useState(JSON.stringify(doc.content, null, 2))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const parsed = JSON.parse(rawJson)
      await api.updateSocialStrategyDoc(projectId, tool.kind, parsed)
      await onEdited()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-card border border-line shadow-2xl">
        <header className="p-5 border-b border-line flex items-start justify-between gap-3">
          <div>
            <div className={`text-[10px] uppercase tracking-wider text-${tool.accent} font-bold`}>Strategy document</div>
            <h2 className="text-lg font-bold text-text mt-0.5">{tool.label}</h2>
            <p className="text-[10px] text-muted mt-1">
              Last generated {timeAgo(doc.updated_at)} ·
              {' '}{doc.input_tokens.toLocaleString()} in / {doc.output_tokens.toLocaleString()} out tokens
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-lg">✕</button>
        </header>
        <div className="p-5 max-h-[65vh] overflow-y-auto space-y-4">
          {editing ? (
            <>
              <p className="text-[11px] text-muted italic">
                Raw JSON edit — save carefully. Per-field forms are coming in a later pass.
              </p>
              <textarea
                rows={22}
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                className="w-full bg-ink/40 border border-line rounded p-3 text-xs text-text font-mono"
              />
              {error && <p className="text-urgent text-sm">{error}</p>}
            </>
          ) : (
            <DocumentRenderer kind={tool.kind} content={doc.content} />
          )}
        </div>
        <footer className="p-5 border-t border-line flex items-center justify-end gap-2">
          {canWrite && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded-full px-3 py-2"
            >
              ✎ Edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => { setEditing(false); setRawJson(JSON.stringify(doc.content, null, 2)) }}
                className="text-[11px] uppercase tracking-wider font-bold text-muted hover:text-text border border-line rounded-full px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className={`text-[11px] uppercase tracking-wider font-bold text-white bg-${tool.accent} rounded-full px-4 py-2 disabled:opacity-50`}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          {!editing && (
            <button
              onClick={onClose}
              className="text-[11px] uppercase tracking-wider font-bold text-white bg-stage-mastering rounded-full px-4 py-2"
            >
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

// ============================================================
// Per-kind pretty-printers
// ============================================================
function DocumentRenderer({ kind, content }: { kind: StrategyKind; content: Record<string, unknown> }) {
  switch (kind) {
    case 'strategy':      return <StrategyDoc content={content} />
    case 'profile_audit': return <ProfileAuditDoc content={content} />
    case 'audience':      return <AudienceDoc content={content} />
    case 'authority':     return <AuthorityDoc content={content} />
    case 'pillars':       return <PillarsDoc content={content} />
    case 'calendar':      return <CalendarDoc content={content} />
    case 'ideas':         return <IdeasDoc content={content} />
    case 'winners':       return <WinnersDoc content={content} />
    case 'post':          return <PostDoc content={content} />
    case 'monetization':  return <MonetizationDoc content={content} />
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] uppercase tracking-wider text-muted font-bold">{title}</h3>
      <div className="text-sm text-text leading-relaxed">{children}</div>
    </div>
  )
}

function BulletList({ items }: { items: unknown[] }) {
  return (
    <ul className="list-disc list-inside space-y-1">
      {items.filter((x): x is string => typeof x === 'string').map((s, i) => <li key={i}>{s}</li>)}
    </ul>
  )
}

function StrategyDoc({ content }: { content: Record<string, unknown> }) {
  const bp = (content.brand_positioning ?? {}) as Record<string, unknown>
  const cd = (content.content_direction ?? {}) as Record<string, unknown>
  const at = (content.audience_targeting ?? {}) as Record<string, unknown>
  const mp = (content.monetization_plan ?? {}) as Record<string, unknown>
  // Newer docs (Aug 2026 playbook) include the full system — posting,
  // engagement, tracking. Older docs don't; render those sections only
  // when present so pre-upgrade documents still display cleanly.
  const ps = content.posting_system as Record<string, unknown> | undefined
  const ep = content.engagement_plan as Record<string, unknown> | undefined
  const tr = content.tracking as Record<string, unknown> | undefined
  return (
    <div className="space-y-4">
      <Section title="Brand positioning">
        <p className="font-bold">{String(bp.one_sentence ?? '')}</p>
        <p className="text-muted text-xs mt-1">Category: {String(bp.category ?? '')}</p>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Differentiators</p>
          <BulletList items={Array.isArray(bp.differentiators) ? bp.differentiators : []} />
        </div>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Tagline options</p>
          <BulletList items={Array.isArray(bp.tagline_options) ? bp.tagline_options : []} />
        </div>
      </Section>
      <Section title="Content direction">
        <p><span className="text-muted">Tone:</span> {String(cd.tone ?? '')}</p>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Themes</p>
          <BulletList items={Array.isArray(cd.themes) ? cd.themes : []} />
        </div>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Prioritize formats</p>
          <BulletList items={Array.isArray(cd.formats_to_prioritize) ? cd.formats_to_prioritize : []} />
        </div>
      </Section>
      <Section title="Audience targeting">
        <p>{String(at.primary_persona ?? '')}</p>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Where they hang out</p>
          <BulletList items={Array.isArray(at.where_they_hang_out) ? at.where_they_hang_out : []} />
        </div>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">What gets them to follow</p>
          <BulletList items={Array.isArray(at.what_gets_them_to_follow) ? at.what_gets_them_to_follow : []} />
        </div>
      </Section>
      {ps && (
        <Section title="Posting system">
          <p><span className="text-muted">Cadence:</span> {String(ps.cadence ?? '')}</p>
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Weekly rhythm</p>
            <BulletList items={Array.isArray(ps.weekly_rhythm) ? ps.weekly_rhythm : []} />
          </div>
          {typeof ps.time_budget_fit === 'string' && ps.time_budget_fit && (
            <p className="text-xs text-muted mt-2 italic">{ps.time_budget_fit}</p>
          )}
        </Section>
      )}
      {ep && (
        <Section title="Engagement plan">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Daily habits</p>
            <BulletList items={Array.isArray(ep.daily_habits) ? ep.daily_habits : []} />
          </div>
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Community moves</p>
            <BulletList items={Array.isArray(ep.community_moves) ? ep.community_moves : []} />
          </div>
        </Section>
      )}
      {tr && (
        <Section title="Tracking">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Metrics to watch</p>
            <BulletList items={Array.isArray(tr.metrics_to_watch) ? tr.metrics_to_watch : []} />
          </div>
          <p className="text-xs text-muted mt-2"><span className="uppercase text-[10px] tracking-wider">Review cadence:</span> {String(tr.review_cadence ?? '')}</p>
        </Section>
      )}
      <Section title="Monetization plan">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Near term</p>
          <BulletList items={Array.isArray(mp.near_term) ? mp.near_term : []} />
        </div>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Medium term</p>
          <BulletList items={Array.isArray(mp.medium_term) ? mp.medium_term : []} />
        </div>
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Long term</p>
          <BulletList items={Array.isArray(mp.long_term) ? mp.long_term : []} />
        </div>
      </Section>
      <Section title="Growth north star">
        <p className="font-bold">{String(content.growth_north_star ?? '')}</p>
      </Section>
    </div>
  )
}

function AudienceDoc({ content }: { content: Record<string, unknown> }) {
  const angles = Array.isArray(content.messaging_angles) ? content.messaging_angles as Array<Record<string, unknown>> : []
  return (
    <div className="space-y-4">
      <Section title="Persona snapshot"><p>{String(content.persona_snapshot ?? '')}</p></Section>
      <Section title="Frustrations"><BulletList items={Array.isArray(content.frustrations) ? content.frustrations : []} /></Section>
      <Section title="Desires"><BulletList items={Array.isArray(content.desires) ? content.desires : []} /></Section>
      <Section title="Fears"><BulletList items={Array.isArray(content.fears) ? content.fears : []} /></Section>
      <Section title="Daily content habits"><BulletList items={Array.isArray(content.daily_content_habits) ? content.daily_content_habits : []} /></Section>
      <Section title="Messaging angles">
        <div className="space-y-2">
          {angles.map((a, i) => (
            <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
              <p className="font-bold">{String(a.angle ?? '')}</p>
              <p className="text-xs text-muted mt-1">{String(a.why_it_works ?? '')}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Topic ideas"><BulletList items={Array.isArray(content.topic_ideas) ? content.topic_ideas : []} /></Section>
    </div>
  )
}

function AuthorityDoc({ content }: { content: Record<string, unknown> }) {
  const comps = Array.isArray(content.competitors_to_watch) ? content.competitors_to_watch as Array<Record<string, unknown>> : []
  return (
    <div className="space-y-4">
      <Section title="Positioning statement"><p className="font-bold">{String(content.positioning_statement ?? '')}</p></Section>
      <Section title="Differentiators"><BulletList items={Array.isArray(content.differentiators) ? content.differentiators : []} /></Section>
      <Section title="Proof points to build"><BulletList items={Array.isArray(content.proof_points_to_build) ? content.proof_points_to_build : []} /></Section>
      <Section title="Signature content moves"><BulletList items={Array.isArray(content.signature_content_moves) ? content.signature_content_moves : []} /></Section>
      <Section title="Competitors to watch">
        <div className="space-y-2">
          {comps.map((c, i) => (
            <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
              <p className="font-bold">{String(c.name ?? '')}</p>
              <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Why they matter:</span> {String(c.why_they_matter ?? '')}</p>
              <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">How you differ:</span> {String(c.how_you_are_different ?? '')}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function PillarsDoc({ content }: { content: Record<string, unknown> }) {
  const pillars = Array.isArray(content.pillars) ? content.pillars as Array<Record<string, unknown>> : []
  return (
    <div className="space-y-3">
      {pillars.map((p, i) => (
        <div key={i} className="rounded-lg bg-ink/30 border border-line p-3">
          <p className="font-bold text-base">{i + 1}. {String(p.name ?? '')}</p>
          <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Purpose:</span> {String(p.purpose ?? '')}</p>
          <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Why it connects:</span> {String(p.why_it_connects ?? '')}</p>
          <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Suggested frequency:</span> {String(p.suggested_frequency ?? '')}</p>
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Example post topics</p>
            <BulletList items={Array.isArray(p.example_post_topics) ? p.example_post_topics : []} />
          </div>
        </div>
      ))}
    </div>
  )
}

function CalendarDoc({ content }: { content: Record<string, unknown> }) {
  const days = Array.isArray(content.days) ? content.days as Array<Record<string, unknown>> : []
  const goalStyle = (g: string) => g === 'reach' ? 'text-stage-tracking' : g === 'trust' ? 'text-stage-mastering' : 'text-urgent'
  return (
    <div className="space-y-2">
      {typeof content.start_date_hint === 'string' && content.start_date_hint && (
        <p className="text-[11px] text-muted italic">Suggested start: {content.start_date_hint}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {days.map((d, i) => (
          <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Day {String(d.day ?? i + 1)}</span>
              <span className="flex items-center gap-1.5">
                {typeof d.post_type === 'string' && d.post_type && (
                  <span className="text-[9px] uppercase tracking-wider font-bold text-muted border border-line rounded-full px-1.5 py-0.5">{d.post_type}</span>
                )}
                <span className={`text-[9px] uppercase tracking-wider font-bold ${goalStyle(String(d.goal))}`}>{String(d.goal ?? '')}</span>
              </span>
            </div>
            <p className="text-sm font-bold text-text mt-1">{String(d.idea ?? '')}</p>
            {typeof d.hook === 'string' && d.hook && (
              <p className="text-xs text-text mt-1 italic">“{d.hook}”</p>
            )}
            <p className="text-xs text-muted mt-1">{String(d.core_message ?? '')}</p>
            {typeof d.cta === 'string' && d.cta && (
              <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">CTA:</span> {d.cta}</p>
            )}
            <div className="flex items-center gap-2 mt-2 text-[10px] text-muted">
              <span className="uppercase tracking-wider">{String(d.format ?? '')}</span>
              <span>·</span>
              <span>Pillar: {String(d.pillar ?? '—')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfileAuditDoc({ content }: { content: Record<string, unknown> }) {
  const fixes = Array.isArray(content.biggest_fixes) ? content.biggest_fixes as Array<Record<string, unknown>> : []
  return (
    <div className="space-y-4">
      <Section title="First impression"><p>{String(content.first_impression ?? '')}</p></Section>
      <Section title="What's helping growth"><BulletList items={Array.isArray(content.whats_helping) ? content.whats_helping : []} /></Section>
      <Section title="What's hurting growth"><BulletList items={Array.isArray(content.whats_hurting) ? content.whats_hurting : []} /></Section>
      <Section title="Biggest fixes (in order)">
        <div className="space-y-2">
          {fixes.map((f, i) => (
            <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
              <p className="font-bold">{i + 1}. {String(f.fix ?? '')}</p>
              <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Why:</span> {String(f.why ?? '')}</p>
              <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">How:</span> {String(f.how ?? '')}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Bio rewrite options"><BulletList items={Array.isArray(content.bio_rewrite_options) ? content.bio_rewrite_options : []} /></Section>
      <Section title="Consistency"><p className="text-muted">{String(content.consistency_notes ?? '')}</p></Section>
      <Section title="Engagement"><p className="text-muted">{String(content.engagement_notes ?? '')}</p></Section>
    </div>
  )
}

function IdeasDoc({ content }: { content: Record<string, unknown> }) {
  const levels: Array<[string, string]> = [
    ['beginner', 'Beginner audience'],
    ['intermediate', 'Intermediate audience'],
    ['advanced', 'Advanced audience'],
  ]
  return (
    <div className="space-y-4">
      {levels.map(([key, label]) => {
        const ideas = Array.isArray(content[key]) ? content[key] as Array<Record<string, unknown>> : []
        return (
          <Section key={key} title={label}>
            <div className="space-y-2">
              {ideas.map((idea, i) => (
                <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
                  <p className="font-bold">{String(idea.idea ?? '')}</p>
                  <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Solves:</span> {String(idea.problem_it_solves ?? '')}</p>
                  <p className="text-[10px] text-muted mt-1 uppercase tracking-wider">{String(idea.format ?? '')}</p>
                </div>
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

function WinnersDoc({ content }: { content: Record<string, unknown> }) {
  const breakdown = Array.isArray(content.post_breakdown) ? content.post_breakdown as Array<Record<string, unknown>> : []
  return (
    <div className="space-y-4">
      <Section title="Repeatable formula">
        <p className="font-bold">{String(content.repeatable_formula ?? '')}</p>
      </Section>
      <Section title="Winning patterns"><BulletList items={Array.isArray(content.winning_patterns) ? content.winning_patterns : []} /></Section>
      <Section title="Losing patterns"><BulletList items={Array.isArray(content.losing_patterns) ? content.losing_patterns : []} /></Section>
      <Section title="Specific improvements"><BulletList items={Array.isArray(content.specific_improvements) ? content.specific_improvements : []} /></Section>
      <Section title="Post-by-post breakdown">
        <div className="space-y-2">
          {breakdown.map((p, i) => (
            <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text flex-1">{String(p.post ?? '')}</p>
                <span className={`text-[9px] uppercase tracking-wider font-bold shrink-0 ${String(p.verdict) === 'strong' ? 'text-stage-done' : 'text-urgent'}`}>
                  {String(p.verdict ?? '')}
                </span>
              </div>
              <p className="text-xs text-muted mt-1">{String(p.why ?? '')}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function PostDoc({ content }: { content: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <Section title="Hook"><p className="font-bold text-base">{String(content.hook ?? '')}</p></Section>
      <Section title="Body"><p className="whitespace-pre-wrap">{String(content.body ?? '')}</p></Section>
      <Section title="CTA"><p>{String(content.cta ?? '')}</p></Section>
      <Section title="Why it stops the scroll"><p className="text-muted">{String(content.why_it_stops_the_scroll ?? '')}</p></Section>
    </div>
  )
}

function MonetizationDoc({ content }: { content: Record<string, unknown> }) {
  const offers = Array.isArray(content.offer_ideas) ? content.offer_ideas as Array<Record<string, unknown>> : []
  const stages = Array.isArray(content.funnel_stages) ? content.funnel_stages as Array<Record<string, unknown>> : []
  return (
    <div className="space-y-4">
      <Section title="Offer ideas">
        <div className="space-y-2">
          {offers.map((o, i) => (
            <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
              <p className="font-bold">{String(o.name ?? '')}</p>
              <p className="text-xs text-muted mt-1">{String(o.description ?? '')}</p>
              <p className="text-xs text-muted mt-1 italic">Fit: {String(o.audience_fit ?? '')}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Pricing structure"><p>{String(content.pricing_structure ?? '')}</p></Section>
      <Section title="Content angles that convert"><BulletList items={Array.isArray(content.content_angles_that_convert) ? content.content_angles_that_convert : []} /></Section>
      <Section title="Funnel stages">
        <div className="space-y-2">
          {stages.map((s, i) => (
            <div key={i} className="rounded-lg bg-ink/30 border border-line p-2">
              <p className="font-bold">{i + 1}. {String(s.stage ?? '')}</p>
              <p className="text-xs text-muted mt-1"><span className="uppercase text-[10px] tracking-wider">Goal:</span> {String(s.goal ?? '')}</p>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Content examples</p>
                <BulletList items={Array.isArray(s.content_examples) ? s.content_examples : []} />
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}
