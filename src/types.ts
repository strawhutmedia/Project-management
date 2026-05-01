export type Stage =
  | 'writing'
  | 'tracking'
  | 'overdubs'
  | 'producing'
  | 'stems'
  | 'mixing'
  | 'mastering'
  | 'done'

export const STAGES: Stage[] = [
  'writing',
  'tracking',
  'overdubs',
  'producing',
  'stems',
  'mixing',
  'mastering',
  'done',
]

export const STAGE_LABEL: Record<Stage, string> = {
  writing: 'Writing',
  tracking: 'Tracking',
  overdubs: 'Overdubs',
  producing: 'Comp',
  stems: 'Stems',
  mixing: 'Mixing',
  mastering: 'Mastering',
  done: 'Done',
}

export const STAGE_ICON: Record<Stage, string> = {
  writing: '✍️',
  tracking: '🎤',
  overdubs: '🎸',
  producing: '🎚️',
  stems: '📦',
  mixing: '🎛️',
  mastering: '✨',
  done: '✅',
}

// Per-project stage label/icon overrides take precedence when present.
export type StageLabels = Partial<Record<Stage, { label?: string; icon?: string }>>

export function stageLabel(stage: Stage, overrides?: StageLabels): string {
  return overrides?.[stage]?.label || STAGE_LABEL[stage]
}
export function stageIcon(stage: Stage, overrides?: StageLabels): string {
  return overrides?.[stage]?.icon || STAGE_ICON[stage]
}

export const STAGE_COLOR: Record<
  Stage,
  { bg: string; bgStrong: string; text: string; border: string; dot: string; glow: string; hex: string }
> = {
  writing: {
    bg: 'bg-stage-writing/10',
    bgStrong: 'bg-stage-writing/20',
    text: 'text-stage-writing',
    border: 'border-stage-writing',
    dot: 'bg-stage-writing',
    glow: 'shadow-[0_0_24px_-4px_rgba(148,163,184,0.5)]',
    hex: '#94a3b8',
  },
  tracking: {
    bg: 'bg-stage-tracking/10',
    bgStrong: 'bg-stage-tracking/20',
    text: 'text-stage-tracking',
    border: 'border-stage-tracking',
    dot: 'bg-stage-tracking',
    glow: 'shadow-[0_0_30px_-4px_rgba(251,191,36,0.55)]',
    hex: '#fbbf24',
  },
  overdubs: {
    bg: 'bg-stage-overdubs/10',
    bgStrong: 'bg-stage-overdubs/20',
    text: 'text-stage-overdubs',
    border: 'border-stage-overdubs',
    dot: 'bg-stage-overdubs',
    glow: 'shadow-[0_0_30px_-4px_rgba(251,146,60,0.55)]',
    hex: '#fb923c',
  },
  producing: {
    bg: 'bg-stage-producing/10',
    bgStrong: 'bg-stage-producing/20',
    text: 'text-stage-producing',
    border: 'border-stage-producing',
    dot: 'bg-stage-producing',
    glow: 'shadow-[0_0_30px_-4px_rgba(167,139,250,0.6)]',
    hex: '#a78bfa',
  },
  stems: {
    bg: 'bg-stage-stems/10',
    bgStrong: 'bg-stage-stems/20',
    text: 'text-stage-stems',
    border: 'border-stage-stems',
    dot: 'bg-stage-stems',
    glow: 'shadow-[0_0_30px_-4px_rgba(96,165,250,0.6)]',
    hex: '#60a5fa',
  },
  mixing: {
    bg: 'bg-stage-mixing/10',
    bgStrong: 'bg-stage-mixing/20',
    text: 'text-stage-mixing',
    border: 'border-stage-mixing',
    dot: 'bg-stage-mixing',
    glow: 'shadow-[0_0_30px_-4px_rgba(45,212,191,0.6)]',
    hex: '#2dd4bf',
  },
  mastering: {
    bg: 'bg-stage-mastering/10',
    bgStrong: 'bg-stage-mastering/20',
    text: 'text-stage-mastering',
    border: 'border-stage-mastering',
    dot: 'bg-stage-mastering',
    glow: 'shadow-[0_0_30px_-4px_rgba(244,114,182,0.6)]',
    hex: '#f472b6',
  },
  done: {
    bg: 'bg-stage-done/10',
    bgStrong: 'bg-stage-done/20',
    text: 'text-stage-done',
    border: 'border-stage-done',
    dot: 'bg-stage-done',
    glow: 'shadow-[0_0_30px_-4px_rgba(52,211,153,0.6)]',
    hex: '#34d399',
  },
}

export type User = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer'
  timezone: string
}

export type Task = {
  id: string
  title: string
  stage: Stage
  assignee?: string
  done: boolean
  dueAt?: string
}

export type Comment = {
  id: string
  authorId: string
  body: string
  createdAt: string
}

export type Link = {
  id: string
  label: string
  url: string
}

export type Song = {
  id: string
  title: string
  subtitle?: string
  stage: Stage
  producer?: string
  mixer?: string
  tasks: Task[]
  comments: Comment[]
  links: Link[]
}

export type Project = {
  id: string
  name: string
  subtitle?: string
  kind: 'album' | 'podcast' | 'film'
  songs: Song[]
}
