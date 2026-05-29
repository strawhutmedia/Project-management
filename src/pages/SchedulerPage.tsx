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
  type ApiSchedulerDay,
  type ApiSchedulerItem,
  type ApiSchedulerResponse,
  type ApiSchedulerSlot,
  type ApiSocialItem,
  type SchedulerSlotKind,
} from '../api'
import { useAuth } from '../auth'
import { Link } from 'react-router-dom'

const KIND_LABEL: Record<SchedulerSlotKind, string> = {
  text_post: '✍️ Text',
  photo_concept: '📷 Photo',
  reel_concept: '🎬 Reel',
  story_concept: '💬 Story',
}

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

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

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
        />
      </div>
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
}: {
  day: ApiSchedulerDay
  isAdmin: boolean
  busySlotId: string | null
  onAssign: (slotId: string, from: ApiSchedulerItem) => void
  onClear: (slotId: string) => void
  onTimeChange: (slotId: string, time: string) => void
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
            <div className="text-[9px] uppercase tracking-wider text-muted/70 font-bold px-1 mb-1">
              {KIND_LABEL[kind]}
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
}: {
  slot: ApiSchedulerSlot
  isAdmin: boolean
  busy: boolean
  onAssign: (slotId: string, from: ApiSchedulerItem) => void
  onClear: (slotId: string) => void
  onTimeChange: (slotId: string, time: string) => void
}) {
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
        filled
          ? 'border-line bg-ink/60 hover:border-stage-mastering/60'
          : 'border-dashed border-line/40 bg-ink/20 hover:bg-ink/40',
        over ? 'border-stage-mastering bg-stage-mastering/10 ring-1 ring-stage-mastering/40' : '',
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
            className="text-[10px] text-muted font-mono hover:text-stage-mastering cursor-pointer disabled:cursor-default"
            title={isAdmin ? 'Click to change time' : 'PT time (read-only)'}
          >
            {format12h(slot.scheduledTime)}
          </button>
        )}
        {filled && isAdmin && (
          <button
            onClick={() => onClear(slot.id)}
            className="text-[10px] text-muted/50 hover:text-urgent opacity-0 group-hover:opacity-100"
            title="Remove from this slot (sends back to backlog)"
          >
            ✕
          </button>
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
}: {
  items: ApiSchedulerItem[]
  shows: Array<{ id: string; name: string }>
  showFilter: string
  onShowFilter: (id: string) => void
  loading: boolean
  isAdmin: boolean
  onUnpush: (item: ApiSchedulerItem) => void
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
                <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1.5">
                  {KIND_LABEL[kind]} ({group.length})
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
      className={`rounded-lg border border-line bg-ink/40 p-2 text-[11px] ${isAdmin ? 'cursor-grab active:cursor-grabbing hover:border-stage-mastering/60' : ''} transition`}
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
      <div className="text-[9px] text-muted/60 mt-1 truncate">{item.songTitle}</div>
    </div>
  )
}
