// Per-project event broker. Real-time updates so two people editing
// the same budget see each other's changes appear row-by-row, instead
// of polling and reloading the whole table (which caused flicker).
//
// Connections: GET /api/projects/:id/events opens an SSE stream and
// registers the response object as a listener. When a mutation runs,
// the route handler calls emit(projectId, eventName, payload, byUser)
// and every listener for that project gets the JSON event line.
//
// Lightweight in-memory pub/sub — no Redis. Works fine for a single
// Node instance, which is what Railway gives us. If/when we scale to
// multiple instances we'll need a real broker.
import type { Response } from 'express'

type Listener = {
  userId: string
  res: Response
}

const listenersByProject = new Map<string, Set<Listener>>()

export function addListener(projectId: string, listener: Listener): () => void {
  let set = listenersByProject.get(projectId)
  if (!set) {
    set = new Set()
    listenersByProject.set(projectId, set)
  }
  set.add(listener)
  return () => {
    const s = listenersByProject.get(projectId)
    if (!s) return
    s.delete(listener)
    if (s.size === 0) listenersByProject.delete(projectId)
  }
}

export function emit(
  projectId: string,
  event: string,
  data: Record<string, unknown>,
  byUserId?: string,
): void {
  const set = listenersByProject.get(projectId)
  if (!set || set.size === 0) return
  const payload = JSON.stringify({ ...data, by: byUserId ?? null, at: new Date().toISOString() })
  const frame = `event: ${event}\ndata: ${payload}\n\n`
  // Iterate over a snapshot to avoid mutation-during-iteration if a
  // write fails and the listener gets evicted by its close handler.
  for (const l of Array.from(set)) {
    try {
      l.res.write(frame)
    } catch {
      // Connection probably closed; the close handler will clean up.
    }
  }
}

export function listenerCount(projectId: string): number {
  return listenersByProject.get(projectId)?.size ?? 0
}

// Row claims — who's currently editing what. Auto-expire claims after
// 30 seconds with no refresh so a closed tab doesn't hold a row
// hostage forever.
type Claim = {
  userId: string
  displayName: string | null
  claimedAt: number
}

const claimsByProject = new Map<string, Map<string, Claim>>()
const CLAIM_TTL_MS = 30_000

function claimKey(rowType: string, rowId: string): string {
  return `${rowType}::${rowId}`
}

function pruneExpiredClaims(projectId: string): boolean {
  const map = claimsByProject.get(projectId)
  if (!map) return false
  const now = Date.now()
  let changed = false
  for (const [k, claim] of map) {
    if (now - claim.claimedAt > CLAIM_TTL_MS) {
      map.delete(k)
      changed = true
    }
  }
  if (map.size === 0) claimsByProject.delete(projectId)
  return changed
}

export function claimRow(
  projectId: string,
  rowType: string,
  rowId: string,
  userId: string,
  displayName: string | null,
): { changed: boolean; claim: Claim } {
  pruneExpiredClaims(projectId)
  let map = claimsByProject.get(projectId)
  if (!map) { map = new Map(); claimsByProject.set(projectId, map) }
  const key = claimKey(rowType, rowId)
  const existing = map.get(key)
  const claim: Claim = { userId, displayName, claimedAt: Date.now() }
  map.set(key, claim)
  const changed = !existing || existing.userId !== userId
  return { changed, claim }
}

export function releaseRow(projectId: string, rowType: string, rowId: string, userId: string): boolean {
  const map = claimsByProject.get(projectId)
  if (!map) return false
  const key = claimKey(rowType, rowId)
  const existing = map.get(key)
  if (!existing || existing.userId !== userId) return false
  map.delete(key)
  if (map.size === 0) claimsByProject.delete(projectId)
  return true
}

export function getClaims(projectId: string): Array<{ rowType: string; rowId: string; userId: string; displayName: string | null }> {
  pruneExpiredClaims(projectId)
  const map = claimsByProject.get(projectId)
  if (!map) return []
  const out: Array<{ rowType: string; rowId: string; userId: string; displayName: string | null }> = []
  for (const [k, claim] of map) {
    const [rowType, rowId] = k.split('::')
    out.push({ rowType, rowId, userId: claim.userId, displayName: claim.displayName })
  }
  return out
}
