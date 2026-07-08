import { useEffect, useMemo, useState, useRef } from 'react'
import { api, type ApiScene, type ApiShootDay, type ApiStripboard } from '../api'
import SceneDetailModal from './SceneDetailModal'
import ScriptChangelogCard from './ScriptChangelogCard'
import AutoScheduleModal from './AutoScheduleModal'
import SceneMoveConfirm, { type SceneMoveContext } from './SceneMoveConfirm'

// When a scene gets dragged to a different day, we surface a
// SceneMoveConfirm modal listing the cost implications before the
// server-side move applies. Intra-day reorders bypass the modal.
type PendingMove = {
  ctx: SceneMoveContext
  applyToDayId: string | null
  applyToPosition: number | null // null → route through reorderScene
  reorderTargetSceneId: string | null
  reorderInsertion: 'before' | 'after' | null
}

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

// A single scene's prior position. A reorder can renumber several scenes
// at once, so an UndoEntry is a *batch* of these — one ⌘Z restores every
// scene the reorder touched, not just the dragged card.
type SceneSnapshot = { sceneId: string; shootDayId: string | null; dayPosition: number; sceneNumber: string }
type UndoEntry = { snapshots: SceneSnapshot[] }

export default function Stripboard({ projectId, isAdmin, projectName }: { projectId: string; isAdmin: boolean; projectName?: string }) {
  const [board, setBoard] = useState<ApiStripboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  // Redo stack captures the state we undid FROM so ⌘Shift+Z re-applies
  // it. Any fresh move (drag, drop, reorder) clears redo — otherwise you
  // could redo sideways into a branch that no longer makes sense.
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([])
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [jumpQuery, setJumpQuery] = useState('')
  // Destructive actions (Re-import .fdx, Re-analyze all, Auto-plan) go
  // behind this collapsed menu so an errant click can't wipe out work.
  const [dangerOpen, setDangerOpen] = useState(false)
  const jumpInputRef = useRef<HTMLInputElement | null>(null)
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
  //
  // Cross-day moves route through the SceneMoveConfirm modal so the
  // producer sees the cost implications (call-day delta for cast, new
  // location on the destination day, page count, etc.) before the move
  // commits. Intra-day moves and moves to Unscheduled apply directly.
  async function moveScene(sceneId: string, toDayId: string | null, toPosition: number) {
    const cur = boardRef.current?.scenes.find((s) => s.id === sceneId)
    const board = boardRef.current
    if (!cur || !board) return
    const isCrossDay = cur.shootDayId !== toDayId
    // Route cross-day moves TO a specific shoot day through the modal.
    // (Moves to Unscheduled don't need cost implications — the scene is
    // just leaving the schedule, no new day is being loaded up.)
    if (isCrossDay && toDayId !== null) {
      const fromDay = board.days.find((d) => d.id === cur.shootDayId) ?? null
      const toDay = board.days.find((d) => d.id === toDayId) ?? null
      setPendingMove({
        ctx: { scene: cur, fromDay, toDay, allScenes: board.scenes },
        applyToDayId: toDayId,
        applyToPosition: toPosition,
        reorderTargetSceneId: null,
        reorderInsertion: null,
      })
      return
    }
    await applyMoveDirect(sceneId, toDayId, toPosition)
  }

  async function applyMoveDirect(sceneId: string, toDayId: string | null, toPosition: number) {
    const cur = boardRef.current?.scenes.find((s) => s.id === sceneId)
    if (!cur) return
    const entry: UndoEntry = {
      snapshots: [{
        sceneId,
        shootDayId: cur.shootDayId,
        dayPosition: cur.dayPosition,
        sceneNumber: cur.number,
      }],
    }
    try {
      await api.updateScene(sceneId, { shootDayId: toDayId, dayPosition: toPosition })
      setUndoStack((stack) => [...stack.slice(-49), entry])
      setRedoStack([])
      await load()
    } catch (err) {
      console.error('move failed', err)
      setError(`Move failed: ${err instanceof Error ? err.message : 'unknown error'}. Refresh to see the current state.`)
      await load()
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
    // Cross-day drops go through the SceneMoveConfirm modal so the
    // producer sees the cost implications before the reorder applies.
    if (dragged.shootDayId !== targetDayId && targetDayId !== null) {
      const fromDay = board.days.find((d) => d.id === dragged.shootDayId) ?? null
      const toDay = board.days.find((d) => d.id === targetDayId) ?? null
      setPendingMove({
        ctx: { scene: dragged, fromDay, toDay, allScenes: board.scenes },
        applyToDayId: null,
        applyToPosition: null,
        reorderTargetSceneId: targetSceneId,
        reorderInsertion: insertion,
      })
      return
    }
    await applyReorderDirect(draggedSceneId, targetSceneId, insertion)
  }

  async function applyReorderDirect(
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
    //
    // Per-patch failures used to be swallowed with a console.error,
    // leaving the day half-migrated (some scenes at new positions,
    // others at old) with no user-visible signal. Now we tally failures
    // and surface a clear error so the user knows to reload.
    //
    // Snapshot every scene whose position we're about to change so a
    // single ⌘Z restores ALL of them. Previously we only snapshotted the
    // dragged scene, leaving the other renumbered scenes stranded at
    // their new positions after undo.
    const snapshots: SceneSnapshot[] = []
    const patches: Array<Promise<{ ok: boolean; err?: unknown }>> = []
    for (let i = 0; i < newOrder.length; i++) {
      const s = newOrder[i]
      const newPos = (i + 1) * 10
      const dayChanged = s.id === draggedSceneId && s.shootDayId !== targetDayId
      if (s.dayPosition === newPos && !dayChanged) continue
      snapshots.push({
        sceneId: s.id,
        shootDayId: s.shootDayId,
        dayPosition: s.dayPosition,
        sceneNumber: s.number,
      })
      const patch: { shootDayId?: string | null; dayPosition: number } = { dayPosition: newPos }
      if (dayChanged) patch.shootDayId = targetDayId
      patches.push(
        api.updateScene(s.id, patch)
          .then(() => ({ ok: true }))
          .catch((err) => ({ ok: false, err })),
      )
    }
    if (snapshots.length > 0) {
      setUndoStack((stack) => [...stack.slice(-49), { snapshots }])
      setRedoStack([])
    }
    const results = await Promise.all(patches)
    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      console.error('reorder patches failed', failed)
      setError(
        `${failed.length} of ${results.length} scene positions couldn't be saved. ` +
        `Some scenes may be in wrong slots — refresh to see the current state.`,
      )
    }
    await load()
  }

  // Capture the CURRENT position of each scene in a snapshot list so we
  // can build the "opposite" entry: undo saves this as its redo counterpart,
  // redo saves this as its undo counterpart. If a scene is somehow gone
  // from the board (e.g., deleted between the move and the undo), we
  // fall back to the snapshot itself — nothing to redo to, but nothing
  // crashes either.
  function captureCurrent(snapshots: SceneSnapshot[]): SceneSnapshot[] {
    const cur = boardRef.current
    return snapshots.map((snap) => {
      const s = cur?.scenes.find((x) => x.id === snap.sceneId)
      return {
        sceneId: snap.sceneId,
        shootDayId: s?.shootDayId ?? snap.shootDayId,
        dayPosition: s?.dayPosition ?? snap.dayPosition,
        sceneNumber: s?.number ?? snap.sceneNumber,
      }
    })
  }

  async function applySnapshots(snapshots: SceneSnapshot[], label: 'undo' | 'redo') {
    const results = await Promise.all(
      snapshots.map((snap) =>
        api.updateScene(snap.sceneId, {
          shootDayId: snap.shootDayId,
          dayPosition: snap.dayPosition,
        })
          .then(() => ({ ok: true as const }))
          .catch((err: unknown) => ({ ok: false as const, err })),
      ),
    )
    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      console.error(`${label} failed`, failed)
      setError(
        `${label === 'undo' ? 'Undo' : 'Redo'} couldn't restore ${failed.length} of ${results.length} scene positions. ` +
        `Refresh to see the current state.`,
      )
    }
    await load()
  }

  async function undo() {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    const redoEntry: UndoEntry = { snapshots: captureCurrent(last.snapshots) }
    setUndoStack((s) => s.slice(0, -1))
    setRedoStack((s) => [...s.slice(-49), redoEntry])
    await applySnapshots(last.snapshots, 'undo')
  }

  async function redo() {
    const last = redoStack[redoStack.length - 1]
    if (!last) return
    const undoEntry: UndoEntry = { snapshots: captureCurrent(last.snapshots) }
    setRedoStack((s) => s.slice(0, -1))
    setUndoStack((s) => [...s.slice(-49), undoEntry])
    await applySnapshots(last.snapshots, 'redo')
  }

  // Jump-to-scene handler — the `/` shortcut focuses the input; typing a
  // number + Enter opens that scene's detail modal.
  function jumpToScene(query: string) {
    const q = query.trim().toUpperCase()
    if (!q) return
    const board = boardRef.current
    if (!board) return
    // Exact match first, then prefix match. Scene numbers are strings
    // like "12", "12A", "PROLOGUE" — user just types what they see.
    const exact = board.scenes.find((s) => s.number.toUpperCase() === q)
    const match = exact ?? board.scenes.find((s) => s.number.toUpperCase().startsWith(q))
    if (match) {
      setOpenSceneId(match.id)
      setJumpQuery('')
      jumpInputRef.current?.blur()
    } else {
      setError(`No scene matches "${query}".`)
    }
  }

  // Keyboard shortcuts. See ShortcutKey at the bottom of the section
  // for the on-screen legend.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      // Esc always works — closes open scene modal or cancels a pending
      // move confirm. Doesn't need admin rights or an unfocused field.
      if (e.key === 'Escape') {
        if (openSceneId) { e.preventDefault(); setOpenSceneId(null); return }
        if (pendingMove) { e.preventDefault(); setPendingMove(null); return }
        if (autoScheduleOpen) { e.preventDefault(); setAutoScheduleOpen(false); return }
        if (document.activeElement === jumpInputRef.current) {
          e.preventDefault()
          setJumpQuery('')
          jumpInputRef.current?.blur()
          return
        }
      }

      // Modifier-based shortcuts stay active in inputs (⌘Z inside a
      // text field means "undo my typing," which the browser handles —
      // we only intercept when the focus is NOT in a field).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (inField) return
        if (!isAdmin) return
        e.preventDefault()
        if (e.shiftKey) void redo()
        else void undo()
        return
      }

      // Single-letter shortcuts must not fire while the user is typing.
      if (inField) return

      if (e.key === '/') {
        e.preventDefault()
        jumpInputRef.current?.focus()
        jumpInputRef.current?.select()
        return
      }
      if (!isAdmin) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        void addDay(false)
        return
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        void addDay(true)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isAdmin, openSceneId, pendingMove, autoScheduleOpen, undoStack, redoStack])

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
              onClick={() => void addDay(false)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-50"
              title="Add a shoot day (N)"
            >
              + Day
            </button>
            <button
              onClick={() => void addDay(true)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider text-muted border border-line rounded-full px-3 py-1.5 hover:bg-ink/40 disabled:opacity-50"
              title="Add a break day (B)"
            >
              + Break
            </button>
            {/* Danger menu — hides destructive actions (re-import,
                re-analyze, auto-plan) behind a click so they can't be
                brushed by accident. */}
            <div className="relative">
              <button
                onClick={() => setDangerOpen((v) => !v)}
                className="text-[10px] uppercase tracking-wider text-muted border border-line rounded-full px-3 py-1.5 hover:bg-ink/40"
                title="Destructive actions — re-import, re-analyze, auto-plan"
              >
                ⚠ More… {dangerOpen ? '▴' : '▾'}
              </button>
              {dangerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDangerOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 min-w-[240px] rounded-xl border border-urgent/40 bg-panel shadow-2xl p-2 space-y-1">
                    <div className="text-[9px] uppercase tracking-[0.2em] text-urgent font-bold px-2 pt-1 pb-1 border-b border-line/60">
                      ⚠ Destructive · confirm before firing
                    </div>
                    <button
                      onClick={() => { setDangerOpen(false); fileInputRef.current?.click() }}
                      disabled={importing}
                      className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-stage-stems/10 rounded disabled:opacity-50"
                    >
                      <div className="font-bold text-stage-stems">{importing ? 'Parsing…' : '↻ Re-import .fdx'}</div>
                      <div className="text-[10px] text-muted">Replaces every scene from a new .fdx upload.</div>
                    </button>
                    <button
                      onClick={() => { setDangerOpen(false); void reanalyzeAll() }}
                      disabled={busy}
                      className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-stage-mastering/10 rounded disabled:opacity-50"
                    >
                      <div className="font-bold text-stage-mastering">✨ Re-analyze all scenes</div>
                      <div className="text-[10px] text-muted">Re-runs Claude breakdown on every scene. Uses tokens.</div>
                    </button>
                    <button
                      onClick={() => { setDangerOpen(false); setAutoScheduleOpen(true) }}
                      disabled={busy || (board?.scenes.length ?? 0) === 0}
                      className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-stage-tracking/10 rounded disabled:opacity-50"
                    >
                      <div className="font-bold text-stage-tracking">✨ Auto-plan schedule</div>
                      <div className="text-[10px] text-muted">Claude replans the whole shoot. Preview + confirm before it lands.</div>
                    </button>
                    {projectName === 'Back in Your Arms' && (grouped?.unscheduled.length ?? 0) > 0 && (
                      <button
                        onClick={() => { setDangerOpen(false); void applyBiyaSchedule() }}
                        disabled={busy}
                        className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-stage-producing/10 rounded disabled:opacity-50"
                      >
                        <div className="font-bold text-stage-producing">✨ Apply BIYA schedule</div>
                        <div className="text-[10px] text-muted">Overwrites every scene's day assignment.</div>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-muted">Jump to scene:</span>
          <input
            ref={jumpInputRef}
            value={jumpQuery}
            onChange={(e) => setJumpQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); jumpToScene(jumpQuery) }
            }}
            placeholder="/  #"
            className="w-24 bg-ink/40 border border-line rounded-full px-3 py-1 text-[11px] font-mono focus:outline-none focus:border-stage-mastering placeholder:text-muted/50"
            title="Press / anywhere to focus. Enter to open the scene."
          />
        </div>
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
            onDayLocationChanged={() => void load()}
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

      {pendingMove && (
        <SceneMoveConfirm
          ctx={pendingMove.ctx}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => {
            const p = pendingMove
            setPendingMove(null)
            if (p.reorderTargetSceneId && p.reorderInsertion) {
              void applyReorderDirect(p.ctx.scene.id, p.reorderTargetSceneId, p.reorderInsertion)
            } else if (p.applyToPosition != null) {
              void applyMoveDirect(p.ctx.scene.id, p.applyToDayId, p.applyToPosition)
            }
          }}
        />
      )}
      <ShortcutKey isAdmin={isAdmin} />
    </section>
  )
}

