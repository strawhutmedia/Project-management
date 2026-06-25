// Track which rows are currently claimed (being edited) by which
// users on the project. Bootstrapped once via REST, then kept current
// via SSE events from useProjectEvents.
//
// Claim model:
//   - When an input on a row is focused, the client POSTs a claim
//     and re-claims every 15s while still focused (so it doesn't
//     auto-expire server-side).
//   - On blur, the client releases.
//   - Other clients receive presence.claim/release events and see
//     the lock indicator + disabled inputs.
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'

export type RowClaim = {
  rowType: string
  rowId: string
  userId: string
  displayName: string | null
}

type ClaimMap = Map<string, RowClaim>
const keyOf = (rowType: string, rowId: string) => `${rowType}::${rowId}`

export function useRowClaims(projectId: string | null): {
  claims: ClaimMap
  applyEvent: (type: string, data: Record<string, unknown>) => void
} {
  const [claims, setClaims] = useState<ClaimMap>(new Map())

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    api.projectClaims(projectId).then((r) => {
      if (cancelled) return
      const next: ClaimMap = new Map()
      for (const c of r.claims) next.set(keyOf(c.rowType, c.rowId), c)
      setClaims(next)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

  function applyEvent(type: string, data: Record<string, unknown>) {
    if (type === 'presence.claim') {
      const rowType = data.rowType as string
      const rowId = data.rowId as string
      const userId = data.userId as string
      const displayName = (data.displayName ?? null) as string | null
      if (!rowType || !rowId || !userId) return
      setClaims((m) => {
        const next = new Map(m)
        next.set(keyOf(rowType, rowId), { rowType, rowId, userId, displayName })
        return next
      })
    } else if (type === 'presence.release') {
      const rowType = data.rowType as string
      const rowId = data.rowId as string
      if (!rowType || !rowId) return
      setClaims((m) => {
        if (!m.has(keyOf(rowType, rowId))) return m
        const next = new Map(m)
        next.delete(keyOf(rowType, rowId))
        return next
      })
    }
  }

  return { claims, applyEvent }
}

// Hook for an individual editable row. Claims when focused, releases
// on blur, re-claims every 15s while focused to keep the lock alive.
export function useRowClaimSender(projectId: string | null, rowType: string, rowId: string): {
  onFocus: () => void
  onBlur: () => void
  refresh: () => void
} {
  const focused = useRef(false)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  function send(kind: 'claim' | 'release') {
    if (!projectId) return
    if (kind === 'claim') void api.claimRow(projectId, rowType, rowId).catch(() => {})
    else void api.releaseRow(projectId, rowType, rowId).catch(() => {})
  }

  function onFocus() {
    if (focused.current) return
    focused.current = true
    send('claim')
    refreshTimer.current = setInterval(() => send('claim'), 15_000)
  }

  function onBlur() {
    if (!focused.current) return
    focused.current = false
    if (refreshTimer.current) clearInterval(refreshTimer.current)
    refreshTimer.current = null
    send('release')
  }

  useEffect(() => () => {
    if (focused.current) send('release')
    if (refreshTimer.current) clearInterval(refreshTimer.current)
  }, [projectId, rowType, rowId])

  return { onFocus, onBlur, refresh: () => send('claim') }
}

// User color per stable userId hash.
const COLORS = [
  '#fbbf24', '#fb923c', '#f472b6', '#a78bfa',
  '#60a5fa', '#2dd4bf', '#34d399', '#94a3b8',
]
export function colorForUser(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

export function initialsFor(displayName: string | null, userId: string): string {
  if (displayName && displayName.trim()) {
    const parts = displayName.trim().split(/\s+/)
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase().slice(0, 2)
  }
  return userId.slice(0, 2).toUpperCase()
}

// Hook that combines claims + filter-out-self.
export function useOtherClaim(claims: ClaimMap, rowType: string, rowId: string): RowClaim | null {
  const { user } = useAuth()
  const claim = claims.get(keyOf(rowType, rowId))
  if (!claim) return null
  if (claim.userId === user?.id) return null
  return claim
}
