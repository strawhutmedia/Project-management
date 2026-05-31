// Social content scheduler.
//
// 7-day grid (week navigator) where each day column has four buckets
// (Text / Photos / Reels / Stories), each bucket containing a fixed set
// of slots stamped with a default Pacific time. A right-rail backlog
// lists every item that's been pushed from an episode but not yet
// placed on a slot. Drag items from backlog → slot, slot → slot, or
// slot → backlog. Times are editable per-slot.
//
// No auto-posting — this is a plan SAJ (our social manager) reads and
// posts manually. IG + FB are the only platforms wired right now.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type ApiProject,
  type ApiSchedulerDay,
  type ApiSchedulerItem,
  type ApiSchedulerResponse,
  type ApiSchedulerSlot,
  type ApiSocialItem,
  type SchedulerSlotKind,
} from '../api'
import { useAuth } from '../auth'
import { Link } from 'react-router-dom'
import { KIND_STYLES, POSTED_STYLE, POSTED_LABEL_TEXT } from '../lib/kindStyles'

const KIND_ORDER: SchedulerSlotKind[] = ['text_post', 'photo_concept', 'reel_concept', 'story_concept']

// Local date helpers — operate in PT-ish wall-clock terms so the week
// view aligns with the timezone the team actually posts in. We use
// Intl to format Pacific dates, then string-compare YYYY-MM-DD.
function pacificToday(): string {
  const d = new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function formatDayHeader(dateStr: string): { weekday: string; date: string; isToday: boolean } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(dt)
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(dt)
  return { weekday, date, isToday: dateStr === pacificToday() }
}

function format12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}

function itemBlurb(item: ApiSocialItem): string {
  switch (item.kind) {
    case 'text_post': return item.text || item.ai_text || ''
    case 'story_concept': return item.description
    case 'reel_concept': return item.hook
    case 'photo_concept': return item.image_direction
  }
}

