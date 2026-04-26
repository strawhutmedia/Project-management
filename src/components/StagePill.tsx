import { STAGE_COLOR, STAGE_LABEL, type Stage } from '../types'

export default function StagePill({ stage, size = 'sm' }: { stage: Stage; size?: 'sm' | 'xs' }) {
  const c = STAGE_COLOR[stage]
  const sizeCls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${c.border}/40 ${c.bg} ${c.text} ${sizeCls} uppercase tracking-wider font-semibold`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {STAGE_LABEL[stage]}
    </span>
  )
}
