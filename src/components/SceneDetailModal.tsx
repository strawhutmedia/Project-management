// Per-scene detail + budget breakdown.
//
// Lists everything Claude pulled out of the script for this scene, grouped
// by category (Cast / Props / Wardrobe / Location / SFX / VFX / Vehicles /
// etc.). Each row has an inline "$" input so the producer can attach a
// number. Producer can add rows, edit descriptions, delete, and re-run the
// breakdown to refresh from the script.
import { useEffect, useState } from 'react'
import { api, type ApiScene } from '../api'

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

type SceneItem = {
  id: string
  code: string | null
  description: string
  amt: number
  units: string | null
  x: number
  rate: number
  vendor: string | null
  datedAt: string | null
  notes: string | null
  position: number
  total: number
  resourceType: string | null
  resourceKey: string | null
  sceneUsageCount: number
  isSceneOnly: boolean
}

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
      const r = await api.sceneBudgetItems(sceneId)
      setItems(r.items)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      if (msg.includes('no_budget') || msg.includes('404')) {
        setItems([])
      } else {
        setError(msg)
      }
    }
  }

  useEffect(() => { void loadItems() }, [sceneId])

  // Auto-refresh every 10 seconds while the modal is open so a
  // teammate's edits to this scene's items appear without manual
  // reload. Skips when an input is focused (would overwrite the
  // value the user is typing) or when the tab isn't visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return
      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return
      void loadItems()
    }, 10_000)
    return () => clearInterval(timer)
  }, [sceneId])

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

          {scene.producerNoteSuggestion && (
            <ProducerNoteCard
              sceneId={sceneId}
              suggestion={scene.producerNoteSuggestion}
              existingNote={scene.notes}
              isAdmin={isAdmin}
              onChanged={onChanged}
            />
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
                          sceneId={sceneId}
                          sceneLocationTag={scene?.locationTag ?? null}
                          isAdmin={isAdmin}
                          onUpdate={(patch) => updateItem(it.id, patch)}
                          onDelete={() => deleteItem(it.id)}
                          onChanged={loadItems}
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

function SceneItemRow({
  item,
  sceneId,
  sceneLocationTag,
  isAdmin,
  onUpdate,
  onDelete,
  onChanged,
}: {
  item: SceneItem
  sceneId: string
  sceneLocationTag: string | null
  isAdmin: boolean
  onUpdate: (patch: Parameters<typeof api.updateBudgetItem>[1]) => Promise<void>
  onDelete: () => Promise<void>
  onChanged: () => Promise<void>
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

  async function makeSharedLocation() {
    if (!sceneLocationTag) return
    if (!confirm('Mark this cost as shared with every scene at the same location? You\'ll edit it once and the change applies everywhere.')) return
    await api.promoteItemToShared(item.id, { sceneId, kind: 'LOCATION' })
    await onChanged()
  }

  const computedTotal = (parseFloat(amt) || 0) * (parseFloat(x) || 0) * (parseFloat(rate) || 0)
  const isShared = item.resourceType !== null
  const canPromoteToLocation =
    !isShared && isAdmin && sceneLocationTag &&
    (bucketOf(item.code) === 'LOCATION' || bucketOf(item.code) === 'PERMITS')

  return (
    <div className="px-3 py-2 group flex flex-col sm:flex-row items-stretch sm:items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== item.description && void onUpdate({ description })}
            disabled={!isAdmin}
            className="flex-1 min-w-0 bg-transparent text-sm text-text outline-none border-b border-transparent focus:border-stage-mastering/60 pb-0.5"
          />
          {isShared && (
            <span
              className="text-[9px] uppercase tracking-wider font-bold text-stage-mastering bg-stage-mastering/15 border border-stage-mastering/40 rounded-full px-2 py-0.5 whitespace-nowrap"
              title={`Shared ${item.resourceType?.toLowerCase()} · used in ${item.sceneUsageCount} scene${item.sceneUsageCount === 1 ? '' : 's'}`}
            >
              ⇆ Used in {item.sceneUsageCount} scene{item.sceneUsageCount === 1 ? '' : 's'}
            </span>
          )}
          {canPromoteToLocation && (
            <button
              onClick={() => void makeSharedLocation()}
              className="text-[9px] uppercase tracking-wider text-muted hover:text-stage-mastering border border-line hover:border-stage-mastering/40 rounded-full px-2 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100"
              title="Share this cost with every scene at the same location"
            >
              📍 Share with all "{sceneLocationTag}" scenes
            </button>
          )}
        </div>
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
      {/* Math row — on mobile this drops below the description for
          legibility. On desktop it sits to the right. */}
      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <span className="sm:hidden uppercase tracking-wider">qty</span>
          <input
            type="number"
            inputMode="decimal"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            onBlur={() => parseFloat(amt) !== item.amt && void onUpdate({ amt: parseFloat(amt) || 0 })}
            disabled={!isAdmin}
            placeholder="amt"
            className="w-14 text-xs text-right font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
          />
        </label>
        <span className="text-[10px] text-muted">×</span>
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <span className="sm:hidden uppercase tracking-wider">days</span>
          <input
            type="number"
            inputMode="decimal"
            value={x}
            onChange={(e) => setX(e.target.value)}
            onBlur={() => parseFloat(x) !== item.x && void onUpdate({ x: parseFloat(x) || 1 })}
            disabled={!isAdmin}
            placeholder="×"
            className="w-12 text-xs text-right font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
          />
        </label>
        <span className="text-[10px] text-muted">@</span>
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <span className="sm:hidden uppercase tracking-wider">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => parseFloat(rate) !== item.rate && void onUpdate({ rate: parseFloat(rate) || 0 })}
            disabled={!isAdmin}
            placeholder="rate"
            className="w-16 text-xs text-right font-mono bg-ink/40 border border-line rounded px-1.5 py-1 outline-none focus:border-stage-mastering"
          />
        </label>
        <span className="text-[10px] text-muted">=</span>
        <div className="min-w-[64px] text-right font-mono font-bold text-sm text-text">
          {computedTotal > 0 ? `$${Math.round(computedTotal).toLocaleString()}` : <span className="text-muted/40">—</span>}
        </div>
        {isAdmin && (
          <button
            onClick={() => void onDelete()}
            className="text-muted/40 hover:text-urgent px-2 py-1 sm:opacity-0 sm:group-hover:opacity-100"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// Yellow card showing Claude's producer note suggestion for a scene.
// Apply moves it into the scene's notes field (appending if there's
// already one). Dismiss clears the suggestion without saving.
function ProducerNoteCard({
  sceneId,
  suggestion,
  existingNote,
  isAdmin,
  onChanged,
}: {
  sceneId: string
  suggestion: string
  existingNote: string | null
  isAdmin: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function apply() {
    setBusy(true)
    try {
      const combined = existingNote && existingNote.trim()
        ? `${existingNote.trim()}\n\n${suggestion}`
        : suggestion
      await api.updateScene(sceneId, { notes: combined, producerNoteSuggestion: null })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    try {
      await api.updateScene(sceneId, { producerNoteSuggestion: null })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-stage-overdubs/40 bg-stage-overdubs/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-base">💡</span>
        <span className="text-[10px] uppercase tracking-wider font-bold text-stage-overdubs">
          Producer note from Claude
        </span>
      </div>
      <p className="text-sm text-text leading-snug">{suggestion}</p>
      {isAdmin && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => void apply()}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider font-bold text-white bg-stage-overdubs rounded-full px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
          >
            ✓ Apply to scene notes
          </button>
          <button
            onClick={() => void dismiss()}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider text-muted border border-line rounded-full px-3 py-1.5 hover:bg-ink/40 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