export default function SchedulerPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [weekStart, setWeekStart] = useState<string>(pacificToday())
  const [data, setData] = useState<ApiSchedulerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busySlotId, setBusySlotId] = useState<string | null>(null)
  const [showFilter, setShowFilter] = useState<string>('all')
  const [composeOpen, setComposeOpen] = useState(false)
  const [projects, setProjects] = useState<ApiProject[] | null>(null)

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  useEffect(() => {
    void api.projects().then((res) => setProjects(res.projects)).catch(() => setProjects([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.scheduler(weekStart, weekEnd)
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd])

  useEffect(() => { void load() }, [load])

  async function assignSlot(slotId: string, from: ApiSchedulerItem) {
    if (!isAdmin) { setError('Only super admins can move scheduler items.'); return }
    setBusySlotId(slotId)
    try {
      await api.updateSchedulerSlot(slotId, { planId: from.planId, itemId: from.itemId })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusySlotId(null)
    }
  }

  async function clearSlot(slotId: string) {
    if (!isAdmin) return
    setBusySlotId(slotId)
    try {
      await api.updateSchedulerSlot(slotId, { planId: null, itemId: null })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusySlotId(null)
    }
  }

  async function changeTime(slotId: string, scheduledTime: string) {
    if (!isAdmin) return
    setBusySlotId(slotId)
    try {
      await api.updateSchedulerSlot(slotId, { scheduledTime })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusySlotId(null)
    }
  }

  async function togglePosted(slotId: string, nextPosted: boolean) {
    if (!isAdmin) return
    setBusySlotId(slotId)
    try {
      await api.updateSchedulerSlot(slotId, { status: nextPosted ? 'posted' : 'planned' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusySlotId(null)
    }
  }

  async function unpush(item: ApiSchedulerItem) {
    if (!confirm('Remove this item from the scheduler entirely?')) return
    try {
      await api.unpushFromScheduler(item.planId, item.itemId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  const shows = useMemo(() => {
    if (!data) return [] as Array<{ id: string; name: string }>
    const map = new Map<string, string>()
    for (const it of data.backlog) map.set(it.projectId, it.projectName)
    for (const day of data.days) {
      for (const slot of day.slots) {
        if (slot.item) map.set(slot.item.projectId, slot.item.projectName)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const filteredBacklog = useMemo(() => {
    if (!data) return [] as ApiSchedulerItem[]
    return data.backlog.filter((it) => showFilter === 'all' || it.projectId === showFilter)
  }, [data, showFilter])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Link to="/" className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold">
            ← Home
          </Link>
          <h1 className="font-display text-4xl mt-2 text-rainbow">SCHEDULER</h1>
          <p className="text-muted text-sm mt-1">
            Drag content from the backlog into a day. SAJ uses this plan to post on IG + FB.
            <span className="text-muted/60"> All times Pacific.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted hover:text-text"
          >
            ← Prev week
          </button>
          <button
            onClick={() => setWeekStart(pacificToday())}
            className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-3 py-1.5"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted hover:text-text"
          >
            Next week →
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Week grid */}
        <div className="rounded-2xl border border-line bg-panel/40 overflow-hidden">
          {loading && !data ? (
            <div className="p-10 text-center text-muted text-sm">Loading week…</div>
          ) : data ? (
            <div className="grid grid-cols-7 divide-x divide-line/60 min-h-[600px]">
              {data.days.map((day) => (
                <DayColumn
                  key={day.date}
                  day={day}
                  isAdmin={isAdmin}
                  busySlotId={busySlotId}
                  onAssign={assignSlot}
                  onClear={clearSlot}
                  onTimeChange={changeTime}
                  onTogglePosted={togglePosted}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* Backlog rail */}
        <BacklogRail
          items={filteredBacklog}
          shows={shows}
          showFilter={showFilter}
          onShowFilter={setShowFilter}
          loading={loading}
          isAdmin={isAdmin}
          onUnpush={unpush}
          onComposeOpen={() => setComposeOpen(true)}
        />
      </div>

      {composeOpen && projects && (
        <ComposeDialog
          projects={projects}
          defaultProjectId={showFilter !== 'all' ? showFilter : undefined}
          onClose={() => setComposeOpen(false)}
          onCreated={async () => { setComposeOpen(false); await load() }}
        />
      )}
    </div>
  )
}

function DayColumn({
  day,
  isAdmin,
  busySlotId,
  onAssign,
  onClear,
  onTimeChange,
  onTogglePosted,
}: {
  day: ApiSchedulerDay
  isAdmin: boolean
  busySlotId: string | null
  onAssign: (slotId: string, from: ApiSchedulerItem) => void
  onClear: (slotId: string) => void
  onTimeChange: (slotId: string, time: string) => void
  onTogglePosted: (slotId: string, nextPosted: boolean) => void
}) {
  const header = formatDayHeader(day.date)
  const buckets = KIND_ORDER.map((kind) => ({
    kind,
    slots: day.slots.filter((s) => s.kind === kind).sort((a, b) => a.index - b.index),
  }))
  return (
    <div className={`flex flex-col ${header.isToday ? 'bg-stage-mastering/[0.04]' : ''}`}>
      <div className={`p-2.5 border-b border-line/60 ${header.isToday ? 'bg-stage-mastering/10' : 'bg-ink/40'}`}>
        <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{header.weekday}</div>
        <div className={`text-sm font-bold ${header.isToday ? 'text-stage-mastering' : 'text-text'}`}>
          {header.date}
        </div>
      </div>
      <div className="flex-1 p-1.5 space-y-3">
        {buckets.map(({ kind, slots }) => (
          <div key={kind}>
            <div className={`text-[9px] uppercase tracking-wider font-bold px-1 mb-1 ${KIND_STYLES[kind].label_text}`}>
              {KIND_STYLES[kind].emoji} {KIND_STYLES[kind].shortLabel}
            </div>
            <div className="space-y-1">
              {slots.map((slot) => (
                <Slot
                  key={slot.id}
                  slot={slot}
                  isAdmin={isAdmin}
                  busy={busySlotId === slot.id}
                  onAssign={onAssign}
                  onClear={onClear}
                  onTimeChange={onTimeChange}
                  onTogglePosted={onTogglePosted}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slot({
  slot,
  isAdmin,
  busy,
  onAssign,
  onClear,
  onTimeChange,
  onTogglePosted,
}: {
  slot: ApiSchedulerSlot
  isAdmin: boolean
  busy: boolean
  onAssign: (slotId: string, from: ApiSchedulerItem) => void
  onClear: (slotId: string) => void
  onTimeChange: (slotId: string, time: string) => void
  onTogglePosted: (slotId: string, nextPosted: boolean) => void
}) {
  const kindStyle = KIND_STYLES[slot.kind]
  const isPosted = slot.status === 'posted'
  const [over, setOver] = useState(false)
  const [editingTime, setEditingTime] = useState(false)

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setOver(false)
    if (!isAdmin) return
    const json = e.dataTransfer.getData('application/x-slate-item')
    if (!json) return
    try {
      const payload = JSON.parse(json) as { planId: string; itemId: string; kind: SchedulerSlotKind }
      if (payload.kind !== slot.kind) return
      onAssign(slot.id, { ...payload } as unknown as ApiSchedulerItem)
    } catch {
      // ignore malformed
    }
  }

  function startDrag(e: React.DragEvent) {
    if (!slot.item) return
    e.dataTransfer.setData('application/x-slate-item', JSON.stringify({
      planId: slot.item.planId,
      itemId: slot.item.itemId,
      kind: slot.kind,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const filled = !!slot.item
  return (
    <div
      onDragOver={(e) => { if (isAdmin) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={[
        'rounded-md border text-[10px] transition relative group',
        isPosted
          ? POSTED_STYLE
          : filled
            ? kindStyle.filled
            : `border-dashed ${kindStyle.empty}`,
        over ? `ring-1 ${kindStyle.ring}` : '',
        busy ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-1.5 pt-1">
        {editingTime && isAdmin ? (
          <input
            type="time"
            defaultValue={slot.scheduledTime}
            autoFocus
            onBlur={(e) => { setEditingTime(false); if (e.target.value && e.target.value !== slot.scheduledTime) onTimeChange(slot.id, e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingTime(false) }}
            className="bg-transparent text-[10px] text-text border-b border-stage-mastering outline-none w-16"
          />
        ) : (
          <button
            onClick={() => isAdmin && setEditingTime(true)}
            disabled={!isAdmin}
            className={`text-[10px] font-mono cursor-pointer disabled:cursor-default ${isPosted ? POSTED_LABEL_TEXT : 'text-muted hover:text-stage-mastering'}`}
            title={isAdmin ? 'Click to change time' : 'PT time (read-only)'}
          >
            {format12h(slot.scheduledTime)}
          </button>
        )}
        {filled && isAdmin && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onTogglePosted(slot.id, !isPosted)}
              className={`text-[10px] transition ${
                isPosted
                  ? 'text-emerald-300 hover:text-emerald-200'
                  : 'text-muted/40 hover:text-emerald-300 opacity-0 group-hover:opacity-100'
              }`}
              title={isPosted ? 'Marked posted — click to mark planned' : 'Mark this slot as posted'}
            >
              {isPosted ? '✓' : '○'}
            </button>
            <button
              onClick={() => onClear(slot.id)}
              className="text-[10px] text-muted/50 hover:text-urgent opacity-0 group-hover:opacity-100"
              title="Remove from this slot (sends back to backlog)"
            >
              ✕
            </button>
          </div>
        )}
      </div>
      {slot.item ? (
        <div
          draggable={isAdmin}
          onDragStart={startDrag}
          className="px-1.5 pb-1.5 cursor-grab active:cursor-grabbing"
        >
          {slot.item.projectCoverArtUrl && (
            <div className="flex items-center gap-1 mt-0.5 mb-1">
              <img
                src={slot.item.projectCoverArtUrl}
                alt=""
                className="w-4 h-4 rounded shrink-0 border border-line/60"
              />
              <div className="text-[9px] text-muted truncate">{slot.item.projectName}</div>
            </div>
          )}
          <div className="text-[10px] text-text leading-tight line-clamp-3">
            {itemBlurb(slot.item.item) || <em className="text-muted/60">empty</em>}
          </div>
        </div>
      ) : (
        <div className="px-1.5 pb-1.5 text-[9px] text-muted/40 italic">empty</div>
      )}
    </div>
  )
}

function BacklogRail({
  items,
  shows,
  showFilter,
  onShowFilter,
  loading,
  isAdmin,
  onUnpush,
  onComposeOpen,
}: {
  items: ApiSchedulerItem[]
  shows: Array<{ id: string; name: string }>
  showFilter: string
  onShowFilter: (id: string) => void
  loading: boolean
  isAdmin: boolean
  onUnpush: (item: ApiSchedulerItem) => void
  onComposeOpen: () => void
}) {
  const grouped = useMemo(() => {
    const map: Record<SchedulerSlotKind, ApiSchedulerItem[]> = {
      text_post: [], photo_concept: [], reel_concept: [], story_concept: [],
    }
    for (const it of items) map[it.item.kind as SchedulerSlotKind].push(it)
    return map
  }, [items])

  return (
    <aside className="rounded-2xl border border-line bg-panel/40 p-4 lg:sticky lg:top-24 max-h-[calc(100vh-7rem)] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📥 Backlog</h2>
        <span className="text-[10px] text-muted">{items.length} queued</span>
      </div>
      <button
        onClick={onComposeOpen}
        className="w-full mb-3 rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[10px] px-3 py-2"
      >
        ✏️ Compose new post
      </button>
      {shows.length > 1 && (
        <select
          value={showFilter}
          onChange={(e) => onShowFilter(e.target.value)}
          className="w-full mb-3 rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-xs outline-none"
        >
          <option value="all">All shows</option>
          {shows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <div className="overflow-y-auto -mr-2 pr-2 flex-1 space-y-3">
        {loading && items.length === 0 ? (
          <p className="text-muted text-xs">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-muted text-xs">
            Nothing in the backlog. Push items from an episode's social plan to populate this list.
          </p>
        ) : (
          KIND_ORDER.map((kind) => {
            const group = grouped[kind]
            if (group.length === 0) return null
            return (
              <div key={kind}>
                <div className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${KIND_STYLES[kind].label_text}`}>
                  {KIND_STYLES[kind].label} ({group.length})
                </div>
                <div className="space-y-1.5">
                  {group.map((it) => (
                    <BacklogCard
                      key={`${it.planId}:${it.itemId}`}
                      item={it}
                      isAdmin={isAdmin}
                      onUnpush={onUnpush}
                    />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

function BacklogCard({
  item,
  isAdmin,
  onUnpush,
}: {
  item: ApiSchedulerItem
  isAdmin: boolean
  onUnpush: (item: ApiSchedulerItem) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const kindStyle = KIND_STYLES[item.item.kind as SchedulerSlotKind]
  function startDrag(e: React.DragEvent) {
    e.dataTransfer.setData('application/x-slate-item', JSON.stringify({
      planId: item.planId,
      itemId: item.itemId,
      kind: item.item.kind,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <div
      ref={ref}
      draggable={isAdmin}
      onDragStart={startDrag}
      className={`rounded-lg border p-2 text-[11px] ${kindStyle.filled} ${isAdmin ? 'cursor-grab active:cursor-grabbing hover:brightness-125' : ''} transition`}
      title={isAdmin ? 'Drag onto a day slot' : 'Read-only (admin can move)'}
    >
      <div className="flex items-center gap-2 mb-1">
        {item.projectCoverArtUrl && (
          <img src={item.projectCoverArtUrl} alt="" className="w-5 h-5 rounded shrink-0 border border-line/60" />
        )}
        <div className="text-[10px] text-muted truncate flex-1">{item.projectName}</div>
        {isAdmin && (
          <button
            onClick={() => onUnpush(item)}
            className="text-[10px] text-muted/50 hover:text-urgent"
            title="Remove from scheduler"
          >
            ✕
          </button>
        )}
      </div>
      <div className="text-[11px] text-text leading-snug line-clamp-4">
        {itemBlurb(item.item)}
      </div>
      <div className="text-[9px] text-muted/60 mt-1 truncate">{item.songTitle ?? 'Freeform'}</div>
    </div>
  )
}

// Compose a brand-new post (text / photo / reel / story) right from the
// scheduler. It saves under the chosen show's freeform plan (no episode
// required) and lands in the backlog so it can be dragged onto a slot.
function ComposeDialog({
  projects,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  projects: ApiProject[]
  defaultProjectId?: string
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const [projectId, setProjectId] = useState<string>(defaultProjectId || projects[0]?.id || '')
  const [kind, setKind] = useState<SchedulerSlotKind>('text_post')
  const [text, setText] = useState('')
  const [imageDirection, setImageDirection] = useState('')
  const [caption, setCaption] = useState('')
  const [vibe, setVibe] = useState('')
  const [hook, setHook] = useState('')
  const [talkingPoints, setTalkingPoints] = useState('')
  const [suggestedClip, setSuggestedClip] = useState('')
  const [description, setDescription] = useState('')
  const [medium, setMedium] = useState<'video' | 'photo'>('video')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!projectId) { setError('Pick a show.'); return }
    let fields: Record<string, unknown>
    switch (kind) {
      case 'text_post':
        if (!text.trim()) { setError('Write the post copy first.'); return }
        fields = { text }
        break
      case 'photo_concept':
        fields = { image_direction: imageDirection, caption, vibe }
        break
      case 'reel_concept':
        fields = {
          hook,
          talking_points: talkingPoints.split('\n').map((s) => s.trim()).filter(Boolean),
          suggested_clip: suggestedClip,
        }
        break
      case 'story_concept':
        fields = { medium, description, caption, suggested_clip: suggestedClip, image_direction: imageDirection }
        break
    }
    setBusy(true); setError(null)
    try {
      await api.createSchedulerItem({ projectId, kind, fields })
      await onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-ink/80 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-display text-rainbow uppercase tracking-widest">Compose post</h3>
          <button onClick={onClose} className="text-muted hover:text-text text-lg leading-none">×</button>
        </div>

        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Show</div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Kind</div>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(KIND_STYLES) as SchedulerSlotKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-[10px] uppercase tracking-wider font-bold rounded-lg border px-2 py-2 transition ${
                  kind === k
                    ? `${KIND_STYLES[k].filled} ring-1 ${KIND_STYLES[k].ring} ${KIND_STYLES[k].label_text}`
                    : 'border-line text-muted hover:text-text'
                }`}
              >
                {KIND_STYLES[k].emoji} {KIND_STYLES[k].shortLabel}
              </button>
            ))}
          </div>
        </div>

        {kind === 'text_post' && (
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Caption</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              autoFocus
              placeholder="Write the post copy as you want it to appear…"
              className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-sky-400/60"
            />
          </label>
        )}

        {kind === 'photo_concept' && (
          <>
            <Field label="Image direction" value={imageDirection} onChange={setImageDirection} placeholder="What's in the photo? mood, framing…" multi />
            <Field label="Caption" value={caption} onChange={setCaption} placeholder="The post caption" multi />
            <Field label="Vibe" value={vibe} onChange={setVibe} placeholder="Tone words (warm, gritty, retro…)" />
          </>
        )}

        {kind === 'reel_concept' && (
          <>
            <Field label="Hook" value={hook} onChange={setHook} placeholder="The opening line / on-screen text" multi />
            <Field label="Talking points (one per line)" value={talkingPoints} onChange={setTalkingPoints} placeholder={'Point one\nPoint two\nPoint three'} multi rows={4} />
            <Field label="Suggested clip" value={suggestedClip} onChange={setSuggestedClip} placeholder="What footage to cut from" multi />
          </>
        )}

        {kind === 'story_concept' && (
          <>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Medium</div>
              <div className="inline-flex rounded-lg border border-line bg-ink/40 p-0.5">
                {(['video', 'photo'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMedium(m)}
                    className={`px-3 py-1 rounded-md text-[10px] uppercase tracking-wider font-bold ${
                      medium === m ? 'bg-violet-400/20 text-violet-200' : 'text-muted'
                    }`}
                  >
                    {m === 'video' ? '🎞 Video' : '📸 Photo'}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Description" value={description} onChange={setDescription} placeholder="What's the story?" multi />
            <Field label="Overlay caption" value={caption} onChange={setCaption} placeholder="Sticker / text overlay" />
            {medium === 'video'
              ? <Field label="Suggested clip" value={suggestedClip} onChange={setSuggestedClip} placeholder="What footage to use" multi />
              : <Field label="Image direction" value={imageDirection} onChange={setImageDirection} placeholder="What the photo looks like" multi />}
          </>
        )}

        {error && <p className="text-urgent text-xs">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-muted hover:text-text px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2 disabled:opacity-50"
          >
            {busy ? 'Saving…' : '+ Add to backlog'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multi,
  rows,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  multi?: boolean
  rows?: number
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">{label}</div>
      {multi ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows ?? 2}
          placeholder={placeholder}
          className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering/60"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 text-sm outline-none focus:border-stage-mastering/60"
        />
      )}
    </label>
  )
}
