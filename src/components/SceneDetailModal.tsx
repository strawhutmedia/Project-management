// Per-scene detail + budget breakdown.
//
// Lists everything Claude pulled out of the script for this scene, grouped
// by category (Cast / Props / Wardrobe / Location / SFX / VFX / Vehicles /
// etc.). Each row has an inline "$" input so the producer can attach a
// number. Producer can add rows, edit descriptions, delete, and re-run the
// breakdown to refresh from the script.
import { useEffect, useState } from 'react'
import { api, type ApiBudgetLineItem, type ApiScene } from '../api'

// Category buckets in the order the producer would walk a real breakdown
// sheet. Claude tags rows with the bucket via the `code` field on the
// line item.
const BUCKET_ORDER = [
  'DAY_PLAYER',
  'EXTRAS',
  'STUNTS',
  'LOCATION',
  'PERMITS',
  'PROPS',
  'WARDROBE',
  'MAKEUP',
  'HAIR',
  'SET_DRESSING',
  'PICTURE_CARS',
  'VEHICLES',
  'WEAPONS',
  'ANIMALS',
  'SFX',
  'VFX',
  'EQUIPMENT',
  'CATERING',
  'OTHER',
] as const

type Bucket = (typeof BUCKET_ORDER)[number]

const BUCKET_LABEL: Record<Bucket, string> = {
  DAY_PLAYER: 'Cast — Day Players',
  EXTRAS: 'Extras / Background',
  STUNTS: 'Stunts',
  LOCATION: 'Location',
  PERMITS: 'Permits',
  PROPS: 'Props',
  WARDROBE: 'Wardrobe',
  MAKEUP: 'Makeup',
  HAIR: 'Hair',
  SET_DRESSING: 'Set Dressing',
  PICTURE_CARS: 'Picture Cars',
  VEHICLES: 'Production Vehicles',
  WEAPONS: 'Weapons / Armorer',
  ANIMALS: 'Animals',
  SFX: 'SFX (practical)',
  VFX: 'VFX (post)',
  EQUIPMENT: 'Special Equipment',
  CATERING: 'Catering',
  OTHER: 'Other',
}

const BUCKET_ICON: Record<Bucket, string> = {
  DAY_PLAYER: '🎭',
  EXTRAS: '👥',
  STUNTS: '🤸',
  LOCATION: '📍',
  PERMITS: '📜',
  PROPS: '🎯',
  WARDROBE: '👔',
  MAKEUP: '💄',
  HAIR: '💇',
  SET_DRESSING: '🪑',
  PICTURE_CARS: '🚗',
  VEHICLES: '🚐',
  WEAPONS: '🔫',
  ANIMALS: '🐕',
  SFX: '💥',
  VFX: '✨',
  EQUIPMENT: '🎥',
  CATERING: '🍽',
  OTHER: '📦',
}

function bucketOf(code: string | null): Bucket {
  const k = (code ?? '').toUpperCase() as Bucket
  return BUCKET_ORDER.includes(k) ? k : 'OTHER'
}

type SceneItem = ApiBudgetLineItem & { accountId: string }

