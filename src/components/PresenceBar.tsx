// "Who's in this project right now." Pings a heartbeat every 30
// seconds and polls the active-user list every 10. Shows colored
// avatar circles for everyone seen in the last 90 seconds. Hover for
// name + which section they're working on.
//
// Lets Ryan and Alex (or any team) know they're in the budget at the
// same time, without surprise. Pair with the auto-refresh on the
// budget / scene panels to see each other's edits appear.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'

type Person = {
  userId: string
  displayName: string | null
  email: string
  lastSeenAt: string
  currentSection: string | null
}

// Per-user color so two people aren't both blue. Stable per session
// via a hash of the user id.
function userColor(userId: string): string {
  const palette = [
    'bg-stage-mastering', 'bg-stage-tracking', 'bg-stage-mixing',
    'bg-stage-stems', 'bg-stage-overdubs', 'bg-stage-producing',
    'bg-stage-done',
  ]
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

function initials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/)
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase().slice(0, 2)
  }
  return email.slice(0, 2).toUpperCase()
}

export default function PresenceBar({
  projectId,
  section,
}: {
  projectId: string
  section?: string
}) {
  const { user } = useAuth()
  const [people, setPeople] = useState<Person[]>([])
  const sectionRef = useRef(section)
  sectionRef.current = section

  useEffect(() => {
    let cancelled = false
    async function beat() {
      try { await api.presenceHeartbeat(projectId, sectionRef.current) } catch {}
    }
    async function load() {
      try {
        const r = await api.projectPresence(projectId)
        if (!cancelled) setPeople(r.presence)
      } catch {
        if (!cancelled) setPeople([])
      }
    }
    void beat()
    void load()
    const beatTimer = setInterval(() => void beat(), 30_000)
    const loadTimer = setInterval(() => void load(), 10_000)
    return () => {
      cancelled = true
      clearInterval(beatTimer)
      clearInterval(loadTimer)
    }
  }, [projectId])

  // Don't show "me" in the count — only others. But render my own
  // avatar last so the user has reference for what their own dot
  // looks like.
  const others = people.filter((p) => p.userId !== user?.id)
  if (others.length === 0) return null

  return (
    <div className="rounded-xl border border-stage-tracking/40 bg-stage-tracking/5 px-3 py-2 flex items-center gap-2 flex-wrap text-[11px]">
      <span className="inline-block w-2 h-2 rounded-full bg-stage-tracking animate-pulse" />
      <span className="text-stage-tracking font-bold uppercase tracking-wider text-[10px]">
        {others.length === 1 ? '1 person also here' : `${others.length} people also here`}
      </span>
      <div className="flex items-center gap-1 ml-1">
        {others.slice(0, 6).map((p) => (
          <div
            key={p.userId}
            className={`relative w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold text-white ${userColor(p.userId)}`}
            title={`${p.displayName || p.email}${p.currentSection ? ` · in ${p.currentSection}` : ''}`}
          >
            {initials(p.displayName, p.email)}
          </div>
        ))}
        {others.length > 6 && (
          <span className="text-muted">+{others.length - 6}</span>
        )}
      </div>
      <span className="text-muted ml-2">
        {others.map((p) => p.displayName?.split(' ')[0] || p.email.split('@')[0]).join(', ')}
      </span>
    </div>
  )
}
