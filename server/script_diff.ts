// Diff two parsed Final Draft scripts. Used when a producer uploads a
// new version of the .fdx — we want to surface what changed since the
// previous upload so the producer can re-schedule, re-budget, or just
// understand which scenes need attention.
//
// Detection model:
//   added     — scene number is in the new script but not the old
//   removed   — scene number is in the old script but not the new
//   changed   — same number in both, but at least one tracked field
//               differs. tracked fields:
//                 HEADING       — slug text changed (location renamed,
//                                 INT became EXT, time of day shifted)
//                 LOCATION      — location field differs (heading parse)
//                 TIME_OF_DAY   — DAY/NIGHT/etc shifted
//                 PAGE_COUNT    — eighths changed by ≥ 1 eighth
//                 CHARACTERS    — character list added or removed
//                 ACTION_TEXT   — body of the scene changed
//                                 (whitespace-normalized comparison)
//
// Renumbering detection (e.g. scene 78 → 78A) is out of scope for v1.
// If a producer renumbers, it shows as one removed + one added; they
// can mentally reconcile.

import type { ParsedScene } from './fdx_parser'

export type ChangeKind =
  | 'HEADING'
  | 'LOCATION'
  | 'TIME_OF_DAY'
  | 'PAGE_COUNT'
  | 'CHARACTERS'
  | 'ACTION_TEXT'

export type DiffAddedScene = {
  number: string
  slug: string
  location: string | null
  timeOfDay: string | null
  intExt: string | null
  characters: string[]
  pageEighths: number
}

export type DiffRemovedScene = {
  number: string
  slug: string
  location: string | null
  pageEighths: number
}

export type DiffChangedScene = {
  number: string
  changes: ChangeKind[]
  before: {
    slug: string
    location: string | null
    timeOfDay: string | null
    pageEighths: number
    characters: string[]
    actionTextLen: number
  }
  after: {
    slug: string
    location: string | null
    timeOfDay: string | null
    pageEighths: number
    characters: string[]
    actionTextLen: number
  }
}

export type ScriptDiff = {
  added: DiffAddedScene[]
  removed: DiffRemovedScene[]
  changed: DiffChangedScene[]
  unchanged: number
}

function normalizeText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function arraysSameUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

export function diffScripts(oldScenes: ParsedScene[], newScenes: ParsedScene[]): ScriptDiff {
  const oldByNumber = new Map<string, ParsedScene>()
  for (const s of oldScenes) oldByNumber.set(s.number, s)
  const newByNumber = new Map<string, ParsedScene>()
  for (const s of newScenes) newByNumber.set(s.number, s)

  const added: DiffAddedScene[] = []
  const removed: DiffRemovedScene[] = []
  const changed: DiffChangedScene[] = []
  let unchanged = 0

  for (const s of newScenes) {
    const prev = oldByNumber.get(s.number)
    if (!prev) {
      added.push({
        number: s.number,
        slug: s.slug,
        location: s.location,
        timeOfDay: s.timeOfDay,
        intExt: s.intExt,
        characters: s.characters,
        pageEighths: s.pageEighths,
      })
      continue
    }
    const changes: ChangeKind[] = []
    if (normalizeText(prev.slug) !== normalizeText(s.slug)) changes.push('HEADING')
    if (normalizeText(prev.location) !== normalizeText(s.location)) changes.push('LOCATION')
    if (normalizeText(prev.timeOfDay) !== normalizeText(s.timeOfDay)) changes.push('TIME_OF_DAY')
    if (Math.abs(prev.pageEighths - s.pageEighths) >= 1) changes.push('PAGE_COUNT')
    if (!arraysSameUnordered(prev.characters, s.characters)) changes.push('CHARACTERS')
    if (normalizeText(prev.actionText) !== normalizeText(s.actionText)) changes.push('ACTION_TEXT')

    if (changes.length === 0) {
      unchanged += 1
      continue
    }
    changed.push({
      number: s.number,
      changes,
      before: {
        slug: prev.slug,
        location: prev.location,
        timeOfDay: prev.timeOfDay,
        pageEighths: prev.pageEighths,
        characters: prev.characters,
        actionTextLen: (prev.actionText ?? '').length,
      },
      after: {
        slug: s.slug,
        location: s.location,
        timeOfDay: s.timeOfDay,
        pageEighths: s.pageEighths,
        characters: s.characters,
        actionTextLen: (s.actionText ?? '').length,
      },
    })
  }

  for (const s of oldScenes) {
    if (!newByNumber.has(s.number)) {
      removed.push({
        number: s.number,
        slug: s.slug,
        location: s.location,
        pageEighths: s.pageEighths,
      })
    }
  }

  return { added, removed, changed, unchanged }
}
