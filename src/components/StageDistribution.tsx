import { STAGES, STAGE_COLOR, stageIcon, stageLabel, type Song, type Stage, type StageLabels } from '../types'

type Props = {
  songs: Song[]
  labels?: StageLabels
  kind?: 'album' | 'podcast' | 'film'
}

const PROGRESS_LABEL: Record<NonNullable<Props['kind']>, string> = {
  album: 'Album progress',
  podcast: 'Show progress',
  film: 'Film progress',
}

export default function StageDistribution({ songs, labels, kind = 'album' }: Props) {
  const total = songs.length || 1
  const counts = STAGES.reduce<Record<Stage, number>>((acc, s) => {
    acc[s] = songs.filter((song) => song.stage === s).length
    return acc
  }, {} as Record<Stage, number>)
  const donePct = Math.round((counts.done / total) * 100)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">
          {PROGRESS_LABEL[kind]}
        </span>
        <span className="text-[11px] text-muted">
          <span className="text-text font-bold">
            {counts.done}/{songs.length}
          </span>{' '}
          done · {donePct}%
        </span>
      </div>
      <div className="relative h-3 w-full rounded-full overflow-hidden flex bg-panel border border-line shadow-inner">
        {STAGES.map((s) => {
          const w = (counts[s] / total) * 100
          if (w === 0) return null
          return (
            <div
              key={s}
              title={`${stageLabel(s, labels)}: ${counts[s]}`}
              style={{ width: `${w}%` }}
              className={`${STAGE_COLOR[s].dot} h-full relative`}
            />
          )
        })}
        <div className="shimmer absolute inset-0 pointer-events-none" />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-2 mt-4">
        {STAGES.map((s) => {
          const c = STAGE_COLOR[s]
          const n = counts[s]
          const active = n > 0
          return (
            <div
              key={s}
              className={`flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border ${
                active ? `${c.border}/40 ${c.bgStrong} ${c.text}` : 'border-line text-muted/60'
              }`}
            >
              <span className="text-[0.95em] leading-none">{stageIcon(s, labels)}</span>
              <span className="uppercase tracking-wider font-semibold">{stageLabel(s, labels)}</span>
              <span className={`font-bold ${active ? '' : 'opacity-60'}`}>{n}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
