// Open an EventSource for a project and dispatch parsed events to a
// handler. Auto-reconnects on disconnect (browser behavior). Skips
// events that originated from the current user (no point patching
// state with what they just typed).
import { useEffect, useRef } from 'react'
import { useAuth } from './auth'

export type ProjectEvent = {
  type: string
  by: string | null
  at: string
  data: Record<string, unknown>
}

export function useProjectEvents(
  projectId: string | null,
  onEvent: (e: ProjectEvent) => void,
): void {
  const { user } = useAuth()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const myUserId = user?.id ?? null

  useEffect(() => {
    if (!projectId) return
    const url = `/api/projects/${projectId}/events`
    const es = new EventSource(url, { withCredentials: true })

    const handle = (type: string) => (msg: MessageEvent) => {
      try {
        const parsed = JSON.parse(msg.data || '{}') as { by?: string | null; at?: string } & Record<string, unknown>
        const by = parsed.by ?? null
        if (by && by === myUserId) return // skip self
        onEventRef.current({
          type,
          by,
          at: parsed.at || new Date().toISOString(),
          data: parsed,
        })
      } catch {}
    }

    // Subscribe to known event types. EventSource only fires "message"
    // for events without an `event:` field; named events need their
    // own listeners.
    const types = [
      'budget.item.updated',
      'budget.item.deleted',
      'budget.bulk.changed',
      'scene.updated',
      'cut.updated',
      'presence.claim',
      'presence.release',
      'connected',
    ]
    const listeners = types.map((t) => {
      const h = handle(t)
      es.addEventListener(t, h)
      return [t, h] as const
    })

    return () => {
      for (const [t, h] of listeners) es.removeEventListener(t, h)
      es.close()
    }
  }, [projectId, myUserId])
}
