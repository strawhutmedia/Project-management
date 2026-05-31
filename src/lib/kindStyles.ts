// Per-kind color tokens for social content cards. Keeping these in one
// place so the episode page, the scheduler backlog, and the scheduler
// day slots all stay visually consistent.
//
// "filled" classes are what we apply to a card whose content is live;
// "label" classes tint the bucket headers and kind pills; "posted"
// is the override for any slot that's been marked as posted.
import type { SchedulerSlotKind } from '../api'

export const KIND_STYLES: Record<SchedulerSlotKind, {
  emoji: string
  shortLabel: string
  label: string
  filled: string
  label_text: string
  ring: string
  empty: string
}> = {
  text_post: {
    emoji: '✍️',
    shortLabel: 'Text',
    label: '✍️ Text posts',
    filled: 'border-sky-400/50 bg-sky-400/[0.06]',
    label_text: 'text-sky-300',
    ring: 'ring-sky-400/60',
    empty: 'border-sky-400/15 bg-sky-400/[0.02]',
  },
  photo_concept: {
    emoji: '📷',
    shortLabel: 'Photo',
    label: '📷 Photos',
    filled: 'border-rose-400/50 bg-rose-400/[0.06]',
    label_text: 'text-rose-300',
    ring: 'ring-rose-400/60',
    empty: 'border-rose-400/15 bg-rose-400/[0.02]',
  },
  reel_concept: {
    emoji: '🎬',
    shortLabel: 'Reel',
    label: '🎬 Reels',
    filled: 'border-amber-400/50 bg-amber-400/[0.06]',
    label_text: 'text-amber-300',
    ring: 'ring-amber-400/60',
    empty: 'border-amber-400/15 bg-amber-400/[0.02]',
  },
  story_concept: {
    emoji: '💬',
    shortLabel: 'Story',
    label: '💬 Stories',
    filled: 'border-violet-400/50 bg-violet-400/[0.06]',
    label_text: 'text-violet-300',
    ring: 'ring-violet-400/60',
    empty: 'border-violet-400/15 bg-violet-400/[0.02]',
  },
}

// Applied on top of `filled` when a scheduler slot is marked as posted.
// Wins over the kind color so SAJ can see at a glance what's done.
export const POSTED_STYLE = 'border-emerald-400/70 bg-emerald-400/10 text-emerald-200'
export const POSTED_LABEL_TEXT = 'text-emerald-300'
