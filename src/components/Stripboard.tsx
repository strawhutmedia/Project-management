import { useEffect, useMemo, useState, useRef } from 'react'
import { api, type ApiScene, type ApiShootDay, type ApiStripboard } from '../api'
import SceneDetailModal from './SceneDetailModal'
import ScriptChangelogCard from './ScriptChangelogCard'

type ScriptArchive = {
  id: string
  fileName: string | null
  byteSize: number
  sceneCount: number
  uploadedAt: string
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
  const [archive, setArchive] = useState<ScriptArchive | null>(null)
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

  useEffect(() => {
    void load()
    void loadArchive()
  }, [projectId])

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

      <div className="space-y-2">
        <DayRow
          day={null}
          label="UNSCHEDULED"
          scenes={grouped?.unscheduled ?? []}
          isAdmin={isAdmin}
          moveScene={moveScene}
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
            resolvedTod={resolvedTod}
            onOpenScene={setOpenSceneId}
          />
        ))}
      </div>

      {openSceneId && (
        <SceneDetailModal
          sceneId={openSceneId}
          scene={board.scenes.find((s) => s.id === openSceneId) ?? null}
          isAdmin={isAdmin}
          onClose={() => setOpenSceneId(null)}
          onChanged={() => void load()}
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
  resolvedTod,
  onOpenScene,
}: {
  day: ApiShootDay | null
  label: string
  scenes: ApiScene[]
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
    await moveScene(sceneId, day?.id ?? null, scenes.length)
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
                />
              ))}
            </div>
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
}: {
  scene: ApiScene
  isAdmin: boolean
  resolvedTod: string
  onOpen: () => void
}) {
  const kind = stripKind(scene, resolvedTod)
  const style = STRIP_STYLE[kind]
  const hasBudget = scene.budgetItemCount > 0
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={isAdmin}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/scene-id', scene.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`relative text-left aspect-square rounded-2xl ring-1 ring-white/10 overflow-hidden ${style.card} ${
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
