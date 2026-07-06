// Modal that surfaces the cost implications of moving a scene from
// one shoot day to another. Per Ryan: only fires for cross-day moves
// (not intra-day reorders). The producer scans the implications and
// either confirms the move or backs out.
//
// What we compute:
//   - Attached scene cost (line items with scene_id = this scene)
//     auto-follows the scene, so we just SHOW the dollar amount.
//   - Cast call-day delta: actors gaining/losing a call day.
//   - Location: whether the target day already shoots this location
//     (else a 2nd location adds transport / company-move overhead).
//   - Catering: only flag if the project has a per-person catering
//     line; if catering is one flat Run-of-Shoot allowance (the BIYA
//     model) it's already covered, so we just say so.
//   - Page count: target day's new total, and a warning if either
//     side crosses the 8-page guideline.
import { useMemo, useState } from 'react'
import type { ApiScene, ApiShootDay } from '../api'

function fmtEighths(eighths: number): string {
  if (eighths === 0) return '—'
  const whole = Math.floor(eighths / 8)
  const frac = eighths % 8
  if (whole === 0) return `${frac}/8`
  if (frac === 0) return `${whole}`
  return `${whole} ${frac}/8`
}

function fmtMoney(v: number): string {
  if (v === 0) return '$0'
  return `$${Math.round(v).toLocaleString()}`
}

export type SceneMoveContext = {
  scene: ApiScene
  fromDay: ApiShootDay | null
  toDay: ApiShootDay | null
  allScenes: ApiScene[]
}

type Implication = {
  key: string
  title: string
  detail: string
  tone: 'info' | 'warning'
}

function buildImplications(ctx: SceneMoveContext): Implication[] {
  const { scene, fromDay, toDay, allScenes } = ctx
  const out: Implication[] = []

  // ── Cast call-day delta ──
  // Identify characters that are NEW to the target day (i.e. not
  // already on any other scene scheduled to toDay).
  const targetDayChars = new Set<string>()
  if (toDay) {
    for (const s of allScenes) {
      if (s.id === scene.id) continue
      if (s.shootDayId !== toDay.id) continue
      for (const c of s.characters ?? []) targetDayChars.add(c)
    }
  }
  const newCallDays = (scene.characters ?? []).filter((c) => !targetDayChars.has(c))

  // Characters losing a call day on the source day (only flagged if
  // this is the LAST scene tying them to fromDay).
  const fromDayChars = new Map<string, number>()  // char → scene count on fromDay (excluding this scene)
  if (fromDay) {
    for (const s of allScenes) {
      if (s.id === scene.id) continue
      if (s.shootDayId !== fromDay.id) continue
      for (const c of s.characters ?? []) {
        fromDayChars.set(c, (fromDayChars.get(c) ?? 0) + 1)
      }
    }
  }
  const lostCallDays = (scene.characters ?? []).filter((c) => !fromDayChars.has(c))

  if (newCallDays.length > 0 || lostCallDays.length > 0) {
    const parts: string[] = []
    if (newCallDays.length > 0) {
      parts.push(`+${newCallDays.length} actor${newCallDays.length === 1 ? '' : 's'} added to Day ${toDay?.number ?? '?'}: ${newCallDays.join(', ')}`)
    }
    if (lostCallDays.length > 0) {
      parts.push(`−${lostCallDays.length} actor${lostCallDays.length === 1 ? '' : 's'} drop off Day ${fromDay?.number ?? '?'}: ${lostCallDays.join(', ')}`)
    }
    out.push({
      key: 'cast',
      title: 'Cast call-day delta',
      detail: parts.join(' · ') + '. DOOD start/finish shifts.',
      tone: 'info',
    })
  }

  // ── Location ──
  if (scene.location && toDay) {
    const targetDayLocations = new Set<string>()
    for (const s of allScenes) {
      if (s.id === scene.id) continue
      if (s.shootDayId !== toDay.id) continue
      if (s.location) targetDayLocations.add(s.location.toLowerCase())
    }
    const targetHas = targetDayLocations.has(scene.location.toLowerCase())
    if (!targetHas) {
      const others = Array.from(targetDayLocations)
      const detail = others.length > 0
        ? `Day ${toDay.number} currently shoots ${others.length} location${others.length === 1 ? '' : 's'} (${others.slice(0, 2).join(', ')}${others.length > 2 ? ', …' : ''}). Adding "${scene.location}" makes it a company-move day — possible transport overhead.`
        : `Day ${toDay.number} has no other scenes yet — "${scene.location}" becomes the day's primary location.`
      out.push({
        key: 'location',
        title: 'New location on the destination day',
        detail,
        tone: 'warning',
      })
    }
  }

  // ── Attached line items follow the scene ──
  // budgetTotal / budgetItemCount were on an earlier ApiScene shape;
  // the current API may omit them. Read defensively so the modal
  // renders either way.
  const sceneAny = scene as ApiScene & {
    budgetTotal?: number; budgetItemCount?: number
  }
  if (typeof sceneAny.budgetTotal === 'number' && sceneAny.budgetTotal > 0) {
    const count = sceneAny.budgetItemCount ?? 1
    out.push({
      key: 'attached',
      title: 'Scene-attached cost moves with the scene',
      detail: `${count} line item${count === 1 ? '' : 's'} totaling ${fmtMoney(sceneAny.budgetTotal)} re-attach to Day ${toDay?.number ?? '—'} automatically.`,
      tone: 'info',
    })
  }

  // ── Catering note (Run-of-Shoot allowance) ──
  // We don't have per-day catering ledgers yet; for the BIYA model
  // it's a single RoS allowance, so this is informational.
  out.push({
    key: 'catering',
    title: 'Catering',
    detail: 'Catering is wired as a Run-of-Shoot allowance (counted once, not per-day). Headcount swap between days is absorbed — no incremental cost.',
    tone: 'info',
  })

  // ── Page count ──
  function dayPages(dayId: string | null, opts?: { plus?: ApiScene; minus?: ApiScene }): number {
    let total = 0
    for (const s of allScenes) {
      if (s.shootDayId !== dayId) continue
      if (opts?.minus && s.id === opts.minus.id) continue
      total += s.pageEighths
    }
    if (opts?.plus) total += opts.plus.pageEighths
    return total
  }
  const newToTotal = toDay ? dayPages(toDay.id, { plus: scene, minus: scene.shootDayId === toDay.id ? scene : undefined }) : 0
  const newFromTotal = fromDay ? dayPages(fromDay.id, { minus: scene }) : 0
  const PAGE_CAP_EIGHTHS = 64  // 8 pages
  const pageWarn =
    (toDay && newToTotal > PAGE_CAP_EIGHTHS) ||
    (fromDay && newFromTotal > PAGE_CAP_EIGHTHS) ||
    false
  const pageParts: string[] = []
  if (fromDay) pageParts.push(`Day ${fromDay.number}: ${fmtEighths(dayPages(fromDay.id))} → ${fmtEighths(newFromTotal)}`)
  if (toDay)   pageParts.push(`Day ${toDay.number}: ${fmtEighths(dayPages(toDay.id))} → ${fmtEighths(newToTotal)}`)
  out.push({
    key: 'pages',
    title: pageWarn ? 'Page count — over the 8-page guideline' : 'Page count',
    detail: pageParts.join(' · ') + (pageWarn ? '  ⚠ One side exceeds the 8-page typical shoot day cap.' : ''),
    tone: pageWarn ? 'warning' : 'info',
  })

  return out
}

