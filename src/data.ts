import type { Project, Song, Stage, Task, User } from './types'

export const USERS: User[] = [
  { id: 'ryan', name: 'Ryan', email: 'ryan@strawhutmedia.com', role: 'admin', timezone: 'America/Los_Angeles' },
  { id: 'maggie', name: 'Maggie Glass', email: 'maggie@example.com', role: 'user', timezone: 'America/Los_Angeles' },
  { id: 'producer', name: 'Producer (TBD)', email: 'producer@example.com', role: 'user', timezone: 'America/Los_Angeles' },
  { id: 'mixer', name: 'Mixer (TBD)', email: 'mixer@example.com', role: 'user', timezone: 'America/New_York' },
]

type Seed = {
  title: string
  subtitle?: string
  stage: Stage
  tasks?: Array<{ title: string; stage: Stage; done?: boolean }>
}

const SEED: Seed[] = [
  {
    title: 'Olive Juice',
    stage: 'tracking',
    tasks: [{ title: 'Decide: add synth?', stage: 'tracking' }],
  },
  {
    title: 'I Know',
    stage: 'tracking',
    tasks: [
      { title: 'Track vocals', stage: 'tracking' },
      { title: 'Guitar tracked', stage: 'tracking', done: true },
    ],
  },
  {
    title: 'Lionheart',
    stage: 'tracking',
    tasks: [
      { title: 'Track vocals', stage: 'tracking' },
      { title: 'Guitar tracked', stage: 'tracking', done: true },
    ],
  },
  {
    title: 'Yellow-Billed Loon',
    stage: 'tracking',
    tasks: [{ title: 'Decide: track drums?', stage: 'tracking' }],
  },
  {
    title: 'Ferocious Beasts',
    stage: 'producing',
  },
  {
    title: 'I Hope That You Die',
    stage: 'producing',
  },
  {
    title: 'Fake Plastic Trees',
    stage: 'tracking',
    tasks: [{ title: 'Decide: add synth or organ?', stage: 'tracking' }],
  },
  {
    title: '500 Miles',
    stage: 'tracking',
    tasks: [{ title: 'Decide: track drums?', stage: 'tracking' }],
  },
  {
    title: 'Long Walk Home',
    subtitle: '2026 version',
    stage: 'tracking',
    tasks: [
      { title: 'Decide: track drums?', stage: 'tracking' },
      { title: 'Decide: add synth?', stage: 'tracking' },
    ],
  },
  {
    title: 'Long Walk Home',
    subtitle: '2015 version',
    stage: 'producing',
  },
  {
    title: 'Mabel',
    stage: 'producing',
  },
  {
    title: 'Oh Wood',
    stage: 'producing',
  },
  {
    title: "I Can't Explain",
    stage: 'done',
  },
  {
    title: 'This Is It',
    stage: 'done',
  },
]

const songs: Song[] = SEED.map((s, i) => {
  const tasks: Task[] = (s.tasks ?? []).map((t, j) => ({
    id: `song-${i + 1}-task-${j + 1}`,
    title: t.title,
    stage: t.stage,
    done: t.done ?? false,
  }))
  return {
    id: `song-${i + 1}`,
    title: s.title,
    subtitle: s.subtitle,
    stage: s.stage,
    tasks,
    comments: [],
    links: [],
  }
})

export const PROJECTS: Project[] = [
  {
    id: 'maggie-glass-record',
    name: 'Maggie Glass — Record',
    subtitle: '13 songs · 14 tracks',
    kind: 'album',
    songs,
  },
]
