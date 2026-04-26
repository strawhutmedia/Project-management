import { STAGE_COLOR, STAGE_ICON, STAGE_LABEL, type Stage } from '../types'

export default function StagePill({
  stage,
  size = 'sm',
  glow = false,
}: {
  stage: Stage
  size?: 'sm' | 'xs' | 'lg'
  glow?: boolean
}) {
  const c = STAGE_COLOR[stage]
  const sizeCls =
    size === 'lg'
      ? 'text-xs px-3 py-1.5'
      : size === 'xs'
        ? 'text-[10px] px-2 py-0.5'
        : 'text-[11px] px-2.5 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${c.border}/50 ${c.bgStrong} ${c.text} ${sizeCls} uppercase tracking-wider font-bold whitespace-nowrap ${
        glow ? c.glow : ''
      }`}
    >
      <span className="text-[0.85em] leading-none">{STAGE_ICON[stage]}</span>
      {STAGE_LABEL[stage]}
    </span>
  )
}
