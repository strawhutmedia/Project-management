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
