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
  producing: 'Producing',
  stems: 'Stems',
  mixing: 'Mixing',
  mastering: 'Mastering',
  done: 'Done',
}

export const STAGE_COLOR: Record<Stage, { bg: string; text: string; border: string; dot: string }> = {
  writing: { bg: 'bg-stage-writing/10', text: 'text-stage-writing', border: 'border-stage-writing', dot: 'bg-stage-writing' },
  tracking: { bg: 'bg-stage-tracking/10', text: 'text-stage-tracking', border: 'border-stage-tracking', dot: 'bg-stage-tracking' },
  overdubs: { bg: 'bg-stage-overdubs/10', text: 'text-stage-overdubs', border: 'border-stage-overdubs', dot: 'bg-stage-overdubs' },
  producing: { bg: 'bg-stage-producing/10', text: 'text-stage-producing', border: 'border-stage-producing', dot: 'bg-stage-producing' },
  stems: { bg: 'bg-stage-stems/10', text: 'text-stage-stems', border: 'border-stage-stems', dot: 'bg-stage-stems' },
  mixing: { bg: 'bg-stage-mixing/10', text: 'text-stage-mixing', border: 'border-stage-mixing', dot: 'bg-stage-mixing' },
  mastering: { bg: 'bg-stage-mastering/10', text: 'text-stage-mastering', border: 'border-stage-mastering', dot: 'bg-stage-mastering' },
  done: { bg: 'bg-stage-done/10', text: 'text-stage-done', border: 'border-stage-done', dot: 'bg-stage-done' },
}

export type User = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
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
