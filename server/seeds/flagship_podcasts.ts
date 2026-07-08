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
import { syncMissingCoversFromRss } from '../rss_cover_sync'

// Ryan's flagship set. Add or remove entries here; the seed is
// idempotent. Optional `fallbackName` is used when iTunes lookup is
// missing collectionName; optional `fallbackArtwork` fills cover art
// when both iTunes lookup AND RSS parsing come up empty (some feeds
// don't publish the itunes:image tag).
type FlagshipEntry = {
  itunesId: string
  fallbackName?: string
  fallbackArtwork?: string
}
const FLAGSHIP_ENTRIES: FlagshipEntry[] = [
  { itunesId: '1620018481', fallbackName: 'Naked Lunch' },
  { itunesId: '1848746721', fallbackName: 'Wicked, The Official Podcast' },
  {
    itunesId: '1835954447',
    fallbackName: 'Only Murders in the Building Official Podcast',
    // Apple CDN URL for the show's cover art. Guaranteed to work even
    // if iTunes lookup / RSS both fail.
    fallbackArtwork: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2c/61/1c/2c611c8d-4d92-9ea4-1ffe-d31128e8f57c/mza_15038265989023095515.png/600x600bb.jpg',
  },
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
  for (const entry of FLAGSHIP_ENTRIES) {
    const { itunesId, fallbackName, fallbackArtwork } = entry
    try {
      const result = await lookupItunes(itunesId)
      const name = (result?.collectionName || fallbackName || '').trim()
      const feedUrl = (result?.feedUrl || '').trim()
      // Prefer 600px iTunes artwork, then 100px, then the hardcoded
      // fallback we stashed on the entry. Guarantees a cover renders
      // even when iTunes returns an empty artworkUrl.
      const artwork = (result?.artworkUrl600 || result?.artworkUrl100 || fallbackArtwork || '').trim()

      if (!name) {
        logInfo('flagship seed: skipping — no name from iTunes or fallback', { itunesId })
        continue
      }

      const existingId = await findExistingProject(name, feedUrl || '__no_feed__')
      if (existingId) {
        await pool.query(
          `UPDATE projects
              SET is_flagship = TRUE,
                  cover_art_url = COALESCE(NULLIF(cover_art_url, ''), $2),
                  rss_feed_url  = COALESCE(NULLIF(rss_feed_url, ''), $3)
            WHERE id = $1`,
          [existingId, artwork || null, feedUrl || null],
        )
        logInfo('flagship seed: existing show flagged', {
          itunesId, name, projectId: existingId, hadArtwork: Boolean(artwork),
        })
        continue
      }

      const slug = await pickUniqueSlug(slugify(name), null)
      const insertRes = await pool.query<{ id: string }>(
        `INSERT INTO projects (name, kind, rss_feed_url, cover_art_url, slug, is_flagship)
         VALUES ($1, 'podcast', $2, $3, $4, TRUE)
         RETURNING id`,
        [name, feedUrl || null, artwork || null, slug],
      )
      logInfo('flagship seed: created show', {
        itunesId, name, projectId: insertRes.rows[0].id, hadArtwork: Boolean(artwork), hadFeed: Boolean(feedUrl),
      })
    } catch (err) {
      logError('flagship seed: failed for id', {
        itunesId, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Fallback: any flagship show still missing artwork gets its cover
  // pulled from the RSS feed (itunes:image tag). Catches shows where
  // the iTunes lookup returned empty artworkUrl fields.
  try {
    const { synced } = await syncMissingCoversFromRss()
    if (synced > 0) logInfo('flagship seed: RSS cover fallback filled', { synced })
  } catch (err) {
    logError('flagship seed: RSS fallback failed', { error: err instanceof Error ? err.message : String(err) })
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