export default function SceneDetailModal({
  sceneId,
  scene,
  isAdmin,
  onClose,
  onChanged,
}: {
  sceneId: string
  scene: ApiScene | null
  isAdmin: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<SceneItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  async function loadItems() {
    if (!scene) return
    try {
      const projectId = await projectIdOf(scene.id)
      const r = await api.budget(projectId)
      const all: SceneItem[] = []
      for (const acc of r.budget.accounts) {
        for (const li of acc.lineItems) {
          if (li.sceneId === sceneId) {
            all.push({ ...li, accountId: acc.id })
          }
        }
      }
      setItems(all)
    } catch (err) {
      // If no budget yet, just show empty list. The breakdown call will
      // create one on the fly.
      const msg = err instanceof Error ? err.message : 'failed'
      if (msg.includes('no_budget') || msg.includes('404')) {
        setItems([])
      } else {
        setError(msg)
      }
    }
  }

  useEffect(() => { void loadItems() }, [sceneId])

  async function runBreakdown() {
    setAnalyzing(true)
    setError(null)
    try {
      await api.sceneBreakdown(sceneId)
      await loadItems()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'breakdown failed')
    } finally {
      setAnalyzing(false)
    }
  }

  async function updateItem(itemId: string, patch: Parameters<typeof api.updateBudgetItem>[1]) {
    await api.updateBudgetItem(itemId, patch)
    await loadItems()
    onChanged()
  }

  async function deleteItem(itemId: string) {
    await api.deleteBudgetItem(itemId)
    await loadItems()
    onChanged()
  }

  if (!scene) return null

  const grouped = new Map<Bucket, SceneItem[]>()
  for (const it of items ?? []) {
    const b = bucketOf(it.code)
    const arr = grouped.get(b) ?? []
    arr.push(it)
    grouped.set(b, arr)
  }
  const total = (items ?? []).reduce((s, i) => s + i.total, 0)
  const pricedCount = (items ?? []).filter((i) => i.total > 0).length

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 bg-panel/95 backdrop-blur border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted font-bold mb-1">
              Scene {scene.number}
              {scene.page && ` · pg ${scene.page}`}
            </div>
            <div className="font-bold text-text leading-tight">{scene.slug}</div>
            {scene.characters.length > 0 && (
              <div className="text-[11px] text-muted mt-1">
                Cast: <span className="font-mono">{scene.characters.join(' · ')}</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-xl px-2 shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Breakdown header + action */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-text">Script Breakdown</h3>
              <p className="text-[11px] text-muted mt-0.5">
                Claude scans the scene and lists anything that might cost money,
                grouped by category. You attach the dollar amounts.
                {scene.breakdownRunAt
                  ? ` · Last run ${new Date(scene.breakdownRunAt).toLocaleDateString()}`
                  : ' · Not analyzed yet'}
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => void runBreakdown()}
                disabled={analyzing}
                className="rounded-full text-[10px] uppercase tracking-wider font-bold text-white bg-gradient-to-r from-stage-mastering to-stage-tracking px-3 py-1.5 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing…' : scene.breakdownRunAt ? '↻ Re-analyze' : '✨ Analyze scene'}
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">
              {error}
            </div>
          )}

          {/* Items grouped by bucket */}
          {items === null ? (
            <p className="text-muted text-xs italic">Loading…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-line/60 rounded-xl">
              <p className="text-muted text-sm italic">
                No breakdown yet for this scene.
              </p>
              {scene.actionText
                ? <p className="text-[11px] text-muted/70 mt-1">Click "Analyze scene" to have Claude scan it.</p>
                : <p className="text-[11px] text-muted/70 mt-1">No action text — re-import the .fdx to enable analysis.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {BUCKET_ORDER.map((b) => {
                const arr = grouped.get(b)
                if (!arr || arr.length === 0) return null
                const bucketTotal = arr.reduce((s, i) => s + i.total, 0)
                return (
                  <div key={b} className="rounded-xl border border-line/60 bg-ink/30 overflow-hidden">
                    <div className="px-3 py-2 bg-ink/50 flex items-center justify-between">
                      <div className="text-[11px] uppercase tracking-wider font-bold text-text flex items-center gap-2">
                        <span>{BUCKET_ICON[b]}</span>
                        <span>{BUCKET_LABEL[b]}</span>
                        <span className="text-muted/60 font-normal">({arr.length})</span>
                      </div>
                      <div className="text-[11px] font-mono font-bold text-text">
                        {bucketTotal > 0 ? `$${Math.round(bucketTotal).toLocaleString()}` : <span className="text-muted/60 font-normal">no $ yet</span>}
                      </div>
                    </div>
                    <div className="divide-y divide-line/30">
                      {arr.map((it) => (
                        <SceneItemRow
                          key={it.id}
                          item={it}
                          isAdmin={isAdmin}
                          onUpdate={(patch) => updateItem(it.id, patch)}
                          onDelete={() => deleteItem(it.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {items && items.length > 0 && (
            <div className="flex items-center justify-between border-t border-line/40 pt-3">
              <div className="text-[11px] text-muted">
                {items.length} items · {pricedCount} priced
              </div>
              <div className="text-base font-mono font-bold text-text">
                Scene total: ${Math.round(total).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Look up the project id for a scene via the stripboard list. Lightweight —
// the modal already has the scene prop, but we need projectId to fetch the
// budget. Cached at module scope.
const projectIdCache = new Map<string, string>()
async function projectIdOf(sceneId: string): Promise<string> {
  const cached = projectIdCache.get(sceneId)
  if (cached) return cached
  // The scene id maps to one project. Walk known projects (cheap — one
  // call) to find the parent. Falls back to the project listed in the
  // current URL if present, which is the common case.
  const m = window.location.pathname.match(/\/project\/([^/?#]+)/)
  if (m) {
    projectIdCache.set(sceneId, m[1])
    return m[1]
  }
  throw new Error('cannot resolve projectId for scene')
}

function SceneItemRow({
  item,
  isAdmin,
  onUpdate,
  onDelete,
}: {
  item: ApiBudgetLineItem
  isAdmin: boolean
  onUpdate: (patch: Parameters<typeof api.updateBudgetItem>[1]) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [description, setDescription] = useState(item.description)
  const [amt, setAmt] = useState(String(item.amt))
  const [rate, setRate] = useState(String(item.rate))
  const [x, setX] = useState(String(item.x))
  const [notes, setNotes] = useState(item.notes ?? '')

  useEffect(() => {
    setDescription(item.description)
    setAmt(String(item.amt))
    setRate(String(item.rate))
    setX(String(item.x))
    setNotes(item.notes ?? '')
  }, [item.id, item.description, item.amt, item.rate, item.x, item.notes])

  const computedTotal = (parseFloat(amt) || 0) * (parseFloat(x) || 0) * (parseFloat(rate) || 0)

  return (
    <div className="px-3 py-2 group flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== item.description && void onUpdate({ description })}
          disabled={!isAdmin}
          className="w-full bg-transparent text-sm text-text outline-none border-b border-transparent focus:border-stage-mastering/60 pb-0.5"
        />
        {(item.notes || notes) && (
          <input
            type="text"
            value={notes}
            placeholder="Notes…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (item.notes ?? '') && void onUpdate({ notes })}
            disabled={!isAdmin}
            className="w-full bg-transparent text-[11px] text-muted italic outline-none mt-0.5"
          />
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          onBlur={() => parseFloat(amt) !== item.amt && void onUpdate({ amt: parseFloat(amt) || 0 })}
          disabled={!isAdmin}
          placeholder="amt"
          className="w-14 text-xs text-right font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
        />
        <span className="text-[10px] text-muted">×</span>
        <input
          type="number"
          value={x}
          onChange={(e) => setX(e.target.value)}
          onBlur={() => parseFloat(x) !== item.x && void onUpdate({ x: parseFloat(x) || 1 })}
          disabled={!isAdmin}
          placeholder="×"
          className="w-12 text-xs text-right font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
        />
        <span className="text-[10px] text-muted">@$</span>
        <input
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => parseFloat(rate) !== item.rate && void onUpdate({ rate: parseFloat(rate) || 0 })}
          disabled={!isAdmin}
          placeholder="rate"
          className="w-16 text-xs text-right font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
        />
        <div className="w-20 text-right font-mono font-bold text-sm text-text">
          {computedTotal > 0 ? `$${Math.round(computedTotal).toLocaleString()}` : <span className="text-muted/40">—</span>}
        </div>
        {isAdmin && (
          <button
            onClick={() => void onDelete()}
            className="text-muted/40 hover:text-urgent opacity-0 group-hover:opacity-100 px-1"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
