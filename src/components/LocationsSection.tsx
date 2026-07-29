import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ApiLocation } from '../api'

// A nestable list of the film's shooting locations. Auto-populated from the
// script's scene locations. Drag a location onto another to make it a
// sub-location; drag it to the "top level" strip to un-nest. Each location
// shows how many scenes it holds and how many shooting days it lands on
// (parents roll up their children's days).
export default function LocationsSection({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [locations, setLocations] = useState<ApiLocation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [rootHot, setRootHot] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = useCallback(async () => {
    try {
      const { locations } = await api.locations(projectId)
      setLocations(locations)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load locations')
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const byId = useMemo(() => new Map((locations ?? []).map((l) => [l.id, l])), [locations])
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, ApiLocation[]>()
    for (const l of locations ?? []) {
      const k = l.parentId
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(l)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    return m
  }, [locations])

  // Union of a location's own shoot days + all descendants' — deduped + sorted.
  const rolledDays = useCallback((id: string): number[] => {
    const set = new Set<number>()
    const walk = (nid: string) => {
      const n = byId.get(nid)
      if (!n) return
      for (const d of n.dayNumbers) set.add(d)
      for (const c of childrenOf.get(nid) ?? []) walk(c.id)
    }
    walk(id)
    return Array.from(set).sort((a, b) => a - b)
  }, [byId, childrenOf])

  const rolledScenes = useCallback((id: string): number => {
    let total = 0
    const walk = (nid: string) => {
      const n = byId.get(nid)
      if (!n) return
      total += n.sceneCount
      for (const c of childrenOf.get(nid) ?? []) walk(c.id)
    }
    walk(id)
    return total
  }, [byId, childrenOf])

  async function nest(childId: string, parentId: string | null) {
    if (childId === parentId) return
    // Optimistic
    setLocations((prev) => prev?.map((l) => (l.id === childId ? { ...l, parentId } : l)) ?? prev)
    try {
      await api.updateLocation(childId, { parentId })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'move failed')
      await load()
    }
  }

  async function rename(id: string) {
    const name = editName.trim()
    setEditingId(null)
    if (!name) return
    setLocations((prev) => prev?.map((l) => (l.id === id ? { ...l, name } : l)) ?? prev)
    try {
      await api.updateLocation(id, { name })
    } catch {
      await load()
    }
  }

  async function addGroup() {
    try {
      const { id } = await api.createLocation(projectId, 'New location')
      await load()
      setEditingId(id)
      setEditName('New location')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed')
    }
  }

  async function removeGroup(id: string) {
    if (!confirm('Delete this grouping location? Its sub-locations move back to the top level.')) return
    setLocations((prev) => prev?.filter((l) => l.id !== id).map((l) => (l.parentId === id ? { ...l, parentId: null } : l)) ?? prev)
    try {
      await api.deleteLocation(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
      await load()
    }
  }

  const totalDays = useMemo(() => {
    const set = new Set<number>()
    for (const l of locations ?? []) for (const d of l.dayNumbers) set.add(d)
    return set.size
  }, [locations])

  if (error) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📍 Locations</h2>
        <p className="text-sm text-urgent mt-2">{error}</p>
      </section>
    )
  }
  if (!locations) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📍 Locations</h2>
        <p className="text-sm text-muted mt-2">Loading…</p>
      </section>
    )
  }

  const topLevel = childrenOf.get(null) ?? []

  function renderNode(loc: ApiLocation, depth: number) {
    const kids = childrenOf.get(loc.id) ?? []
    const days = rolledDays(loc.id)
    const scenes = rolledScenes(loc.id)
    const isDragging = dragId === loc.id
    const isDropHere = dropTarget === loc.id
    return (
      <div key={loc.id}>
        <div
          draggable={isAdmin}
          onDragStart={(e) => { setDragId(loc.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setDragId(null); setDropTarget(null) }}
          onDragOver={(e) => {
            if (!isAdmin || !dragId || dragId === loc.id) return
            e.preventDefault(); e.stopPropagation()
            setDropTarget(loc.id); setRootHot(false)
          }}
          onDragLeave={() => setDropTarget((t) => (t === loc.id ? null : t))}
          onDrop={(e) => {
            if (!isAdmin || !dragId || dragId === loc.id) return
            e.preventDefault(); e.stopPropagation()
            void nest(dragId, loc.id)
            setDragId(null); setDropTarget(null)
          }}
          style={{ marginLeft: depth * 20 }}
          className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 mb-1.5 transition ${
            isDropHere ? 'border-emerald-600 bg-emerald-500/10' : 'border-line/60 bg-ink/20'
          } ${isDragging ? 'opacity-40' : ''}`}
        >
          {isAdmin && <span className="text-muted/50 cursor-grab select-none text-sm shrink-0" title="Drag to nest">⠿</span>}
          <div className="min-w-0 flex-1">
            {editingId === loc.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => void rename(loc.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') void rename(loc.id); if (e.key === 'Escape') setEditingId(null) }}
                className="w-full bg-panel border border-line rounded px-2 py-1 text-sm text-text"
              />
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-semibold text-sm text-text truncate"
                  onDoubleClick={() => { if (isAdmin) { setEditingId(loc.id); setEditName(loc.name) } }}
                  title={isAdmin ? 'Double-click to rename' : undefined}
                >
                  {loc.name}
                </span>
                {loc.intExt && (
                  <span className="text-[9px] uppercase tracking-wider font-bold text-muted/70 border border-line/60 rounded px-1 py-px">
                    {loc.intExt}
                  </span>
                )}
                {kids.length > 0 && (
                  <span className="text-[10px] text-muted/70">{kids.length} sub-location{kids.length === 1 ? '' : 's'}</span>
                )}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono font-extrabold text-lg leading-none text-emerald-700">
              {days.length}<span className="text-[10px] font-bold text-muted/80 ml-1 uppercase tracking-wider">day{days.length === 1 ? '' : 's'}</span>
            </div>
            <div className="text-[10px] text-muted/80 mt-0.5">
              {loc.isGroup && loc.sceneCount === 0 ? 'grouping' : `${scenes} scene${scenes === 1 ? '' : 's'}`}
              {days.length > 0 && <> · days {days.join(', ')}</>}
            </div>
          </div>
          {isAdmin && loc.isGroup && (
            <button
              onClick={() => void removeGroup(loc.id)}
              className="text-muted/50 hover:text-urgent text-sm shrink-0 px-1"
              title="Delete grouping location"
            >
              ✕
            </button>
          )}
        </div>
        {kids.map((k) => renderNode(k, depth + 1))}
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📍 Locations — shooting days breakdown</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            {locations.length} location{locations.length === 1 ? '' : 's'} · {totalDays} shooting day{totalDays === 1 ? '' : 's'} across the schedule
            {isAdmin && ' · drag a location onto another to nest it · double-click to rename'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => void addGroup()}
            className="text-[11px] uppercase tracking-wider font-bold border border-emerald-700/50 text-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-500/10 transition shrink-0"
          >
            + New grouping location
          </button>
        )}
      </div>
      {isAdmin && (
        <p className="text-[11px] text-muted/70 -mt-2">
          Make a parent like <span className="font-semibold text-text">"Sawyer's Apt"</span> with the + button,
          then drag the specific sets (living room, kitchen…) onto it. The parent shows the total days you shoot there.
        </p>
      )}

      {locations.length === 0 ? (
        <p className="text-sm text-muted italic py-4 text-center">
          No locations yet — they appear automatically once the script is imported and scenes have location headings.
        </p>
      ) : (
        <>
          {/* Un-nest drop strip */}
          {isAdmin && dragId && (
            <div
              onDragOver={(e) => { e.preventDefault(); setRootHot(true); setDropTarget(null) }}
              onDragLeave={() => setRootHot(false)}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId) void nest(dragId, null)
                setDragId(null); setRootHot(false)
              }}
              className={`rounded-lg border border-dashed px-3 py-2 text-center text-[11px] uppercase tracking-wider transition ${
                rootHot ? 'border-emerald-600 bg-emerald-500/10 text-emerald-700' : 'border-line/60 text-muted/70'
              }`}
            >
              ↥ Drop here to make it a top-level location
            </div>
          )}
          <div>{topLevel.map((l) => renderNode(l, 0))}</div>
        </>
      )}
    </section>
  )
}
