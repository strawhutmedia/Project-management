import type { Project, User } from './types'

export const USERS: User[] = [
  { id: 'ryan', name: 'Ryan', email: 'ryan@strawhutmedia.com', role: 'admin', timezone: 'America/Los_Angeles' },
  { id: 'maggie', name: 'Maggie Glass', email: 'maggie@example.com', role: 'user', timezone: 'America/Los_Angeles' },
  { id: 'producer', name: 'Producer (TBD)', email: 'producer@example.com', role: 'user', timezone: 'America/Los_Angeles' },
  { id: 'mixer', name: 'Mixer (TBD)', email: 'mixer@example.com', role: 'user', timezone: 'America/New_York' },
]

const songTitles = [
  'Olive Juice',
  'I Know',
  'Lionheart',
  'Yellow-Billed Loon',
  'Ferocious Beasts',
  'I Hope That You Die',
  'Fake Plastic Trees',
  '500 Miles',
  'Long Walk Home',
  'Long Walk Home',
  'Mabel',
  'Oh Wood',
  "I Can't Explain",
  'This Is It',
]

const subtitles: Record<number, string> = {
  9: '2026 version',
  10: '2015 version',
}

export const PROJECTS: Project[] = [
  {
    id: 'maggie-glass-record',
    name: 'Maggie Glass — Record',
    subtitle: '13 songs · 14 tracks',
    kind: 'album',
    songs: songTitles.map((title, i) => ({
      id: `song-${i + 1}`,
      title,
      subtitle: subtitles[i + 1],
      stage: 'writing',
      tasks: [],
      comments: [],
      links: [],
    })),
  },
]
