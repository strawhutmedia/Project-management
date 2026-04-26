import { STAGES, STAGE_COLOR, STAGE_LABEL, type Song, type Stage } from '../types'

export default function StageDistribution({ songs }: { songs: Song[] }) {
  const total = songs.length || 1
  const counts = STAGES.reduce<Record<Stage, number>>((acc, s) => {
    acc[s] = songs.filter((song) => song.stage === s).length
    return acc
  }, {} as Record<Stage, number>)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Album progress</span>
        <span className="text-[11px] text-muted">
          {counts.done}/{songs.length} done
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-panel border border-line">
        {STAGES.map((s) => {
          const w = (counts[s] / total) * 100
          if (w === 0) return null
          return (
            <div
              key={s}
              title={`${STAGE_LABEL[s]}: ${counts[s]}`}
              style={{ width: `${w}%` }}
              className={`${STAGE_COLOR[s].dot} h-full`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {STAGES.map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className={`w-2 h-2 rounded-full ${STAGE_COLOR[s].dot}`} />
            <span className="uppercase tracking-wider">{STAGE_LABEL[s]}</span>
            <span className="text-text/80 font-semibold">{counts[s]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
