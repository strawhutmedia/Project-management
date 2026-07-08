// Seeds the flagship podcast shows Ryan wants featured in the
// "Part of Straw Hut Media" section of every one-sheet. Runs once
// at boot; if a show already exists (matched by iTunes ID or name),
// we just make sure is_flagship = TRUE without overwriting anything.
//
// We use Apple's public iTunes lookup API to fetch the RSS feed URL,
// hi-res artwork, and canonical show name — one round-trip per show,
// zero manual RSS-URL hunting.

import { pool } from '../db'
import { logError, logInfo } from '../diag'

// Ryan's flagship set. Add or remove IDs here; the seed is idempotent.
const FLAGSHIP_ITUNES_IDS = [
  '1620018481',   // Naked Lunch
  '1848746721',   // Wicked — The Official Podcast
  '1835954447',   // Only Murders in the Building Official Podcast
]

type ItunesResult = {
  collectionName?: string
  feedUrl?: string
  artworkUrl600?: string
  artworkUrl100?: string
  trackViewUrl?: string
}

async function lookupItunes(id: string): Promise<ItunesResult | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcast`, {
      signal: controller.signal,
      headers: { 'user-agent': 'SlateBot/1.0 (+https://slate.strawhutmedia.com)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = await res.json() as { results?: ItunesResult[] }
    return json.results?.[0] ?? null
  } catch {
    return null
  }
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 100) || 'show'
}

async function findExistingProject(name: string, feedUrl: string): Promise<string | null> {
  // Match by canonical name OR RSS feed URL so re-runs don't create duplicates.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM projects
      WHERE kind = 'podcast'
        AND (LOWER(name) = LOWER($1) OR rss_feed_url = $2)
      LIMIT 1`,
    [name, feedUrl],
  )
  return rows[0]?.id ?? null
}

async function pickUniqueSlug(base: string, ownId: string | null): Promise<string> {
  let candidate = base
  for (let i = 2; i < 100; i++) {
    const clash = await pool.query<{ id: string }>(
      `SELECT id FROM projects WHERE slug = $1 LIMIT 1`, [candidate],
    )
    if (clash.rows.length === 0) return candidate
    if (clash.rows[0].id === ownId) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}

export async function seedFlagshipPodcasts(): Promise<void> {
  for (const id of FLAGSHIP_ITUNES_IDS) {
    try {
      const result = await lookupItunes(id)
      if (!result?.collectionName || !result.feedUrl) {
        logInfo('flagship seed: itunes lookup empty', { id })
        continue
      }
      const name = result.collectionName.trim()
      const feedUrl = result.feedUrl.trim()
      // Prefer 600px artwork; some responses only expose the 100px thumbnail.
      const artwork = (result.artworkUrl600 || result.artworkUrl100 || '').trim()

      const existingId = await findExistingProject(name, feedUrl)
      if (existingId) {
        // Just make sure the flagship flag is on. Don't overwrite the
        // producer's manual tweaks to name / cover / rss.
        await pool.query(
          `UPDATE projects SET is_flagship = TRUE WHERE id = $1`,
          [existingId],
        )
        logInfo('flagship seed: existing show flagged', { id, name, projectId: existingId })
        continue
      }

      const slug = await pickUniqueSlug(slugify(name), null)
      const insertRes = await pool.query<{ id: string }>(
        `INSERT INTO projects (name, kind, rss_feed_url, cover_art_url, slug, is_flagship)
         VALUES ($1, 'podcast', $2, $3, $4, TRUE)
         RETURNING id`,
        [name, feedUrl, artwork || null, slug],
      )
      logInfo('flagship seed: created show', { id, name, projectId: insertRes.rows[0].id })
    } catch (err) {
      logError('flagship seed: failed for id', {
        id, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// Schedule the seed to run in the background 8s after boot — after
// migrations, before RSS cover sync (which handles remaining shows).
export function scheduleFlagshipSeed(): void {
  setTimeout(() => {
    void (async () => {
      try {
        await seedFlagshipPodcasts()
        logInfo('flagship seed: complete')
      } catch (err) {
        logError('flagship seed: crashed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, 8_000).unref()
}