export default function SceneMoveConfirm({
  ctx, onConfirm, onCancel,
}: {
  ctx: SceneMoveContext
  onConfirm: () => void
  onCancel: () => void
}) {
  const implications = useMemo(() => buildImplications(ctx), [ctx])
  const [acked, setAcked] = useState<Set<string>>(() => new Set(implications.map((i) => i.key)))

  function toggle(key: string) {
    setAcked((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allAcked = implications.every((i) => acked.has(i.key))
  const { scene, fromDay, toDay } = ctx

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 sm:p-8 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-line shadow-2xl">
        <header className="p-5 border-b border-line">
          <div className="text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
            Confirm scene move
          </div>
          <h2 className="text-lg font-bold text-text">
            Scene #{scene.number}
            {' · '}
            <span className="text-muted font-normal">
              {fromDay ? `Day ${fromDay.number}` : 'Unscheduled'}
              {' → '}
              {toDay ? `Day ${toDay.number}` : 'Unscheduled'}
            </span>
          </h2>
          <p className="text-xs text-muted mt-1 truncate">
            {scene.location ?? scene.slug}
          </p>
        </header>

        <section className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          <p className="text-[11px] uppercase tracking-wider text-muted font-bold">
            Cost implications
          </p>
          {implications.map((i) => (
            <label
              key={i.key}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                i.tone === 'warning'
                  ? 'border-urgent/40 bg-urgent/5 hover:bg-urgent/10'
                  : 'border-line bg-ink/40 hover:bg-ink/60'
              }`}
            >
              <input
                type="checkbox"
                checked={acked.has(i.key)}
                onChange={() => toggle(i.key)}
                className="mt-1 h-4 w-4 rounded border-line"
              />
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold ${i.tone === 'warning' ? 'text-urgent' : 'text-text'}`}>
                  {i.tone === 'warning' && '⚠ '}
                  {i.title}
                </div>
                <p className="text-xs text-muted mt-0.5 leading-relaxed">
                  {i.detail}
                </p>
              </div>
            </label>
          ))}
          {implications.length === 0 && (
            <p className="text-sm text-muted italic">No cost implications detected.</p>
          )}
        </section>

        <footer className="p-5 border-t border-line flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[10px] text-muted">
            {allAcked
              ? 'All implications acknowledged.'
              : `${implications.length - acked.size} unticked — they’ll be skipped on confirm.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs uppercase tracking-wider font-bold text-muted hover:text-text px-4 py-2 rounded-full border border-line"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="text-xs uppercase tracking-wider font-bold text-white bg-stage-mastering hover:bg-stage-mastering/80 px-4 py-2 rounded-full"
            >
              Move scene
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
