import { useEffect, useMemo, useState, useRef } from 'react'
import { api, type ApiScene, type ApiShootDay, type ApiStripboard } from '../api'
import SceneDetailModal from './SceneDetailModal'
import ScriptChangelogCard from './ScriptChangelogCard'
import AutoScheduleModal from './AutoScheduleModal'

type ScriptArchive = {
  id: string
  fileName: string | null
  byteSize: number
  sceneCount: number
  uploadedAt: string
}

type BreakdownProgress = {
  totalScenes: number
  withActionText: number
  withBreakdown: number
  isRunning: boolean
  isStale: boolean
  lastRunAt: string | null
}

type ScheduleSnapshot = {
  id: string
  name: string
  description: string | null
  createdAt: string
  sceneCount: number
  shootDayCount: number
}

// Strip styles tuned for the dark Slate UI. Each strip is a dark card with
// a colored left stripe + colored "INT/EXT · TIME" label, so text is always
// readable. The stripe is the at-a-glance type indicator (industry-standard
// colors: yellow=EXT day, off-white=INT day, blue=INT night, emerald=EXT
// night, amber=sunset/magic hour).
type StripKind = 'EXT_DAY' | 'INT_DAY' | 'EXT_NIGHT' | 'INT_NIGHT' | 'SUNSET' | 'DEFAULT'

