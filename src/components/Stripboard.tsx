import { useEffect, useMemo, useState, useRef } from 'react'
import { api, type ApiScene, type ApiShootDay, type ApiStripboard } from '../api'

// Strip styles tuned for the dark Slate UI. Each strip is a dark card with
// a colored left stripe + colored "INT/EXT · TIME" label, so text is always
// readable. The stripe is the at-a-glance type indicator (industry-standard
// colors: yellow=EXT day, off-white=INT day, blue=INT night, emerald=EXT
// night, amber=sunset/magic hour).
type StripKind = 'EXT_DAY' | 'INT_DAY' | 'EXT_NIGHT' | 'INT_NIGHT' | 'SUNSET' | 'DEFAULT'

// Each scene card gets a fun, saturated gradient by INT/EXT + time of day,
// so the schedule reads like a colorful mood board at a glance.
//   EXT DAY    — sunny gold / orange
//   INT DAY    — warm peach / pink (cozy lit interior)
//   EXT NIGHT  — deep emerald / teal (moonlit outdoors)
//   INT NIGHT  — indigo / sky (lamp-lit interior at night)
//   SUNSET     — orange → pink → fuchsia (magic hour)
//   DEFAULT    — slate (no time-of-day metadata)
const STRIP_STYLE: Record<StripKind, { stripe: string; label: string; card: string }> = {
  EXT_DAY:   { stripe: 'bg-amber-200',  label: 'text-amber-100',   card: 'bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500' },
  INT_DAY:   { stripe: 'bg-rose-200',   label: 'text-rose-100',    card: 'bg-gradient-to-br from-rose-400 via-pink-500 to-orange-400' },
  EXT_NIGHT: { stripe: 'bg-emerald-300', label: 'text-emerald-100', card: 'bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800' },
  INT_NIGHT: { stripe: 'bg-sky-300',    label: 'text-sky-100',     card: 'bg-gradient-to-br from-sky-600 via-blue-700 to-indigo-800' },
  SUNSET:    { stripe: 'bg-orange-200', label: 'text-orange-100',  card: 'bg-gradient-to-br from-orange-500 via-pink-500 to-fuchsia-600' },
  DEFAULT:   { stripe: 'bg-line',       label: 'text-white/70',    card: 'bg-gradient-to-br from-slate-600 to-slate-800' },
}

function stripKind(s: ApiScene): StripKind {
  const ie = s.intExt
  const tod = (s.timeOfDay || '').toUpperCase()
  if (tod.startsWith('SUNSET') || tod.startsWith('SUNRISE') || tod.startsWith('MAGIC')) return 'SUNSET'
  if (tod.includes('NIGHT')) return ie === 'EXT' ? 'EXT_NIGHT' : 'INT_NIGHT'
  if (tod.includes('DAY') || tod.includes('MORNING') || tod.includes('AFTERNOON')) {
    return ie === 'EXT' ? 'EXT_DAY' : 'INT_DAY'
  }
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

export default function Stripboard({ projectId, isAdmin, projectName }: { projectId: string; isAdmin: boolean; projectName?: string }) {
  const [board, setBoard] = useState<ApiStripboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function load() {
    try {
      const data = await api.stripboard(projectId)
      setBoard(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => { void load() }, [projectId])

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
      await api.importFdx(projectId, xml)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎬 Stripboard</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            {board.scenes.length} scenes · {fmtEighths(totalEighths)} pages total ·
            {' '}{fmtEighths(scheduledEighths)} scheduled · {board.days.filter((d) => !d.isBreak).length} shoot days
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
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
          onSceneMoved={load}
        />
        {board.days.map((day) => (
          <DayRow
            key={day.id}
            day={day}
            label={day.isBreak ? `BREAK · DAY ${day.number}` : `DAY ${day.number}`}
            scenes={grouped?.byDay.get(day.id) ?? []}
            isAdmin={isAdmin}
            onSceneMoved={load}
          />
        ))}
      </div>
    </section>
  )
}

function DayRow({
  day,
  label,
  scenes,
  isAdmin,
  onSceneMoved,
}: {
  day: ApiShootDay | null
  label: string
  scenes: ApiScene[]
  isAdmin: boolean
  onSceneMoved: () => void | Promise<void>
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
    try {
      await api.updateScene(sceneId, {
        shootDayId: day?.id ?? null,
        dayPosition: scenes.length,
      })
      await onSceneMoved()
    } catch (err) {
      console.error('move failed', err)
    }
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
                <SceneCard key={s.id} scene={s} isAdmin={isAdmin} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SceneCard({ scene, isAdmin }: { scene: ApiScene; isAdmin: boolean }) {
  const kind = stripKind(scene)
  const style = STRIP_STYLE[kind]
  return (
    <div
      draggable={isAdmin}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/scene-id', scene.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`relative aspect-square rounded-2xl ring-1 ring-white/10 overflow-hidden ${style.card} ${
        isAdmin ? 'cursor-grab active:cursor-grabbing' : ''
      } hover:ring-white/40 hover:shadow-xl hover:scale-[1.02] transition flex flex-col text-white shadow-md`}
      title={scene.slug}
    >
      {/* Inner gloss for a little dimension */}
      <div className={`h-1 w-full ${style.stripe} opacity-90`} />

      <div className="flex-1 flex flex-col px-3 py-2.5 min-h-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono font-bold text-base text-white drop-shadow">#{scene.number}</span>
          <span className="text-[10px] font-mono text-white/70">{fmtEighths(scene.pageEighths)}p</span>
        </div>

        <div
          className="mt-1 font-bold uppercase tracking-tight leading-tight text-white text-[11px] line-clamp-3 break-words drop-shadow-sm"
          title={scene.location ?? ''}
        >
          {scene.location || scene.slug}
        </div>

        <div className="mt-auto pt-1 space-y-0.5">
          <div className="text-[9px] uppercase tracking-wider font-bold text-white/90 truncate">
            {scene.intExt ?? ''} {scene.timeOfDay ?? ''}
          </div>
          {scene.characters.length > 0 && (
            <div className="text-[9px] font-mono text-white/70 truncate" title={scene.characters.join(', ')}>
              {scene.characters.slice(0, 3).join('·')}{scene.characters.length > 3 ? `+${scene.characters.length - 3}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
