// Episode-level "Daily social plan" panel. Each kind has its own workflow:
//
//   Text posts    : AI ships ~10 options. Producer hits ✓ to select the
//                   ones to use, then ⬇ downloads them as a plain-text
//                   file ready to paste into a scheduler.
//   Story concepts: AI ships ~4 concepts, each tagged video or photo.
//                   Video-medium auto-routes to the video editor, photo
//                   to the photo person (Ana). The assignee picks it up.
//   Reel concepts : AI ships ~3 concepts. Auto-assigned to the video
//                   editor. They cut the clip from the episode.
//   Photo concepts: AI ships ~3 concepts. Auto-assigned to Ana. She
//                   produces the photo.
import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { api, type ApiMember, type ApiSocialItem, type ApiSocialPlan, type SocialItemStatus } from '../api'
import { renderTextPostCanvas, canvasToBlob, safeFilename } from '../lib/textPostImage'

const STATUS_LABEL: Record<SocialItemStatus, string> = {
  idea: 'Idea',
  drafted: 'Drafted',
  selected: 'Selected',
  rejected: 'Rejected',
  scheduled: 'Scheduled',
  posted: 'Posted',
}

const STATUS_PIPELINE: Record<ApiSocialItem['kind'], SocialItemStatus[]> = {
  text_post: ['drafted', 'selected', 'rejected', 'scheduled', 'posted'],
  story_concept: ['idea', 'drafted', 'scheduled', 'posted'],
  reel_concept: ['idea', 'drafted', 'scheduled', 'posted'],
  photo_concept: ['idea', 'drafted', 'scheduled', 'posted'],
}