// Five distinct hues — ~70° apart on the color wheel — so every
// INT/EXT × DAY/NIGHT × SUNSET combo reads as its own color even
// on a phone in bright light. Each card is a saturated gradient
// within a single hue family for visual interest.
//   EXT DAY    GOLD       sunshine (classic stripboard yellow)
//   INT DAY    MAGENTA    warm-lit interior
//   EXT NIGHT  GREEN      moonlit nature
//   INT NIGHT  BLUE       lamp-lit room
//   SUNSET     ORANGE-RED magic hour
//   DEFAULT    GRAY       no time-of-day metadata
const STRIP_STYLE: Record<StripKind, { stripe: string; label: string; card: string }> = {
  EXT_DAY:   { stripe: 'bg-yellow-200',  label: 'text-yellow-50',   card: 'bg-gradient-to-br from-yellow-400 via-amber-500 to-yellow-600' },
  INT_DAY:   { stripe: 'bg-pink-200',    label: 'text-pink-50',     card: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-rose-600' },
  EXT_NIGHT: { stripe: 'bg-emerald-300', label: 'text-emerald-50',  card: 'bg-gradient-to-br from-emerald-600 via-green-700 to-emerald-900' },
  INT_NIGHT: { stripe: 'bg-blue-200',    label: 'text-blue-50',     card: 'bg-gradient-to-br from-blue-600 via-indigo-700 to-blue-900' },
  SUNSET:    { stripe: 'bg-orange-200',  label: 'text-orange-50',   card: 'bg-gradient-to-br from-red-500 via-orange-500 to-red-600' },
  DEFAULT:   { stripe: 'bg-line',        label: 'text-white/70',    card: 'bg-gradient-to-br from-slate-600 to-slate-800' },
}

function timeOfDayCategory(tod: string | null | undefined): 'DAY' | 'NIGHT' | 'SUNSET' | null {
  const t = (tod || '').toUpperCase()
  if (!t) return null
  if (t.startsWith('SUNSET') || t.startsWith('SUNRISE') || t.startsWith('MAGIC') || t.startsWith('DUSK') || t.startsWith('DAWN')) return 'SUNSET'
  if (t.includes('NIGHT') || t.includes('EVENING')) return 'NIGHT'
  if (t.includes('DAY') || t.includes('MORNING') || t.includes('AFTERNOON') || t.includes('NOON')) return 'DAY'
  // CONTINUOUS / SAME / LATER / MOMENTS LATER / INTERCUT / CONT'D — caller should fall back
  return null
}

function stripKind(s: ApiScene, resolvedTod?: string): StripKind {
  // INT/EXT scenes (heading reads "INT/EXT.") are visible outdoors → treat as EXT
  const ie = s.intExt === 'INT/EXT' ? 'EXT' : s.intExt
  const tod = resolvedTod ?? s.timeOfDay ?? ''
  const cat = timeOfDayCategory(tod)
  if (cat === 'SUNSET') return 'SUNSET'
  if (cat === 'NIGHT') return ie === 'EXT' ? 'EXT_NIGHT' : 'INT_NIGHT'
  if (cat === 'DAY') return ie === 'EXT' ? 'EXT_DAY' : 'INT_DAY'
  return 'DEFAULT'
}

function fmtEighths(eighths: number): string {
  if (eighths === 0) return '—'
  const whole = Math.floor(eighths / 8)
  const frac = eighths % 8
  if (whole === 0) return `${frac}/8`
  if (frac === 0) return `${whole}`
  return `${whole} ${frac}/8`
}

type UndoEntry = { sceneId: string; shootDayId: string | null; dayPosition: number; sceneNumber: string }

export default function Stripboard({ projectId, isAdmin, projectName }: { projectId: string; isAdmin: boolean; projectName?: string }) {
  const [board, setBoard] = useState<ApiStripboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [openSceneId, setOpenSceneId] = useState<string | null>(null)
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false)
  const [archive, setArchive] = useState<ScriptArchive | null>(null)
  const [progress, setProgress] = useState<BreakdownProgress | null>(null)
  const [snapshots, setSnapshots] = useState<ScheduleSnapshot[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Mirror board in a ref so moveScene can read the freshest state without
  // re-creating its closure on every render.
  const boardRef = useRef<ApiStripboard | null>(null)
  boardRef.current = board

  async function load() {
    try {
      const data = await api.stripboard(projectId)
      setBoard(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  async function loadArchive() {
    try {
      const r = await api.scriptArchive(projectId)
      setArchive(r.archive)
    } catch {
      setArchive(null)
    }
  }

  async function loadProgress() {
    try {
      const r = await api.breakdownProgress(projectId)
      setProgress(r)
    } catch {
      setProgress(null)
    }
  }

  async function loadSnapshots() {
    try {
      const r = await api.scheduleSnapshots(projectId)
      setSnapshots(r.snapshots)
    } catch {
      setSnapshots([])
    }
  }

  useEffect(() => {
    void load()
    void loadArchive()
    void loadProgress()
    void loadSnapshots()
  }, [projectId])

  // Poll breakdown progress every 4 seconds while it's running, so the
  // banner updates live without the user having to refresh. Refreshes
  // the stripboard once the run finishes so the scene chips reflect
  // the new breakdown items.
  useEffect(() => {
    if (!progress || (!progress.isRunning && !progress.isStale)) return
    if (progress.withBreakdown >= progress.withActionText) return
    const interval = setInterval(() => { void loadProgress() }, 4000)
    return () => clearInterval(interval)
  }, [progress?.isRunning, progress?.withBreakdown])

  // When breakdown finishes (transitions from running → not running),
  // reload the stripboard so scene cards show updated budget chips.
  const prevRunningRef = useRef(false)
  useEffect(() => {
    if (prevRunningRef.current && !progress?.isRunning) {
      void load()
    }
    prevRunningRef.current = !!progress?.isRunning
  }, [progress?.isRunning])

  async function saveSnapshot() {
    const name = prompt('Name this schedule (e.g. "Plan A — locked v1")')
    if (!name || !name.trim()) return
    try {
      await api.saveScheduleSnapshot(projectId, { name: name.trim() })
      await loadSnapshots()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  async function restoreSnapshot(snap: ScheduleSnapshot) {
    if (!confirm(`Restore "${snap.name}"? Your current schedule will be replaced (but you can save it first if you want to keep it).`)) return
    try {
      await api.restoreScheduleSnapshot(snap.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  async function deleteSnapshot(snap: ScheduleSnapshot) {
    if (!confirm(`Delete snapshot "${snap.name}"? This can't be undone.`)) return
    try {
      await api.deleteScheduleSnapshot(snap.id)
      await loadSnapshots()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  // Capture-and-apply scene move. Records the prior position to the undo
  // stack BEFORE applying so an undo can restore it. Cap at 50 entries.
  async function moveScene(sceneId: string, toDayId: string | null, toPosition: number) {
    const cur = boardRef.current?.scenes.find((s) => s.id === sceneId)
    if (!cur) return
    const entry: UndoEntry = {
      sceneId,
      shootDayId: cur.shootDayId,
      dayPosition: cur.dayPosition,
      sceneNumber: cur.number,
    }
    try {
      await api.updateScene(sceneId, { shootDayId: toDayId, dayPosition: toPosition })
      setUndoStack((stack) => [...stack.slice(-49), entry])
      await load()
    } catch (err) {
      console.error('move failed', err)
    }
  }

  // Drop a scene onto another scene card. `insertion` tells us whether
  // the drop landed on the LEFT half of the target (place before) or
  // the RIGHT half (place after) — the old code always inserted before,
  // so you could never push a scene past the right-most card.
  //
  // The fix:
  //   1. Rebuild the target day's full ordered list, removing the
  //      dragged scene and inserting at target ± 1.
  //   2. Renumber every scene in the day as 10, 20, 30, … so positions
  //      don't drift into fractional collisions over time.
  //   3. PATCH only the scenes whose position actually changed.
  async function reorderScene(
    draggedSceneId: string,
    targetSceneId: string,
    insertion: 'before' | 'after',
  ) {
    const board = boardRef.current
    if (!board) return
    const dragged = board.scenes.find((s) => s.id === draggedSceneId)
    const target = board.scenes.find((s) => s.id === targetSceneId)
    if (!dragged || !target) return
    const targetDayId = target.shootDayId

    // Record undo BEFORE the renumber so a single ⌘Z restores the
    // dragged scene's previous position.
    setUndoStack((stack) => [
      ...stack.slice(-49),
      {
        sceneId: draggedSceneId,
        shootDayId: dragged.shootDayId,
        dayPosition: dragged.dayPosition,
        sceneNumber: dragged.number,
      },
    ])

    // Build the target day's ordered list (excluding the dragged scene),
    // then insert dragged at target's index ± 1.
    const dayList = board.scenes
      .filter((s) => s.shootDayId === targetDayId && s.id !== draggedSceneId)
      .sort((a, b) => a.dayPosition - b.dayPosition || a.scriptPosition - b.scriptPosition)

    const targetIdx = dayList.findIndex((s) => s.id === targetSceneId)
    if (targetIdx === -1) return
    const insertAt = insertion === 'after' ? targetIdx + 1 : targetIdx
    const newOrder = [...dayList.slice(0, insertAt), dragged, ...dayList.slice(insertAt)]

    // Renumber to clean multiples of 10 and PATCH only the scenes whose
    // (shootDayId, dayPosition) actually changed. The dragged scene may
    // also be changing shootDayId if this was a cross-day drop.
    const patches: Array<Promise<unknown>> = []
    for (let i = 0; i < newOrder.length; i++) {
      const s = newOrder[i]
      const newPos = (i + 1) * 10
      const dayChanged = s.id === draggedSceneId && s.shootDayId !== targetDayId
      if (s.dayPosition === newPos && !dayChanged) continue
      const patch: { shootDayId?: string | null; dayPosition: number } = { dayPosition: newPos }
      if (dayChanged) patch.shootDayId = targetDayId
      patches.push(api.updateScene(s.id, patch).catch((e) => console.error('reorder patch failed', e)))
    }
    await Promise.all(patches)
    await load()
  }

  async function undo() {
    setUndoStack((stack) => {
      const last = stack[stack.length - 1]
      if (!last) return stack
      // Apply async without awaiting inside the setter
      void (async () => {
        try {
          await api.updateScene(last.sceneId, {
            shootDayId: last.shootDayId,
            dayPosition: last.dayPosition,
          })
          await load()
        } catch (err) {
          console.error('undo failed', err)
        }
      })()
      return stack.slice(0, -1)
    })
  }

  // Cmd/Ctrl-Z keyboard shortcut for desktop.
  useEffect(() => {
    if (!isAdmin) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        e.preventDefault()
        void undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isAdmin])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.fdx')) {
      setError('Only .fdx files are accepted (Final Draft format).')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setImporting(true)
    setError(null)
    try {
      const xml = await file.text()
      await api.importFdx(projectId, xml, file.name)
      await load()
      await loadArchive()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function reparseArchived() {
    if (!confirm('Re-parse the archived .fdx? This uses the script we have on file (no new upload needed) and refreshes every scene\'s metadata + Claude breakdown.')) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.reparseArchivedScript(projectId)
      setError(`✓ Re-parsed ${r.sceneCount} scenes from ${r.fileName || 'archived .fdx'}. Breakdown re-running in the background — refresh in 30–60 seconds.`)
      await load()
      await loadArchive()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function reanalyzeAll() {
    if (!confirm('Re-analyze every scene with Claude? Existing zero-cost suggestions get replaced; rows you\'ve already priced are preserved. Takes ~30 seconds for a feature, costs ~$0.50.')) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.reanalyzeAllScenes(projectId)
      setError(`✓ Re-analyzing ${r.sceneCount} scenes in the background. Refresh in 30–60 seconds to see updated breakdowns.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function applyBiyaSchedule() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.applyBiyaSchedule(projectId)
      await load()
      if (result.missing.length > 0) {
        setError(`Applied ${result.assigned} scenes. ${result.missing.length} scene numbers from the schedule weren't found in the .fdx: ${result.missing.slice(0, 5).join(', ')}${result.missing.length > 5 ? '…' : ''}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }


  async function addDay(isBreak: boolean) {
    if (!board) return
    const next = (board.days[board.days.length - 1]?.number ?? 0) + 1
    setBusy(true)
    try {
      await api.createShootDay(projectId, { number: next, isBreak })
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Build per-day buckets, including unscheduled
  const grouped = useMemo(() => {
    if (!board) return null
    const byDay = new Map<string, ApiScene[]>()
    const unscheduled: ApiScene[] = []
    for (const s of board.scenes) {
      if (!s.shootDayId) {
        unscheduled.push(s)
        continue
      }
      const arr = byDay.get(s.shootDayId) ?? []
      arr.push(s)
      byDay.set(s.shootDayId, arr)
    }
    for (const arr of byDay.values()) {
      arr.sort((a, b) => a.dayPosition - b.dayPosition || a.scriptPosition - b.scriptPosition)
    }
    unscheduled.sort((a, b) => a.scriptPosition - b.scriptPosition)
    return { byDay, unscheduled }
  }, [board])

  // Walk all scenes in script order and forward-fill the time of day so that
  // CONTINUOUS / SAME / LATER / INTERCUT / empty inherits from the most recent
  // scene that did declare DAY/NIGHT/SUNSET. Without this, every CONTINUOUS
  // scene falls into DEFAULT (slate) even though screenwriting convention is
  // that "CONTINUOUS" means "right after the previous scene → same time".
  const resolvedTod = useMemo(() => {
    const map = new Map<string, string>()
    if (!board) return map
    const sorted = [...board.scenes].sort((a, b) => a.scriptPosition - b.scriptPosition)
    let lastReal = ''
    for (const s of sorted) {
      const own = s.timeOfDay ?? ''
      if (timeOfDayCategory(own) !== null) {
        lastReal = own
        map.set(s.id, own)
      } else {
        map.set(s.id, lastReal)
      }
    }
    return map
  }, [board])

  if (!board) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎬 Stripboard</div>
        <p className="text-muted text-sm mt-2">{error ?? 'Loading…'}</p>
      </section>
    )
  }

  if (board.scenes.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎬 Stripboard</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Upload a Final Draft (.fdx) file to import every scene with its location,
            cast, INT/EXT, day/night, and page count. Drag scenes between shoot days
            to build your schedule.
          </p>
        </div>
        {isAdmin && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".fdx"
              onChange={(e) => void handleFile(e)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5 disabled:opacity-50"
            >
              {importing ? 'Parsing…' : '📥 Upload Final Draft (.fdx)'}
            </button>
          </div>
        )}
        {error && <p className="text-urgent text-sm">{error}</p>}
      </section>
    )
  }

  const totalEighths = board.scenes.reduce((s, sc) => s + sc.pageEighths, 0)
  const scheduledEighths = board.scenes.filter((s) => s.shootDayId).reduce((s, sc) => s + sc.pageEighths, 0)

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <ScriptChangelogCard projectId={projectId} isAdmin={isAdmin} />
      {progress && progress.withActionText > 0 && progress.withBreakdown < progress.withActionText && (
        <div className={`rounded-xl border px-4 py-3 ${
          progress.isStale
            ? 'border-urgent/40 bg-urgent/5'
            : 'border-stage-mastering/40 bg-stage-mastering/10'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-lg">
              {progress.isStale ? '⚠️' : <span className="inline-block w-3 h-3 rounded-full bg-stage-mastering animate-pulse" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-bold mb-0.5">
                {progress.isStale
                  ? `Breakdown paused — ${progress.withActionText - progress.withBreakdown} scenes still unanalyzed`
                  : `Claude is analyzing your script · ${progress.withBreakdown} / ${progress.withActionText} scenes`}
              </div>
              <div className="h-1.5 bg-ink/40 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${progress.isStale ? 'bg-urgent' : 'bg-gradient-to-r from-stage-mastering to-stage-tracking'}`}
                  style={{ width: `${(progress.withBreakdown / Math.max(1, progress.withActionText)) * 100}%` }}
                />
              </div>
              <div className="text-[10px] text-muted mt-1">
                {progress.isStale
                  ? 'Click "✨ Re-analyze all scenes" to resume.'
                  : 'Stays open while it runs — you can keep working, scene chips update live.'}
              </div>
            </div>
          </div>
        </div>
      )}
      {(snapshots.length > 0 || isAdmin) && (
        <div className="rounded-xl border border-stage-tracking/30 bg-stage-tracking/5 px-3 py-2 flex items-center justify-between gap-3 flex-wrap text-[11px]">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span>📅</span>
            <span className="text-muted">Saved schedules:</span>
            {snapshots.length === 0 && (
              <span className="text-muted/60 italic">None yet — save your current schedule before experimenting</span>
            )}
            {snapshots.slice(0, 5).map((s) => (
              <span
                key={s.id}
                className="group flex items-center gap-1 bg-ink/40 border border-line rounded-full px-2 py-0.5"
              >
                <button
                  onClick={() => void restoreSnapshot(s)}
                  title={`Restore ${s.name} (saved ${new Date(s.createdAt).toLocaleDateString()})`}
                  className="text-text hover:text-stage-tracking"
                >
                  {s.name}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => void deleteSnapshot(s)}
                    className="text-muted/40 hover:text-urgent opacity-0 group-hover:opacity-100"
                    title="Delete this snapshot"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {snapshots.length > 5 && (
              <span className="text-muted/60">+{snapshots.length - 5} more</span>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => void saveSnapshot()}
              className="text-stage-tracking hover:underline"
            >
              💾 Save current
            </button>
          )}
        </div>
      )}
      {archive && (
        <div className="rounded-xl border border-stage-stems/30 bg-stage-stems/5 px-3 py-2 flex items-center justify-between gap-3 flex-wrap text-[11px]">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span>📜</span>
            <span className="text-muted">Script archive:</span>
            <span className="font-mono text-text truncate max-w-[240px]" title={archive.fileName ?? ''}>
              {archive.fileName || 'script.fdx'}
            </span>
            <span className="text-muted/60">
              · {Math.round(archive.byteSize / 1024)} KB · {archive.sceneCount} scenes ·
              uploaded {new Date(archive.uploadedAt).toLocaleDateString()}
            </span>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={api.scriptArchiveDownloadUrl(projectId)}
                download
                className="text-stage-stems hover:underline"
              >
                Download
              </a>
              <button
                onClick={() => void reparseArchived()}
                disabled={busy}
                title="Re-parse the archived .fdx with the current parser — no new upload needed."
                className="text-stage-mastering hover:underline disabled:opacity-50"
              >
                Re-parse archive
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎬 Stripboard</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            {board.scenes.length} scenes · {fmtEighths(totalEighths)} pages total ·
            {' '}{fmtEighths(scheduledEighths)} scheduled · {board.days.filter((d) => !d.isBreak).length} shoot days
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => void undo()}
              disabled={undoStack.length === 0}
              title="Undo last move (⌘Z)"
              className="text-[10px] uppercase tracking-wider text-text border border-line rounded-full px-3 py-1.5 hover:bg-ink/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ↶ Undo {undoStack.length > 0 ? `(${undoStack.length})` : ''}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".fdx"
              onChange={(e) => void handleFile(e)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="text-[10px] uppercase tracking-wider text-stage-stems border border-stage-stems/40 rounded-full px-3 py-1.5 hover:bg-stage-stems/10 disabled:opacity-50"
            >
              {importing ? 'Parsing…' : '↻ Re-import .fdx'}
            </button>
            <button
              onClick={() => void reanalyzeAll()}
              disabled={busy}
              title="Re-run Claude breakdown on every scene already in the database. No .fdx upload needed."
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-50"
            >
              ✨ Re-analyze all scenes
            </button>
            <button
              onClick={() => setAutoScheduleOpen(true)}
              disabled={busy || (board?.scenes.length ?? 0) === 0}
              title="Let Claude plan the shoot. You'll preview and approve before anything changes."
              className="text-[10px] uppercase tracking-wider text-white bg-gradient-to-r from-stage-tracking to-stage-mixing rounded-full px-3 py-1.5 hover:opacity-90 disabled:opacity-50 font-bold"
            >
              ✨ Auto-plan schedule
            </button>
            {projectName === 'Back in Your Arms' && (grouped?.unscheduled.length ?? 0) > 0 && (
              <button
                onClick={() => void applyBiyaSchedule()}
                disabled={busy}
                className="text-[10px] uppercase tracking-wider text-white bg-gradient-to-r from-stage-producing to-stage-mastering rounded-full px-3 py-1.5 hover:opacity-90 disabled:opacity-50 font-bold"
              >
                ✨ Apply BIYA schedule
              </button>
            )}
            <button
              onClick={() => void addDay(false)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-50"
            >
              + Day
            </button>
            <button
              onClick={() => void addDay(true)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider text-muted border border-line rounded-full px-3 py-1.5 hover:bg-ink/40 disabled:opacity-50"
            >
              + Break
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-urgent text-sm">{error}</p>}

      <div className="flex items-center gap-3 flex-wrap text-[10px] uppercase tracking-wider text-muted border border-line/40 bg-ink/20 rounded-xl px-3 py-2">
        <span className="font-bold text-text">Color key</span>
        <LegendChip label="EXT Day"   className="bg-gradient-to-br from-yellow-400 to-yellow-600" />
        <LegendChip label="INT Day"   className="bg-gradient-to-br from-pink-500 to-rose-600" />
        <LegendChip label="EXT Night" className="bg-gradient-to-br from-emerald-600 to-emerald-900" />
        <LegendChip label="INT Night" className="bg-gradient-to-br from-blue-600 to-blue-900" />
        <LegendChip label="Sunset / Magic Hour" className="bg-gradient-to-br from-red-500 to-orange-500" />
        <LegendChip label="Time unspecified" className="bg-gradient-to-br from-slate-600 to-slate-800" />
      </div>

      <div className="space-y-2">
        <DayRow
          day={null}
          label="UNSCHEDULED"
          scenes={grouped?.unscheduled ?? []}
          isAdmin={isAdmin}
          moveScene={moveScene}
          reorderScene={reorderScene}
          resolvedTod={resolvedTod}
          onOpenScene={setOpenSceneId}
        />
        {board.days.map((day) => (
          <DayRow
            key={day.id}
            day={day}
            label={day.isBreak ? `BREAK · DAY ${day.number}` : `DAY ${day.number}`}
            scenes={grouped?.byDay.get(day.id) ?? []}
            isAdmin={isAdmin}
            moveScene={moveScene}
          reorderScene={reorderScene}
            resolvedTod={resolvedTod}
            onOpenScene={setOpenSceneId}
          />
        ))}
      </div>

      {openSceneId && (
        <SceneDetailModal
          sceneId={openSceneId}
          projectId={projectId}
          scene={board.scenes.find((s) => s.id === openSceneId) ?? null}
          isAdmin={isAdmin}
          onClose={() => setOpenSceneId(null)}
          onChanged={() => void load()}
        />
      )}

      {autoScheduleOpen && (
        <AutoScheduleModal
          projectId={projectId}
          currentShootDayCount={board.days.filter((d) => !d.isBreak).length}
          onClose={() => setAutoScheduleOpen(false)}
          onApplied={() => {
            void load()
            void loadSnapshots()
          }}
        />
      )}
    </section>
  )
}

function DayRow({
  day,
  label,
  scenes,
  isAdmin,
  moveScene,
  reorderScene,
  resolvedTod,
  onOpenScene,
}: {
  day: ApiShootDay | null
  label: string
  scenes: ApiScene[]
  reorderScene: (draggedSceneId: string, targetSceneId: string, insertion: 'before' | 'after') => void
  isAdmin: boolean
  moveScene: (sceneId: string, toDayId: string | null, toPosition: number) => Promise<void>
  resolvedTod: Map<string, string>
  onOpenScene: (id: string) => void
}) {
  const [over, setOver] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const totalEighths = scenes.reduce((s, sc) => s + sc.pageEighths, 0)
  const overTarget = totalEighths > 56 // 7 pages = warn (red)
  const heavyTarget = totalEighths > 48 // 6 pages = caution (yellow)

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setOver(false)
    const sceneId = e.dataTransfer.getData('text/scene-id')
    if (!sceneId) return
    // Append to the END of the day. Old code used scenes.length, but
    // existing scenes are renumbered as 10, 20, 30… so a "length"
    // value of 3 lands BEFORE everyone. Compute one slot past the
    // current max so the dropped scene actually shows up last.
    const maxPos = scenes.reduce((m, s) => Math.max(m, s.dayPosition), 0)
    await moveScene(sceneId, day?.id ?? null, maxPos + 10)
  }

  const isUnscheduled = day === null
  const isBreak = day?.isBreak ?? false

  return (
    <div
      onDragOver={(e) => { if (isAdmin) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => isAdmin && void handleDrop(e)}
      className={`rounded-xl border transition ${
        over ? 'border-stage-mastering bg-stage-mastering/10' :
        isBreak ? 'border-line/40 bg-ink/20' :
        isUnscheduled ? 'border-stage-stems/40 bg-stage-stems/5' :
        'border-line bg-ink/30'
      }`}
    >
      {/* Header row */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-ink/30 rounded-t-xl"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-muted text-xs">{collapsed ? '▸' : '▾'}</span>
          <span className={`text-[11px] uppercase tracking-[0.15em] font-bold ${
            isBreak ? 'text-muted' :
            isUnscheduled ? 'text-stage-stems' :
            overTarget ? 'text-urgent' :
            heavyTarget ? 'text-stage-overdubs' :
            'text-stage-mastering'
          }`}>{label}</span>
          {day?.shootDate && <span className="text-[10px] text-muted">· {day.shootDate}</span>}
        </div>
        <div className={`text-[11px] font-mono ${overTarget ? 'text-urgent font-bold' : heavyTarget ? 'text-stage-overdubs' : 'text-muted'}`}>
          {scenes.length} sc · {fmtEighths(totalEighths)} pages
          {overTarget && ' ⚠ over'}
        </div>
      </button>

      {/* Body — responsive grid of square scene cards */}
      {!collapsed && (
        <div
          className="px-3 pb-3 pt-1"
          onDragOver={(e) => { if (isAdmin) e.preventDefault() }}
        >
          {scenes.length === 0 ? (
            <div className="text-[11px] text-muted/60 italic py-2">
              {isUnscheduled ? 'All scenes scheduled ✓' : isBreak ? 'Day off' : 'Drop scenes here'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {scenes.map((s) => (
                <SceneCard
                  key={s.id}
                  scene={s}
                  isAdmin={isAdmin}
                  resolvedTod={resolvedTod.get(s.id) ?? ''}
                  onOpen={() => onOpenScene(s.id)}
                  onReorder={reorderScene}
                />
              ))}
            </div>
          )}
          {day && !day.isBreak && <DayCostsSection shootDayId={day.id} isAdmin={isAdmin} />}
        </div>
      )}
    </div>
  )
}

function SceneCard({
  scene,
  isAdmin,
  resolvedTod,
  onOpen,
  onReorder,
}: {
  scene: ApiScene
  isAdmin: boolean
  resolvedTod: string
  onOpen: () => void
  onReorder: (draggedSceneId: string, targetSceneId: string, insertion: 'before' | 'after') => void
}) {
  const kind = stripKind(scene, resolvedTod)
  const style = STRIP_STYLE[kind]
  const hasBudget = scene.budgetItemCount > 0
  const [dragOver, setDragOver] = useState(false)
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={isAdmin}
      onDragOver={(e) => {
        // Type-checking dataTransfer.types during dragover is unreliable
        // across browsers (Safari sometimes returns a DOMStringList
        // without .includes, and some types are hidden until drop for
        // security). Just unconditionally accept the drop when admin
        // and let onDrop verify the payload.
        if (!isAdmin) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!isAdmin) return
        const draggedSceneId = e.dataTransfer.getData('text/scene-id')
        setDragOver(false)
        if (!draggedSceneId || draggedSceneId === scene.id) return
        e.preventDefault()
        e.stopPropagation()
        // Decide before/after based on where in the card the cursor
        // landed. Cards are square-ish, so the X axis is the natural
        // split for left-to-right reading order; on a desktop with
        // multi-column grid, the columns also flow left-to-right, so
        // X bisection gives the expected "insert here" feel.
        const rect = e.currentTarget.getBoundingClientRect()
        const dropX = e.clientX - rect.left
        const insertion: 'before' | 'after' = dropX < rect.width / 2 ? 'before' : 'after'
        onReorder(draggedSceneId, scene.id, insertion)
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/scene-id', scene.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`relative text-left aspect-square rounded-2xl ring-1 ${
        dragOver ? 'ring-4 ring-stage-mastering' : 'ring-white/10'
      } overflow-hidden ${style.card} ${
        isAdmin ? 'cursor-pointer' : 'cursor-pointer'
      } hover:ring-white/40 hover:shadow-xl hover:scale-[1.02] transition flex flex-col text-white shadow-md`}
      title={`${scene.slug} — click to open breakdown`}
    >
      <div className={`h-1 w-full ${style.stripe} opacity-90`} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent pointer-events-none" />

      <div className="relative flex-1 flex flex-col px-3 py-2.5 min-h-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono font-bold text-base text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">#{scene.number}</span>
          <span className="text-[10px] font-mono text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">{fmtEighths(scene.pageEighths)}p</span>
        </div>

        <div
          className="mt-1 font-bold uppercase tracking-tight leading-tight text-white text-[11px] line-clamp-3 break-words [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]"
          title={scene.location ?? ''}
        >
          {scene.location || scene.slug}
        </div>

        <div className="mt-auto pt-1 space-y-0.5">
          <div className="text-[9px] uppercase tracking-wider font-bold text-white truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            {scene.intExt ?? ''} {scene.timeOfDay ?? ''}
          </div>
          {scene.characters.length > 0 && (
            <div className="text-[9px] font-mono text-white/85 truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]" title={scene.characters.join(', ')}>
              {scene.characters.slice(0, 3).join('·')}{scene.characters.length > 3 ? `+${scene.characters.length - 3}` : ''}
            </div>
          )}
          {hasBudget && (
            <div className="text-[9px] font-mono text-white bg-black/30 rounded px-1 py-0.5 inline-block [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
              {scene.budgetTotal > 0
                ? `$${Math.round(scene.budgetTotal).toLocaleString()}`
                : `${scene.budgetItemCount} item${scene.budgetItemCount === 1 ? '' : 's'} · price me`}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function LegendChip({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-sm ${className}`} />
      <span className="text-text normal-case tracking-normal">{label}</span>
    </span>
  )
}

// Day-level budget items: equipment rental, crew rate, catering, base
// camp, etc. — costs that belong to a whole shoot day rather than a
// single scene. Collapsed by default; click the header to expand.
// Per-day budget bucketed by category. The day is the primary unit
// of cost — cast, crew, equipment, locations, catering all rolled
// up per-day, with cast auto-populated from the day's scheduled
// scenes.
type DayCostItem = {
  id: string
  description: string
  vendor: string | null
  total: number
  amt: number
  rate: number
  code: string | null
  spansAllShootDays: boolean
  isSource: boolean
  sourceShootDayId: string | null
}

const DAY_BUCKETS: Array<{ code: string; label: string; icon: string }> = [
  { code: 'CAST',      label: 'Cast on call',  icon: '🎭' },
  { code: 'CREW',      label: 'Crew',          icon: '👷' },
  { code: 'EQUIPMENT', label: 'Equipment',     icon: '🎥' },
  { code: 'LOCATION',  label: 'Locations',     icon: '📍' },
  { code: 'CATERING',  label: 'Catering',      icon: '🍽' },
  { code: 'OTHER',     label: 'Other',         icon: '🚐' },
]

function DayCostsSection({
  shootDayId,
  isAdmin,
}: {
  shootDayId: string
  isAdmin: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<DayCostItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await api.dayBudgetItems(shootDayId)
      setItems(r.items.map((it) => ({
        id: it.id, description: it.description, vendor: it.vendor, total: it.total,
        amt: it.amt, rate: it.rate, code: it.code,
        spansAllShootDays: it.spansAllShootDays,
        isSource: it.isSource,
        sourceShootDayId: it.sourceShootDayId,
      })))
    } catch {
      setItems([])
    }
  }

  useEffect(() => {
    if (expanded && items === null) void load()
  }, [expanded])

  async function autoAddCast() {
    setBusy(true)
    try {
      const r = await api.autoAddCastForDay(shootDayId)
      await load()
      if (r.added === 0 && r.message) alert(r.message)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function add(code: string, description: string, vendor: string, cost: number) {
    if (!description.trim()) return
    await api.quickAddDayCost(shootDayId, {
      description: description.trim(),
      vendor: vendor.trim() || undefined,
      cost, code,
    })
    await load()
  }

  async function updateCost(id: string, cost: number) {
    await api.updateBudgetItem(id, { rate: cost, amt: 1, x: 1 })
    await load()
  }

  async function toggleRunOfShoot(id: string, current: boolean) {
    await api.updateBudgetItem(id, { spansAllShootDays: !current })
    await load()
  }

  async function remove(id: string) {
    await api.deleteBudgetItem(id)
    await load()
  }

  const total = (items ?? []).reduce((s, i) => s + i.total, 0)

  return (
    <div className="border-t border-line/40 mt-2 pt-2 px-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-muted hover:text-text"
      >
        <span className="flex items-center gap-2">
          <span>{expanded ? '▾' : '▸'}</span>
          <span className="font-bold">💰 Day budget</span>
          <span className="text-muted/70">
            ({(items ?? []).length} item{(items ?? []).length === 1 ? '' : 's'})
          </span>
        </span>
        <span className="font-mono text-text font-bold">
          ${Math.round(total).toLocaleString()}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {items === null ? (
            <p className="text-[11px] text-muted italic">Loading…</p>
          ) : (
            DAY_BUCKETS.map((bucket) => (
              <DayBucket
                key={bucket.code}
                code={bucket.code}
                label={bucket.label}
                icon={bucket.icon}
                items={items.filter((i) => (i.code ?? 'OTHER') === bucket.code)}
                isAdmin={isAdmin}
                onAdd={(desc, vendor, cost) => add(bucket.code, desc, vendor, cost)}
                onUpdate={updateCost}
                onDelete={remove}
                onToggleRunOfShoot={toggleRunOfShoot}
                onAutoAddCast={bucket.code === 'CAST' ? autoAddCast : undefined}
                busyAutoAdd={busy}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function DayBucket({
  code,
  label,
  icon,
  items,
  isAdmin,
  onAdd,
  onUpdate,
  onDelete,
  onToggleRunOfShoot,
  onAutoAddCast,
  busyAutoAdd,
}: {
  code: string
  label: string
  icon: string
  items: DayCostItem[]
  isAdmin: boolean
  onAdd: (description: string, vendor: string, cost: number) => void | Promise<void>
  onUpdate: (id: string, cost: number) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onToggleRunOfShoot: (id: string, current: boolean) => void | Promise<void>
  onAutoAddCast?: () => void | Promise<void>
  busyAutoAdd?: boolean
}) {
  const [desc, setDesc] = useState('')
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const subtotal = items.reduce((s, i) => s + i.total, 0)

  // Two-input descriptions: a ROLE/CHARACTER/ITEM and a PERSON/VENDOR.
  // The combination is what the producer needs to see at a glance —
  // "DP — John Smith — $300" or "SAWYER — Allison Wall — $300".
  const placeholders: Record<string, { desc: string; vendor: string }> = {
    CAST:      { desc: 'Character (e.g. SAWYER)',           vendor: 'Actor (e.g. Allison Wall)' },
    CREW:      { desc: 'Role (e.g. DP, 1st AD, mixer)',     vendor: 'Person (e.g. John Smith)' },
    EQUIPMENT: { desc: 'Item (e.g. Camera package)',        vendor: 'Vendor (e.g. Panavision)' },
    LOCATION:  { desc: 'Location (e.g. Kendrick\'s house)', vendor: 'Owner / mgr / fee source' },
    CATERING:  { desc: 'Meal (e.g. Crew lunch for 25)',     vendor: 'Caterer' },
    OTHER:     { desc: 'Description',                       vendor: 'Vendor / payee (opt.)' },
  }
  const ph = placeholders[code] ?? placeholders.OTHER

  return (
    <div className="rounded-lg border border-line/60 bg-ink/20 px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-2">
        <span className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="font-bold text-text">{label}</span>
          <span className="text-muted/70">({items.length})</span>
          {onAutoAddCast && isAdmin && (
            <button
              onClick={() => void onAutoAddCast()}
              disabled={busyAutoAdd}
              className="ml-2 text-[9px] normal-case tracking-normal text-stage-mastering hover:underline disabled:opacity-50"
              title="Add every character scheduled on this day"
            >
              {busyAutoAdd ? 'Adding…' : '+ Auto-add from scenes'}
            </button>
          )}
        </span>
        <span className="font-mono text-text font-bold">
          ${Math.round(subtotal).toLocaleString()}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((it) => (
          <DayCostRow
            key={it.id}
            item={it}
            isAdmin={isAdmin}
            onUpdate={(cost) => void onUpdate(it.id, cost)}
            onDelete={() => void onDelete(it.id)}
            onToggleRunOfShoot={() => void onToggleRunOfShoot(it.id, it.spansAllShootDays)}
          />
        ))}
        {isAdmin && (
          <div className="flex items-center gap-2 pt-1 flex-wrap sm:flex-nowrap">
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={ph.desc}
              className="flex-1 min-w-[140px] rounded bg-ink/40 border border-line text-text text-xs px-2 py-1 outline-none focus:border-stage-mastering"
            />
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder={ph.vendor}
              className="flex-1 min-w-[140px] rounded bg-ink/40 border border-line text-text text-xs px-2 py-1 outline-none focus:border-stage-mastering"
            />
            <input
              type="number"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="$"
              className="w-20 rounded bg-ink/40 border border-line text-text text-xs px-2 py-1 text-right font-mono outline-none focus:border-stage-mastering"
            />
            <button
              onClick={() => { void onAdd(desc, vendor, parseFloat(cost) || 0); setDesc(''); setVendor(''); setCost('') }}
              disabled={!desc.trim()}
              className="rounded bg-stage-mastering text-white font-bold uppercase tracking-wider text-[10px] px-2.5 py-1 disabled:opacity-50"
            >
              + Add
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DayCostRow({
  item,
  isAdmin,
  onUpdate,
  onDelete,
  onToggleRunOfShoot,
}: {
  item: DayCostItem
  isAdmin: boolean
  onUpdate: (cost: number) => void
  onDelete: () => void
  onToggleRunOfShoot: () => void
}) {
  const [cost, setCost] = useState(String(item.rate))
  useEffect(() => { setCost(String(item.rate)) }, [item.rate])

  // A run-of-shoot item appears on every day's view but is only
  // editable on the day it lives on (the "source"). On other days
  // it's read-only and visually marked.
  const isRos = item.spansAllShootDays
  const isMirror = isRos && !item.isSource
  const editable = isAdmin && !isMirror

  return (
    // flex-wrap + `basis-full` on the description block gives it its
    // own full-width line on mobile portrait, so role labels like
    // "1st AC", "Steadicam", "Wardrobe sup." aren't truncated to
    // "1st AC" / "Sted…" / "War…". On sm+ the layout collapses back
    // to a single row.
    <div className={`flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs px-2 py-1 rounded border ${
      isMirror ? 'bg-stage-mastering/5 border-stage-mastering/20' : 'bg-ink/30 border-line/40'
    }`}>
      <div className="basis-full sm:basis-auto sm:flex-1 min-w-0 order-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-text break-words sm:truncate" title={item.description}>{item.description}</span>
          {item.vendor && (
            <span className="text-muted text-[11px] break-words sm:truncate" title={item.vendor}>
              — {item.vendor}
            </span>
          )}
          {isMirror && (
            <span className="text-[9px] uppercase tracking-wider text-stage-mastering/70 italic shrink-0">
              · run of shoot (edit on source day)
            </span>
          )}
        </div>
      </div>
      {isAdmin && (
        <button
          onClick={onToggleRunOfShoot}
          disabled={isMirror}
          title={
            isMirror
              ? 'Run of shoot — edit on the source day'
              : isRos
                ? 'Currently applies to every shoot day. Click to revert to just this day.'
                : 'Click to apply this cost to every shoot day in the production'
          }
          className={`order-2 text-[10px] uppercase tracking-wider rounded-full border px-2 py-0.5 ${
            isRos
              ? 'bg-stage-mastering text-white border-stage-mastering'
              : 'text-muted border-line hover:text-stage-mastering hover:border-stage-mastering/40'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          🔁 {isRos ? 'Run of shoot' : 'Single day'}
        </button>
      )}
      <input
        type="number"
        inputMode="decimal"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        onBlur={() => { const v = parseFloat(cost) || 0; if (v !== item.rate) onUpdate(v) }}
        disabled={!editable}
        className="order-3 ml-auto sm:ml-0 w-24 text-right font-mono bg-ink/40 border border-line rounded px-2 py-1 outline-none focus:border-stage-mastering disabled:opacity-60"
      />
      {isAdmin && !isMirror && (
        <button onClick={onDelete} className="order-4 text-muted/40 hover:text-urgent px-1" title="Delete">✕</button>
      )}
    </div>
  )
}