// Docked bar at the bottom of the viewport that lists every Stripboard
// keyboard shortcut and drag-gesture. Always visible while the
// Stripboard is on screen so anyone using it — Ryan, the team, a new
// hire — can see what's available without asking. Collapsible if it's
// in the way.
function ShortcutKey({ isAdmin }: { isAdmin: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const mod = useMemo(() => {
    if (typeof navigator === 'undefined') return 'Ctrl'
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl'
  }, [])
  type Shortcut = { keys: string; label: string; adminOnly?: boolean }
  const shortcuts: Shortcut[] = [
    { keys: '/', label: 'Jump to scene #' },
    { keys: 'Click scene', label: 'Open details' },
    { keys: 'Esc', label: 'Close modal / cancel drag confirm' },
    { keys: `${mod}+Z`, label: 'Undo last move', adminOnly: true },
    { keys: `${mod}+Shift+Z`, label: 'Redo', adminOnly: true },
    { keys: 'N', label: 'Add shoot day', adminOnly: true },
    { keys: 'B', label: 'Add break day', adminOnly: true },
    { keys: 'Drag scene', label: 'Move between days (cross-day shows cost preview)', adminOnly: true },
    { keys: 'Drop L half', label: 'Insert before target scene', adminOnly: true },
    { keys: 'Drop R half', label: 'Insert after target scene', adminOnly: true },
    { keys: 'Drop on day header', label: 'Append to end of that day', adminOnly: true },
  ]
  const visible = shortcuts.filter((s) => !s.adminOnly || isAdmin)
  return (
    <div className="sticky bottom-2 left-0 right-0 z-30 mt-4 -mx-2 sm:mx-0">
      <div className="rounded-xl border border-line bg-panel/95 backdrop-blur-sm shadow-lg px-3 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold hover:text-text shrink-0"
            title={collapsed ? 'Show keyboard shortcuts' : 'Hide keyboard shortcuts'}
          >
            ⌨ Shortcuts {collapsed ? '▸' : '▾'}
          </button>
          {!collapsed && (
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] min-w-0">
              {visible.map((s) => (
                <span key={s.keys} className="flex items-center gap-1.5 shrink-0">
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ink/60 border border-line/60 text-text">
                    {s.keys}
                  </kbd>
                  <span className="text-muted">{s.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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
  onDayLocationChanged,
}: {
  day: ApiShootDay | null
  label: string
  scenes: ApiScene[]
  reorderScene: (draggedSceneId: string, targetSceneId: string, insertion: 'before' | 'after') => void
  isAdmin: boolean
  moveScene: (sceneId: string, toDayId: string | null, toPosition: number) => Promise<void>
  resolvedTod: Map<string, string>
  onOpenScene: (id: string) => void
  onDayLocationChanged?: () => void
}) {
  const [over, setOver] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const totalEighths = scenes.reduce((s, sc) => s + sc.pageEighths, 0)
  const overTarget = totalEighths > 56 // 7 pages = warn (red)
  const heavyTarget = totalEighths > 48 // 6 pages = caution (yellow)
  // Sum every scene's budgetTotal so the day header shows the running
  // scene-cost rollup. When a scene moves to another day, its cost
  // moves with it — the scene owns its priced items, days just
  // aggregate. `pricedCount` tracks how many scenes have real dollars
  // on them so the header can hint "N/M priced" instead of a bare $0
  // when the day is only partially estimated.
  const sceneCostTotal = scenes.reduce((s, sc) => s + (sc.budgetTotal || 0), 0)
  const pricedCount = scenes.filter((sc) => (sc.budgetTotal || 0) > 0).length

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
          {day && (
            <LocationTagInput
              day={day}
              onChanged={onDayLocationChanged}
            />
          )}
        </div>
        <div className={`text-[11px] font-mono flex items-center gap-2 flex-wrap justify-end ${overTarget ? 'text-urgent font-bold' : heavyTarget ? 'text-stage-overdubs' : 'text-muted'}`}>
          <span>{scenes.length} sc · {fmtEighths(totalEighths)} pages</span>
          {sceneCostTotal > 0 && !isBreak && !isUnscheduled && (
            <span
              className="text-emerald-400 font-bold"
              title={`Sum of every scene's priced budget on this day. ${pricedCount} of ${scenes.length} scenes have prices in.`}
            >
              ${Math.round(sceneCostTotal).toLocaleString()}
              {pricedCount < scenes.length && (
                <span className="text-muted/60 font-normal ml-1">
                  ({pricedCount}/{scenes.length} priced)
                </span>
              )}
            </span>
          )}
          {overTarget && <span>⚠ over</span>}
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
          {day && (
            <DayCostsSection
              shootDayId={day.id}
              isAdmin={isAdmin}
              onOpenScene={onOpenScene}
            />
          )}
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

// Inline location dropdown per day. Fixed choices for now (LA,
// Solvang — the only two locations for BIYA). We can promote this to
// a project-level list of allowed locations later when another film
// needs it.
const ALLOWED_LOCATIONS = ['LA', 'Solvang']

function LocationTagInput({ day, onChanged }: { day: ApiShootDay; onChanged?: () => void }) {
  async function save(next: string | null) {
    if (next === (day.locationTag ?? null)) return
    try {
      await api.updateShootDay(day.id, { locationTag: next })
      onChanged?.()
    } catch {}
  }
  const currentTag = day.locationTag?.trim() ?? ''
  const hasTag = currentTag.length > 0
  return (
    <select
      value={currentTag}
      onChange={(e) => { e.stopPropagation(); void save(e.target.value || null) }}
      onClick={(e) => e.stopPropagation()}
      className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border cursor-pointer appearance-none pr-4 ${
        hasTag
          ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
          : 'text-muted border-line hover:text-text bg-transparent'
      }`}
      title="Days at your home location cost no hotels or per diem."
    >
      <option value="">📍 set location</option>
      {ALLOWED_LOCATIONS.map((loc) => (
        <option key={loc} value={loc}>📍 {loc}</option>
      ))}
    </select>
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
  sourceShootDayNumber: number | null
}

const DAY_BUCKETS: Array<{ code: string; label: string; icon: string }> = [
  { code: 'CAST',      label: 'Cast on call',  icon: '🎭' },
  { code: 'CREW',      label: 'Crew',          icon: '👷' },
  { code: 'EQUIPMENT', label: 'Equipment',     icon: '🎥' },
  { code: 'LOCATION',  label: 'Locations',     icon: '📍' },
  { code: 'CATERING',  label: 'Catering',      icon: '🍽' },
  { code: 'OTHER',     label: 'Other',         icon: '🚐' },
]

type SceneRollup = { id: string; number: string; slug: string | null; itemCount: number; total: number }

function DayCostsSection({
  shootDayId,
  isAdmin,
  onOpenScene,
}: {
  shootDayId: string
  isAdmin: boolean
  onOpenScene?: (sceneId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<DayCostItem[] | null>(null)
  const [scenes, setScenes] = useState<SceneRollup[]>([])
  const [fringes, setFringes] = useState<{
    castPayrollPct: number; crewPayrollPct: number
    castPerDiemPerDay: number; crewPerDiemPerDay: number
    castHotelPerDay: number; crewHotelPerDay: number
    castPerDiemDaily: number; crewPerDiemDaily: number
    castHeadcount: number; crewHeadcount: number
    hotelCastNightly: number; hotelCrewNightly: number
    hotelContingencyPct: number
    dayHotelCost: number; needsHotels: boolean
    dayLocationTag: string | null; homeLocationTag: string | null
  } | null>(null)
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
        sourceShootDayNumber: it.sourceShootDayNumber,
      })))
      setScenes(r.scenes ?? [])
      setFringes(r.fringes ?? null)
    } catch {
      setItems([])
      setScenes([])
      setFringes(null)
    }
  }

  useEffect(() => {
    // Load on mount so the collapsed header shows the real day total
    // (day items + scene rollup + fringes + per diem + hotels), not
    // $0 until the operator expands. Runs once per day column.
    if (items === null) void load()
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

  async function updateVendor(id: string, vendor: string) {
    await api.updateBudgetItem(id, { vendor })
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

  const dayItemsTotal = (items ?? []).reduce((s, i) => s + i.total, 0)
  const sceneItemsTotal = scenes.reduce((s, r) => s + r.total, 0)
  // Fringes on this day only cover the day's own cast/crew buckets.
  // Company-wide budget totals are the source of truth — here we just
  // show the "if this day happens, what fringes/per-diem land" number
  // so producers see the real day cost.
  const dayCastItemsTotal = (items ?? []).filter((i) => (i.code ?? 'OTHER') === 'CAST').reduce((s, i) => s + i.total, 0)
  const dayCrewItemsTotal = (items ?? []).filter((i) => (i.code ?? 'OTHER') === 'CREW').reduce((s, i) => s + i.total, 0)
  const dayCastFringes = fringes ? dayCastItemsTotal * (fringes.castPayrollPct / 100) : 0
  const dayCrewFringes = fringes ? dayCrewItemsTotal * (fringes.crewPayrollPct / 100) : 0
  const dayPerDiem = fringes ? fringes.castPerDiemPerDay + fringes.crewPerDiemPerDay : 0
  const dayHotelCost = fringes?.dayHotelCost ?? 0
  const fringesTotal = dayCastFringes + dayCrewFringes + dayPerDiem + dayHotelCost
  const total = dayItemsTotal + sceneItemsTotal + fringesTotal

  return (
    <div className="border-t border-line/40 mt-2 pt-2 px-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-muted hover:text-text"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span>{expanded ? '▾' : '▸'}</span>
          <span className="font-bold">💰 Day budget</span>
          <span className="text-muted/70">
            ({(items ?? []).length} day item{(items ?? []).length === 1 ? '' : 's'}
            {scenes.length > 0 && ` · ${scenes.length} scene${scenes.length === 1 ? '' : 's'}`}
            {fringes?.needsHotels && ` · +hotels/pd`}
          </span>
          {items === null && (
            <span className="text-muted/50 normal-case italic">loading…</span>
          )}
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
            <>
              {/* Scene rollup — each scene on this day with its budget
                  total. Click a chip to open the scene modal and edit
                  its items. Costs live on the scene, so dragging the
                  scene to another day moves the cost with it. */}
              {scenes.length > 0 && (
                <div className="rounded-lg border border-line/60 bg-ink/20 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted font-bold flex items-center gap-1.5">
                      <span>🎬</span>
                      <span>Scenes on this day</span>
                    </span>
                    <span className="text-[10px] font-mono text-text/80">
                      ${Math.round(sceneItemsTotal).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {scenes.map((s) => {
                      const priced = s.total > 0
                      return (
                        <button
                          key={s.id}
                          onClick={() => onOpenScene?.(s.id)}
                          className={`text-[10px] font-mono rounded-full border px-2 py-1 transition ${
                            priced
                              ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20'
                              : 'text-muted border-line hover:border-stage-mastering/40 hover:text-text'
                          }`}
                          title={`Scene ${s.number}${s.slug ? ` — ${s.slug}` : ''} · ${s.itemCount} item${s.itemCount === 1 ? '' : 's'} · click to edit`}
                        >
                          #{s.number} {priced ? `$${Math.round(s.total).toLocaleString()}` : 'price me'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* Location + fringes + per diem + hotels. Always shown
                  on non-break days so producers see the real day cost
                  (or explicitly "home — no extras"). Read-only here;
                  edit rates in Budget → Settings. */}
              {fringes && (
                <div className="space-y-2">
                  {/* Payroll fringes */}
                  {(dayCastFringes > 0 || dayCrewFringes > 0) && (
                    <div className="rounded-lg border border-line/60 bg-ink/20 p-2 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted font-bold flex items-center gap-1.5">
                        <span>💵</span>
                        <span>Payroll fringes</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                        {dayCastFringes > 0 && (
                          <>
                            <span className="text-muted">Cast ({fringes.castPayrollPct}%)</span>
                            <span className="text-right">${Math.round(dayCastFringes).toLocaleString()}</span>
                          </>
                        )}
                        {dayCrewFringes > 0 && (
                          <>
                            <span className="text-muted">Crew ({fringes.crewPayrollPct}%)</span>
                            <span className="text-right">${Math.round(dayCrewFringes).toLocaleString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Per diem — total for this day. Formula is
                      cast_headcount × cast_daily + crew_headcount ×
                      crew_daily, but the operator only needs the total. */}
                  <div className={`rounded-lg border p-2 flex items-center justify-between gap-3 ${
                    dayPerDiem > 0 ? 'border-sky-500/40 bg-sky-500/5' : 'border-line/60 bg-ink/20'
                  }`}>
                    <div className="text-[11px] flex items-center gap-1.5">
                      <span>🍽</span>
                      <span className={`uppercase tracking-wider font-bold ${dayPerDiem > 0 ? 'text-sky-300' : 'text-muted'}`}>Per diem</span>
                      {fringes.dayLocationTag && (
                        <span className="text-muted/60">· {fringes.dayLocationTag}</span>
                      )}
                    </div>
                    {dayPerDiem > 0 ? (
                      <span className="text-sky-300 font-bold font-mono text-sm">${Math.round(dayPerDiem).toLocaleString()}</span>
                    ) : (
                      <span className="text-[11px] text-muted/70 italic">
                        {fringes.dayLocationTag ? `Home — no per diem` : 'Tag location to auto-calc'}
                      </span>
                    )}
                  </div>

                  {/* Hotels — includes contingency buffer */}
                  <div className={`rounded-lg border p-2 flex items-center justify-between gap-3 ${
                    dayHotelCost > 0 ? 'border-amber-500/50 bg-amber-500/10' : 'border-line/60 bg-ink/20'
                  }`}>
                    <div className="text-[11px] flex items-center gap-1.5">
                      <span>🏨</span>
                      <span className={`uppercase tracking-wider font-bold ${dayHotelCost > 0 ? 'text-amber-300' : 'text-muted'}`}>Hotels</span>
                      {fringes.dayLocationTag && (
                        <span className="text-muted/60">· {fringes.dayLocationTag}</span>
                      )}
                      {dayHotelCost > 0 && fringes.hotelContingencyPct > 0 && (
                        <span className="text-muted/50 normal-case">+{fringes.hotelContingencyPct}% buffer</span>
                      )}
                    </div>
                    {dayHotelCost > 0 ? (
                      <span className="text-amber-300 font-bold font-mono text-sm">${Math.round(dayHotelCost).toLocaleString()}</span>
                    ) : (
                      <span className="text-[11px] text-muted/70 italic">
                        {fringes.dayLocationTag ? `Home — no hotels` : 'Tag location to auto-calc'}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {DAY_BUCKETS.map((bucket) => (
                <DayBucket
                  key={bucket.code}
                  code={bucket.code}
                  label={bucket.label}
                  icon={bucket.icon}
                  items={items.filter((i) => (i.code ?? 'OTHER') === bucket.code)}
                  isAdmin={isAdmin}
                  onAdd={(desc, vendor, cost) => add(bucket.code, desc, vendor, cost)}
                  onUpdate={updateCost}
                  onUpdateVendor={updateVendor}
                  onDelete={remove}
                  onToggleRunOfShoot={toggleRunOfShoot}
                  onAutoAddCast={bucket.code === 'CAST' ? autoAddCast : undefined}
                  busyAutoAdd={busy}
                />
              ))}
            </>
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
  onUpdateVendor,
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
  onUpdateVendor: (id: string, vendor: string) => void | Promise<void>
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
            onUpdateVendor={(v) => void onUpdateVendor(it.id, v)}
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
  onUpdateVendor,
  onDelete,
  onToggleRunOfShoot,
}: {
  item: DayCostItem
  isAdmin: boolean
  onUpdate: (cost: number) => void
  onUpdateVendor: (vendor: string) => void
  onDelete: () => void
  onToggleRunOfShoot: () => void
}) {
  const [cost, setCost] = useState(String(item.rate))
  useEffect(() => { setCost(String(item.rate)) }, [item.rate])
  const [vendor, setVendor] = useState(item.vendor ?? '')
  useEffect(() => { setVendor(item.vendor ?? '') }, [item.vendor])

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
          {/* Editable person / vendor name — click to type. Placeholder
              "who?" prompts producers to fill it in as they hire. */}
          {editable ? (
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              onBlur={() => { if ((vendor.trim() || null) !== (item.vendor ?? null)) onUpdateVendor(vendor.trim()) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder="who?"
              className={`text-[11px] bg-transparent border-b border-dashed border-line/60 focus:border-stage-mastering focus:outline-none px-1 min-w-[8ch] ${
                vendor ? 'text-muted' : 'text-muted/40 italic'
              }`}
              style={{ width: `${Math.max(vendor.length + 2, 8)}ch` }}
              title="Attach a person's name — filled in as you hire."
            />
          ) : item.vendor ? (
            <span className="text-muted text-[11px] break-words sm:truncate" title={item.vendor}>
              — {item.vendor}
            </span>
          ) : null}
          {isMirror && (
            <span className="text-[9px] uppercase tracking-wider text-stage-mastering/70 italic shrink-0">
              · run of shoot{item.sourceShootDayNumber != null ? ` (edit on day ${item.sourceShootDayNumber})` : ' (edit on source day)'}
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
              ? `Run of shoot — edit on day ${item.sourceShootDayNumber ?? '?'}`
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
