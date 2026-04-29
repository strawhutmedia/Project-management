import { useEffect, useMemo, useState, useRef } from 'react'
import { api, type ApiScene, type ApiShootDay, type ApiStripboard } from '../api'

const STRIP_COLOR: Record<string, string> = {
  EXT_DAY: 'bg-yellow-100 text-yellow-900 border-yellow-300',
  INT_DAY: 'bg-white text-text border-line',
  EXT_NIGHT: 'bg-emerald-700 text-white border-emerald-800',
  INT_NIGHT: 'bg-blue-700 text-white border-blue-800',
  SUNSET: 'bg-orange-200 text-orange-900 border-orange-400',
  DEFAULT: 'bg-panel text-text border-line',
}

function stripColor(s: ApiScene): string {
  const ie = s.intExt
  const tod = (s.timeOfDay || '').toUpperCase()
  if (tod.startsWith('SUNSET') || tod.startsWith('SUNRISE') || tod.startsWith('MAGIC')) return STRIP_COLOR.SUNSET
  if (tod.includes('NIGHT')) return ie === 'EXT' ? STRIP_COLOR.EXT_NIGHT : STRIP_COLOR.INT_NIGHT
  if (tod.includes('DAY') || tod.includes('MORNING') || tod.includes('AFTERNOON')) {
    return ie === 'EXT' ? STRIP_COLOR.EXT_DAY : STRIP_COLOR.INT_DAY
  }
  return STRIP_COLOR.DEFAULT
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

      <div className="overflow-x-auto -mx-3 px-3 pb-2">
        <div className="flex gap-3 min-w-max">
          <DayColumn
            day={null}
            label="UNSCHEDULED"
            scenes={grouped?.unscheduled ?? []}
            isAdmin={isAdmin}
            onSceneMoved={load}
          />
          {board.days.map((day) => (
            <DayColumn
              key={day.id}
              day={day}
              label={day.isBreak ? `BREAK · DAY ${day.number}` : `DAY ${day.number}`}
              scenes={grouped?.byDay.get(day.id) ?? []}
              isAdmin={isAdmin}
              onSceneMoved={load}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function DayColumn({
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
  const totalEighths = scenes.reduce((s, sc) => s + sc.pageEighths, 0)
  const overTarget = totalEighths > 56 // 7 pages = warn

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

  return (
    <div
      onDragOver={(e) => { if (isAdmin) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => isAdmin && void handleDrop(e)}
      className={`w-72 flex-shrink-0 rounded-xl border ${over ? 'border-stage-mastering bg-stage-mastering/10' : 'border-line bg-ink/30'} transition`}
    >
      <div className={`px-3 py-2 border-b border-line/40 ${day?.isBreak ? 'bg-line/20' : ''}`}>
        <div className="flex items-baseline justify-between gap-2">
          <div className={`text-[10px] uppercase tracking-wider font-bold ${day?.isBreak ? 'text-muted' : 'text-stage-mastering'}`}>{label}</div>
          <div className={`text-[10px] font-mono ${overTarget ? 'text-urgent' : 'text-muted'}`}>
            {scenes.length}sc · {fmtEighths(totalEighths)}p
          </div>
        </div>
        {day?.shootDate && <div className="text-[10px] text-muted mt-0.5">{day.shootDate}</div>}
      </div>
      <div className="p-2 space-y-1.5 min-h-[40px]">
        {scenes.length === 0 && (
          <div className="text-[10px] text-muted/60 italic text-center py-3">
            {day === null ? 'All scheduled ✓' : 'Drop scenes here'}
          </div>
        )}
        {scenes.map((s) => (
          <SceneStrip key={s.id} scene={s} isAdmin={isAdmin} />
        ))}
      </div>
    </div>
  )
}

function SceneStrip({ scene, isAdmin }: { scene: ApiScene; isAdmin: boolean }) {
  const color = stripColor(scene)
  return (
    <div
      draggable={isAdmin}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/scene-id', scene.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`rounded border ${color} px-2 py-1.5 text-[11px] ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} hover:shadow-sm transition`}
      title={scene.slug}
    >
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="font-mono font-bold text-[10px]">#{scene.number}</span>
        <span className="text-[9px] font-mono opacity-80">{fmtEighths(scene.pageEighths)}p</span>
      </div>
      <div className="font-bold uppercase tracking-tight leading-tight truncate" title={scene.location ?? ''}>
        {scene.location || scene.slug}
      </div>
      <div className="flex items-baseline justify-between gap-1 mt-0.5">
        <span className="text-[9px] uppercase tracking-wider opacity-80">
          {scene.intExt ?? ''} {scene.timeOfDay ?? ''}
        </span>
        {scene.characters.length > 0 && (
          <span className="text-[9px] font-mono opacity-70 truncate" title={scene.characters.join(', ')}>
            {scene.characters.slice(0, 3).join('·')}{scene.characters.length > 3 ? `+${scene.characters.length - 3}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