export default function SocialsSection({
  projectId,
  songId,
  canWrite,
  members,
  showName,
}: {
  projectId: string
  songId: string
  canWrite: boolean
  members: ApiMember[]
  // Used to brand the rendered text-post images (top label).
  showName: string
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
            AI options for text posts plus concepts for stories, reels, and photos. Each item routes to the right person.
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
            <PlanCard key={p.id} plan={p} canWrite={canWrite} members={members} showName={showName} onChanged={load} onDelete={() => void remove(p.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function PlanCard({
  plan,
  canWrite,
  members,
  showName,
  onChanged,
  onDelete,
}: {
  plan: ApiSocialPlan
  canWrite: boolean
  members: ApiMember[]
  showName: string
  onChanged: () => void | Promise<void>
  onDelete: () => void
}) {
  const statusColor =
    plan.status === 'generated' ? 'text-stage-stems' :
    plan.status === 'failed' ? 'text-urgent' :
    'text-stage-mastering'

  const buckets: Record<ApiSocialItem['kind'], ApiSocialItem[]> = {
    text_post: [],
    story_concept: [],
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
        <div className="space-y-4">
          {buckets.text_post.length > 0 && (
            <TextPostsBucket planId={plan.id} items={buckets.text_post} canWrite={canWrite} showName={showName} onChanged={onChanged} />
          )}
          {buckets.story_concept.length > 0 && (
            <ConceptBucket label="💬 Stories" items={buckets.story_concept} planId={plan.id}
              canWrite={canWrite} members={members} onChanged={onChanged}
              renderItem={(item) => item.kind === 'story_concept' ? <StoryBody item={item} /> : null} />
          )}
          {buckets.reel_concept.length > 0 && (
            <ConceptBucket label="🎬 Reels" items={buckets.reel_concept} planId={plan.id}
              canWrite={canWrite} members={members} onChanged={onChanged}
              renderItem={(item) => item.kind === 'reel_concept' ? <ReelBody item={item} /> : null} />
          )}
          {buckets.photo_concept.length > 0 && (
            <ConceptBucket label="📷 Photos" items={buckets.photo_concept} planId={plan.id}
              canWrite={canWrite} members={members} onChanged={onChanged}
              renderItem={(item) => item.kind === 'photo_concept' ? <PhotoBody item={item} /> : null} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Text posts ----------

function TextPostsBucket({
  planId,
  items,
  canWrite,
  showName,
  onChanged,
}: {
  planId: string
  items: ApiSocialItem[]
  canWrite: boolean
  showName: string
  onChanged: () => void | Promise<void>
}) {
  const selected = items.filter((i): i is Extract<ApiSocialItem, { kind: 'text_post' }> =>
    i.kind === 'text_post' && (i.status === 'selected' || i.status === 'scheduled' || i.status === 'posted'),
  )
  const [zipping, setZipping] = useState(false)

  async function setStatus(itemId: string, next: SocialItemStatus) {
    await api.updateSocialItem(planId, itemId, { status: next })
    await onChanged()
  }
  async function setText(itemId: string, text: string) {
    await api.updateSocialItem(planId, itemId, { text })
    await onChanged()
  }

  // Bulk-download the selected (or all) text posts as a ZIP of full-size PNGs.
  // Renders each post fresh from the latest text so edits land in the file.
  async function downloadZip() {
    setZipping(true)
    try {
      const textItems = items.filter((i): i is Extract<ApiSocialItem, { kind: 'text_post' }> => i.kind === 'text_post')
      const toExport = selected.length > 0 ? selected : textItems
      if (toExport.length === 0) return
      const zip = new JSZip()
      for (let i = 0; i < toExport.length; i++) {
        const post = toExport[i]
        const canvas = renderTextPostCanvas({ text: post.text, showName }, { fullSize: true })
        const blob = await canvasToBlob(canvas)
        const safe = safeFilename(post.text.slice(0, 40))
        const idx = String(i + 1).padStart(2, '0')
        zip.file(`${idx}-${safe}.png`, blob)
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeFilename(showName)}-text-posts.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">
          📝 Text posts ({items.length} options · {selected.length} selected)
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => void downloadZip()}
            disabled={zipping || items.length === 0}
            className="text-[10px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-2.5 py-1 hover:bg-stage-stems/10 disabled:opacity-50"
            title={selected.length > 0 ? `Download ${selected.length} selected as ZIP of PNGs` : 'Download all as ZIP of PNGs'}
          >
            {zipping ? 'Zipping…' : `⬇ ${selected.length > 0 ? `Download selected PNGs (${selected.length})` : 'Download all PNGs'}`}
          </button>
          <a
            href={api.socialTextPostsTxtUrl(planId)}
            className="text-[10px] uppercase tracking-wider font-bold text-muted border border-line rounded-full px-2.5 py-1 hover:text-text hover:border-line/80"
            title="Plain text fallback"
          >
            .txt
          </a>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          if (item.kind !== 'text_post') return null
          const isSelected = item.status === 'selected' || item.status === 'scheduled' || item.status === 'posted'
          const isRejected = item.status === 'rejected'
          return (
            <TextPostCard
              key={item.id}
              item={item}
              canWrite={canWrite}
              showName={showName}
              isSelected={isSelected}
              isRejected={isRejected}
              onStatus={(s) => void setStatus(item.id, s)}
              onText={(t) => void setText(item.id, t)}
            />
          )
        })}
      </div>
    </div>
  )
}

function TextPostCard({
  item,
  canWrite,
  showName,
  isSelected,
  isRejected,
  onStatus,
  onText,
}: {
  item: Extract<ApiSocialItem, { kind: 'text_post' }>
  canWrite: boolean
  showName: string
  isSelected: boolean
  isRejected: boolean
  onStatus: (next: SocialItemStatus) => void
  onText: (next: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Re-render the canvas any time the text or show name changes so the
  // preview always reflects what's been edited.
  useEffect(() => {
    if (!canvasRef.current) return
    const fresh = renderTextPostCanvas({ text: item.text, showName }, { fullSize: false })
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    canvasRef.current.width = fresh.width
    canvasRef.current.height = fresh.height
    ctx.drawImage(fresh, 0, 0)
  }, [item.text, showName])

  async function downloadOne() {
    const canvas = renderTextPostCanvas({ text: item.text, showName }, { fullSize: true })
    const blob = await canvasToBlob(canvas)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFilename(item.text.slice(0, 40))}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className={`rounded-xl border p-2.5 space-y-2 transition ${
        isSelected ? 'border-stage-stems/60 bg-stage-stems/5' :
        isRejected ? 'border-line/30 bg-ink/10 opacity-50' :
        'border-line/60 bg-panel/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <StatusPill status={item.status} kind="text_post" canWrite={canWrite} onChange={onStatus} />
        {canWrite && (
          <div className="flex items-center gap-1.5">
            {!isSelected && (
              <button
                onClick={() => onStatus('selected')}
                className="text-[10px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-2.5 py-0.5 hover:bg-stage-stems/10"
              >
                ✓ Select
              </button>
            )}
            {!isRejected && (
              <button
                onClick={() => onStatus('rejected')}
                className="text-[10px] uppercase tracking-wider font-bold text-muted border border-line rounded-full px-2.5 py-0.5 hover:text-urgent hover:border-urgent/40"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Live IG-portrait preview */}
      <div className="flex justify-center bg-ink/40 rounded-lg p-2">
        <canvas ref={canvasRef} className="max-w-full h-auto rounded shadow-md" />
      </div>

      {/* Edit copy + per-post PNG download */}
      <textarea
        value={item.text}
        disabled={!canWrite}
        onChange={(e) => onText(e.target.value)}
        rows={3}
        placeholder="Caption text"
        className="w-full bg-transparent text-xs leading-snug outline-none border border-transparent focus:border-stage-mastering/40 rounded p-1 resize-y disabled:opacity-70"
      />
      <div className="flex items-center justify-end">
        <button
          onClick={() => void downloadOne()}
          className="text-[10px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-2.5 py-0.5 hover:bg-stage-mastering/10"
        >
          ⬇ PNG
        </button>
      </div>
    </div>
  )
}

// ---------- Concept buckets (stories / reels / photos) ----------

function ConceptBucket({
  label,
  items,
  planId,
  canWrite,
  members,
  onChanged,
  renderItem,
}: {
  label: string
  items: ApiSocialItem[]
  planId: string
  canWrite: boolean
  members: ApiMember[]
  onChanged: () => void | Promise<void>
  renderItem: (item: ApiSocialItem) => React.ReactNode
}) {
  async function save(itemId: string, patch: Record<string, unknown>) {
    await api.updateSocialItem(planId, itemId, patch)
    await onChanged()
  }
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">{label} ({items.length})</div>
      <div className="space-y-2">
        {items.map((item) => {
          if (item.kind === 'text_post') return null
          return (
            <div key={item.id} className="rounded-lg border border-line/60 bg-panel/40 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusPill status={item.status} kind={item.kind} canWrite={canWrite} onChange={(s) => void save(item.id, { status: s })} />
                  {item.kind === 'story_concept' && (
                    <MediumPill medium={item.medium} canWrite={canWrite} onChange={(m) => void save(item.id, { medium: m })} />
                  )}
                  <AssigneePill
                    assigneeId={item.assignee_user_id}
                    members={members}
                    canWrite={canWrite}
                    onChange={(v) => void save(item.id, { assignee_user_id: v })}
                  />
                </div>
              </div>
              {renderItem(item)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StoryBody({ item }: { item: Extract<ApiSocialItem, { kind: 'story_concept' }> }) {
  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted/70">Concept</div>
        <div className="text-sm">{item.description}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted/70">Overlay caption</div>
        <div className="text-sm italic">{item.caption}</div>
      </div>
      {item.medium === 'video' && item.suggested_clip && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted/70">Suggested clip</div>
          <div className="text-xs italic">{item.suggested_clip}</div>
        </div>
      )}
      {item.medium === 'photo' && item.image_direction && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted/70">Image direction</div>
          <div className="text-xs italic">{item.image_direction}</div>
        </div>
      )}
    </div>
  )
}

function ReelBody({ item }: { item: Extract<ApiSocialItem, { kind: 'reel_concept' }> }) {
  return (
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
  )
}

function PhotoBody({ item }: { item: Extract<ApiSocialItem, { kind: 'photo_concept' }> }) {
  return (
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
  )
}

// ---------- Pills ----------

function StatusPill({
  status,
  kind,
  canWrite,
  onChange,
}: {
  status: SocialItemStatus
  kind: ApiSocialItem['kind']
  canWrite: boolean
  onChange: (next: SocialItemStatus) => void
}) {
  const styles: Record<SocialItemStatus, string> = {
    idea: 'text-muted border-line bg-ink/20',
    drafted: 'text-stage-mastering border-stage-mastering/40 bg-stage-mastering/10',
    selected: 'text-stage-stems border-stage-stems/40 bg-stage-stems/10',
    rejected: 'text-urgent border-urgent/40 bg-urgent/10',
    scheduled: 'text-stage-tracking border-stage-tracking/40 bg-stage-tracking/10',
    posted: 'text-stage-mixing border-stage-mixing/40 bg-stage-mixing/10',
  }
  const options = STATUS_PIPELINE[kind]
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
      onChange={(e) => onChange(e.target.value as SocialItemStatus)}
      className={`text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border outline-none ${styles[status]}`}
    >
      {options.map((s) => (
        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
      ))}
    </select>
  )
}

function MediumPill({
  medium,
  canWrite,
  onChange,
}: {
  medium: 'video' | 'photo'
  canWrite: boolean
  onChange: (next: 'video' | 'photo') => void
}) {
  const styles = medium === 'video'
    ? 'text-stage-tracking border-stage-tracking/40 bg-stage-tracking/10'
    : 'text-stage-mastering border-stage-mastering/40 bg-stage-mastering/10'
  const emoji = medium === 'video' ? '🎬' : '📷'
  if (!canWrite) {
    return (
      <span className={`text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border ${styles}`}>
        {emoji} {medium}
      </span>
    )
  }
  return (
    <select
      value={medium}
      onChange={(e) => onChange(e.target.value as 'video' | 'photo')}
      className={`text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border outline-none ${styles}`}
      title="Medium — changing this re-routes the item"
    >
      <option value="video">🎬 Video</option>
      <option value="photo">📷 Photo</option>
    </select>
  )
}

function AssigneePill({
  assigneeId,
  members,
  canWrite,
  onChange,
}: {
  assigneeId: string | null
  members: ApiMember[]
  canWrite: boolean
  onChange: (next: string | null) => void
}) {
  const current = members.find((m) => m.id === assigneeId)
  const label = current ? (current.display_name || current.name) : 'Unassigned'
  if (!canWrite) {
    return (
      <span className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border border-line bg-ink/20 text-muted">
        👤 {label}
      </span>
    )
  }
  return (
    <select
      value={assigneeId ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border border-line bg-ink/20 text-text outline-none"
      title="Assigned to"
    >
      <option value="">👤 Unassigned</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>👤 {m.display_name || m.name}</option>
      ))}
    </select>
  )
}
