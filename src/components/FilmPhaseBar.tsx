import { useState } from 'react'
import { api } from '../api'

export type FilmPhase = 'pre' | 'production' | 'post' | 'wrapped'

const PHASES: Array<{ key: FilmPhase; label: string; icon: string }> = [
  { key: 'pre',        label: 'Pre-Production',  icon: '📝' },
  { key: 'production', label: 'Production',      icon: '🎬' },
  { key: 'post',       label: 'Post-Production', icon: '✂️' },
  { key: 'wrapped',    label: 'Wrapped',         icon: '🚀' },
]

export default function FilmPhaseBar({
  projectId,
  currentPhase,
  isAdmin,
  onChanged,
}: {
  projectId: string
  currentPhase: FilmPhase
  isAdmin: boolean
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase)
  const safeIndex = currentIndex === -1 ? 0 : currentIndex

  async function setPhase(phase: FilmPhase) {
    if (!isAdmin) return
    setBusy(true)
    try {
      await api.updateProject(projectId, { filmPhase: phase })
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-panel/60 p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-3">
        🎞️ Film Phase
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PHASES.map((phase, i) => {
          const isCurrent = phase.key === currentPhase
          const isPast = i < safeIndex
          const isFuture = i > safeIndex
          return (
            <button
              key={phase.key}
              disabled={!isAdmin || busy}
              onClick={() => void setPhase(phase.key)}
              className={`relative rounded-xl px-3 py-3 text-left transition border ${
                isCurrent
                  ? 'border-stage-mastering bg-gradient-to-br from-stage-producing/30 to-stage-mastering/30 ring-2 ring-stage-mastering/50'
                  : isPast
                  ? 'border-stage-stems/40 bg-stage-stems/10 hover:bg-stage-stems/20'
                  : isFuture
                  ? 'border-line bg-ink/30 hover:bg-ink/50 opacity-60'
                  : 'border-line bg-ink/30'
              } ${isAdmin ? 'cursor-pointer' : 'cursor-default'} disabled:opacity-50`}
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-base leading-none">{phase.icon}</span>
                {isPast && <span className="text-[10px] text-stage-stems font-bold">✓</span>}
                {isCurrent && <span className="text-[10px] text-stage-mastering font-bold uppercase tracking-wider">Current</span>}
              </div>
              <div className={`text-[11px] uppercase tracking-tight font-bold ${
                isCurrent ? 'text-text' : isPast ? 'text-stage-stems' : 'text-muted'
              }`}>
                {phase.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
