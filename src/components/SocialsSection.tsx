// Episode-level "Daily social plan" panel. Generates a full day's social
// content (text posts + stories + reel + photo concepts) from the
// episode's transcript via Claude API.
import { useEffect, useState } from 'react'
import { api, type ApiSocialItem, type ApiSocialPlan } from '../api'

const KIND_LABEL: Record<ApiSocialItem['kind'], string> = {
  text_post: '📝 Text post',
  story_text: '💬 Story',
  reel_concept: '🎬 Reel',
  photo_concept: '📷 Photo',
}

const STATUS_LABEL: Record<ApiSocialItem['status'], string> = {
  idea: 'Idea',
  drafted: 'Drafted',
  scheduled: 'Scheduled',
  posted: 'Posted',
}

export default function SocialsSection({
  projectId,
  songId,
  canWrite,
}: {
  projectId: string
  songId: string
  canWrite: boolean
}) {
  const [plans, setPlans] = useState<ApiSocialPlan[] | null>(null)
  const [hasDoneTranscript, setHasDoneTranscript] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  async function load() {
    try {
      const [plansRes, transcriptsRes] = await Promise.all([
        api.socialPlans(songId),
        api.transcripts(projectId).catch(() => ({ transcripts: [] })),
      ])
      setPlans(plansRes.plans)
      setHasDoneTranscript(transcriptsRes.transcripts.some((t) => t.songId === songId && t.status === 'done'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [songId, projectId])

  // Poll every 4s while any plan is still generating
  useEffect(() => {
    if (!plans) return
    const inflight = plans.some((p) => p.status === 'generating')
    if (!inflight) return
    const id = setInterval(() => void load(), 4000)
    return () => clearInterval(id)
  }, [plans])

  async function generate() {
    setStarting(true)
    setError(null)
    try {
      await api.generateSocialPlan(songId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to start')
    } finally {
      setStarting(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this social plan?')) return
    try {
      await api.deleteSocialPlan(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📱 Daily Social Plan</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            AI-drafted text posts and stories + reel and photo concepts, pulled from this episode's transcript.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => void generate()}
            disabled={starting || !hasDoneTranscript}
            title={hasDoneTranscript ? 'Generate a fresh plan from this episode' : 'Transcribe the episode first'}
            className="rounded-xl bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
          >
            {starting ? 'Starting…' : (plans && plans.length > 0 ? '↻ Generate new plan' : '✨ Generate plan')}
          </button>
        )}
      </div>

      {hasDoneTranscript === false && (
        <p className="text-[11px] text-muted/70 italic">
          Add a transcript above first. The social plan needs the episode's words to write copy in the show's voice.
        </p>
      )}

      {error && <p className="text-urgent text-sm">{error}</p>}

      {plans === null ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-muted/70 text-sm italic py-4 text-center border border-dashed border-line/60 rounded-xl">
          {hasDoneTranscript
            ? (canWrite ? 'No plan yet. Tap ✨ to generate one.' : 'No plan yet.')
            : 'Plan will appear here once you have a transcript.'}
        </p>
      ) : (
        <div className="space-y-4">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} canWrite={canWrite} onChanged={load} onDelete={() => void remove(p.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function PlanCard({
  plan,
  canWrite,
  onChanged,
  onDelete,
}: {
  plan: ApiSocialPlan
  canWrite: boolean
  onChanged: () => void | Promise<void>
  onDelete: () => void
}) {
  const statusColor =
    plan.status === 'generated' ? 'text-stage-stems' :
    plan.status === 'failed' ? 'text-urgent' :
    'text-stage-mastering'

  // Bucket items by kind for display
  const buckets: Record<ApiSocialItem['kind'], ApiSocialItem[]> = {
    text_post: [],
    story_text: [],
    reel_concept: [],
    photo_concept: [],
  }
  for (const it of plan.items) buckets[it.kind].push(it)

  return (
    <div className="rounded-xl border border-line bg-ink/30 p-3 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-[10px] uppercase tracking-wider font-bold ${statusColor}`}>
          {plan.status === 'generating' ? 'Generating…' : plan.status}
        </span>
        <span className="text-[11px] text-muted">{new Date(plan.createdAt).toLocaleString()}</span>
        {plan.status === 'generated' && (
          <span className="text-[11px] text-muted">{plan.items.length} items</span>
        )}
        {canWrite && plan.status !== 'generating' && (
          <button onClick={onDelete} className="ml-auto text-[11px] text-muted hover:text-urgent border border-line rounded-full px-2 py-0.5">
            ✕
          </button>
        )}
      </div>
      {plan.error && <p className="text-urgent text-xs">{plan.error}</p>}

      {plan.status === 'generated' && (
        <div className="space-y-3">
          {(['text_post', 'story_text', 'reel_concept', 'photo_concept'] as const).map((kind) => (
            buckets[kind].length > 0 && (
              <div key={kind} className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">{KIND_LABEL[kind]} ({buckets[kind].length})</div>
                <div className="space-y-2">
                  {buckets[kind].map((item) => (
                    <ItemCard key={item.id} planId={plan.id} item={item} canWrite={canWrite} onChanged={onChanged} />
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}

function ItemCard({
  planId,
  item,
  canWrite,
  onChanged,
}: {
  planId: string
  item: ApiSocialItem
  canWrite: boolean
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function save(patch: Record<string, unknown>) {
    setBusy(true)
    try {
      await api.updateSocialItem(planId, item.id, patch)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line/60 bg-panel/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <StatusPill status={item.status} canWrite={canWrite} onChange={(s) => void save({ status: s })} />
        {busy && <span className="text-[10px] text-muted">saving…</span>}
      </div>
      {(item.kind === 'text_post' || item.kind === 'story_text') && (
        <textarea
          value={item.text}
          disabled={!canWrite}
          onChange={(e) => void save({ text: e.target.value })}
          rows={2}
          className="w-full bg-transparent text-sm leading-snug outline-none border border-transparent focus:border-stage-mastering/40 rounded p-1 resize-y disabled:opacity-70"
        />
      )}
      {item.kind === 'reel_concept' && (
        <div className="space-y-1.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70">Hook</div>
            <div className="text-sm font-bold">{item.hook}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70">Talking points</div>
            <ul className="text-xs list-disc pl-4 space-y-0.5">
              {item.talking_points.map((tp, i) => <li key={i}>{tp}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70">Suggested clip</div>
            <div className="text-xs italic">{item.suggested_clip}</div>
          </div>
        </div>
      )}
      {item.kind === 'photo_concept' && (
        <div className="space-y-1.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70">Image direction</div>
            <div className="text-sm">{item.image_direction}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted/70">Caption</div>
            <div className="text-sm italic">{item.caption}</div>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted/70">
            Vibe: <span className="text-text font-bold">{item.vibe}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({
  status,
  canWrite,
  onChange,
}: {
  status: ApiSocialItem['status']
  canWrite: boolean
  onChange: (next: ApiSocialItem['status']) => void
}) {
  const styles: Record<ApiSocialItem['status'], string> = {
    idea: 'text-muted border-line bg-ink/20',
    drafted: 'text-stage-mastering border-stage-mastering/40 bg-stage-mastering/10',
    scheduled: 'text-stage-tracking border-stage-tracking/40 bg-stage-tracking/10',
    posted: 'text-stage-stems border-stage-stems/40 bg-stage-stems/10',
  }
  if (!canWrite) {
    return (
      <span className={`text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border ${styles[status]}`}>
        {STATUS_LABEL[status]}
      </span>
    )
  }
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as ApiSocialItem['status'])}
      className={`text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border outline-none ${styles[status]}`}
    >
      {(['idea', 'drafted', 'scheduled', 'posted'] as const).map((s) => (
        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
      ))}
    </select>
  )
}
