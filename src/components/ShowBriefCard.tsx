// Show Brief — the questionnaire the operator fills out once per show.
// Every social strategy tool reads from this automatically, so the
// answers are captured here and never re-typed. Editable at any time.
import { useEffect, useState } from 'react'
import { api, type ApiShowBrief } from '../api'

type Field = {
  key: keyof ApiShowBrief
  label: string
  hint: string
  placeholder: string
  rows: number
}

// The order matters — this is the sequence a strategist would ask
// them, and downstream tools reference the answers in this order too.
const FIELDS: Field[] = [
  {
    key: 'business_description',
    label: 'What does the show actually do? (business + origin story)',
    hint: 'Be concrete. What kind of show, who runs it, how it makes money today. One paragraph.',
    placeholder: 'e.g. Soul & Science is an interview podcast with marketing executives about the intersection of intuition and data in modern brand building. Hosted by Jason Harris. Currently ad-supported with a mid-roll and a pre-roll per episode…',
    rows: 4,
  },
  {
    key: 'niche',
    label: 'What niche does this show occupy?',
    hint: 'Not "podcasts" — the specific corner. Compare vs. an adjacent show that\'s NOT you.',
    placeholder: 'e.g. Business podcasts for marketing execs who came up on TV and are trying to figure out streaming — not a startup podcast, not a general business podcast.',
    rows: 3,
  },
  {
    key: 'target_audience',
    label: 'Who is the show for?',
    hint: 'Describe them the way a strategist would — occupation, life stage, aspiration, pain.',
    placeholder: 'e.g. VP/C-level marketers at Fortune 1000s, 40–55, who are being asked to prove ROI on brand work in a performance-obsessed org. They read Ad Age. They\'re tired of being told AI will replace them…',
    rows: 4,
  },
  {
    key: 'competitors',
    label: 'Named competitors',
    hint: 'The shows / creators your target audience ALSO listens to. Comma or newline separated.',
    placeholder: 'e.g. Marketing Against The Grain, The Marketing Book Podcast, HBR Ideacast, How I Built This',
    rows: 3,
  },
  {
    key: 'growth_goals',
    label: 'What does winning look like over the next 12 months?',
    hint: 'Specific targets beat "grow the audience." Downloads, followers, revenue, industry recognition.',
    placeholder: 'e.g. 500k downloads/month, 50k IG followers, one Adweek "must-listen" mention, $250k in ad revenue.',
    rows: 3,
  },
  {
    key: 'current_metrics',
    label: 'Where is the show today?',
    hint: 'Numbers, platforms, engagement. Anything a strategist would ask up front.',
    placeholder: 'e.g. 180k avg downloads/ep, 12k IG followers, Spotify + Apple leading, avg IG post engagement ~2.4%. Best format historically: carousel quotes. Underperforming: talking-head reels.',
    rows: 4,
  },
  {
    key: 'monetization_current',
    label: 'How does the show make money today?',
    hint: 'Ads, sponsors, subscriptions, consulting funnel, speaking, courses — whatever\'s real.',
    placeholder: 'e.g. 2 ad reads per episode (pre + mid), $22 CPM. No paid tier. Host runs a consulting practice off the back of the show — every episode drives 1–2 inbound leads.',
    rows: 3,
  },
  {
    key: 'constraints',
    label: 'Constraints a strategy has to respect',
    hint: 'Team size, legal, sponsor conflicts, publishing cadence, brand pressure.',
    placeholder: 'e.g. Team of 3 (host + producer + editor). Weekly release Tuesdays. Can\'t do brand comparisons that name-check the host\'s current consulting clients. IG only — not on TikTok yet.',
    rows: 3,
  },
  {
    key: 'notes',
    label: 'Anything else worth telling a strategist',
    hint: 'Freeform. Historical context, past experiments, wins, failures.',
    placeholder: 'e.g. We tried a video-first pivot in Q1 and downloads dropped 20% — we reverted. Weekly newsletter that has strong engagement but zero conversion to podcast listens.',
    rows: 3,
  },
]

export default function ShowBriefCard({
  projectId, canWrite,
}: {
  projectId: string
  canWrite: boolean
}) {
  const [brief, setBrief] = useState<ApiShowBrief>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    api.showBrief(projectId).then((r) => {
      if (cancelled) return
      const b = r.brief ?? {}
      setBrief(b)
      // Collapsed by default IF at least one field is filled; expanded
      // when the brief is fresh so a new show gets prompted to fill it.
      const anyFilled = Object.values(b).some((v) => typeof v === 'string' && v.trim())
      setExpanded(!anyFilled)
      setLoading(false)
    }).catch((err) => {
      if (!cancelled) { setError(err instanceof Error ? err.message : 'failed'); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [projectId])

  async function save(next: ApiShowBrief) {
    setSaving(true)
    setError(null)
    try {
      await api.saveShowBrief(projectId, next)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  const filledCount = Object.values(brief).filter((v) => typeof v === 'string' && v.trim()).length
  const totalCount = FIELDS.length

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📋 Show Brief</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-2xl">
            Answered once, read by every strategy tool. Fill it out and Claude will start from these facts every
            time you generate a strategy, pillar list, carousel, or daily plan. Edit anytime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {filledCount} / {totalCount} filled
          </span>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-2.5 py-1 hover:bg-stage-mastering/10 font-bold"
          >
            {expanded ? '▾ Collapse' : '▸ Expand'}
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-muted italic">Loading…</p>}
      {error && <p className="text-urgent text-xs">{error}</p>}

      {!loading && expanded && (
        <div className="space-y-4 pt-2">
          {FIELDS.map((field) => (
            <BriefField
              key={field.key}
              field={field}
              value={brief[field.key] ?? ''}
              disabled={!canWrite}
              onChange={(next) => setBrief((b) => ({ ...b, [field.key]: next }))}
              onBlur={() => { if (canWrite) void save(brief) }}
            />
          ))}
          <div className="flex items-center gap-2 pt-1 text-[10px] text-muted">
            {saving
              ? <span className="text-stage-mastering">Saving…</span>
              : savedAt
                ? <span>✓ Saved {new Date(savedAt).toLocaleTimeString()}</span>
                : <span className="italic">Changes save automatically when you tab out of a field.</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function BriefField({
  field, value, disabled, onChange, onBlur,
}: {
  field: Field
  value: string
  disabled: boolean
  onChange: (v: string) => void
  onBlur: () => void
}) {
  return (
    <label className="block space-y-1">
      <div>
        <span className="text-xs font-bold text-text">{field.label}</span>
        <p className="text-[10px] text-muted/70 mt-0.5">{field.hint}</p>
      </div>
      <textarea
        rows={field.rows}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full bg-ink/40 border border-line rounded p-2 text-xs text-text leading-relaxed focus:border-stage-mastering outline-none disabled:opacity-70"
        placeholder={field.placeholder}
      />
    </label>
  )
}
