// Extract podcast cover art from each show's RSS feed and populate
// projects.cover_art_url when it's missing. Runs once at boot and can
// be triggered on-demand via the admin endpoint below.
//
// Podcast RSS uses <itunes:image href="…" /> at the channel level.
// Some feeds also expose <image><url>…</url></image>. We check both,
// prefer the itunes:image (higher res, more consistent).

import { pool } from './db'
import { logError, logInfo } from './diag'

const FETCH_TIMEOUT_MS = 10_000
const USER_AGENT = 'SlateBot/1.0 (+https://slate.strawhutmedia.com)'

async function extractCoverFromRss(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/xml, text/xml, */*' },
    })
    if (!res.ok) return null
    const body = await res.text()
    // itunes:image href="..." (preferred) — look inside the <channel>
    // block only so we don't pick up per-episode covers.
    const channelStart = body.indexOf('<channel')
    if (channelStart < 0) return null
    // <itunes:image href="..."/> can be self-closing or paired.
    const itunes = body.slice(channelStart).match(/<itunes:image[^>]*\shref\s*=\s*["']([^"']+)["']/i)
    if (itunes?.[1]) return itunes[1].trim()
    // Fallback: <image><url>…</url></image>
    const legacy = body.slice(channelStart).match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i)
    if (legacy?.[1]) return legacy[1].trim()
    return null
  } catch (err) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Fill in cover_art_url for any podcast where the RSS feed is set but
// the cover isn't. Runs on boot and again if the admin triggers.
export async function syncMissingCoversFromRss(): Promise<{ synced: number; skipped: number }> {
  const { rows } = await pool.query<{ id: string; name: string; rss_feed_url: string }>(
    `SELECT id, name, rss_feed_url
       FROM projects
      WHERE kind = 'podcast'
        AND rss_feed_url IS NOT NULL AND rss_feed_url <> ''
        AND (cover_art_url IS NULL OR cover_art_url = '')`,
  )
  let synced = 0
  let skipped = 0
  for (const r of rows) {
    const cover = await extractCoverFromRss(r.rss_feed_url)
    if (cover) {
      await pool.query(`UPDATE projects SET cover_art_url = $1 WHERE id = $2`, [cover, r.id])
      logInfo('rss-cover-sync: pulled', { id: r.id, name: r.name, cover })
      synced += 1
    } else {
      logInfo('rss-cover-sync: no cover found', { id: r.id, name: r.name, feed: r.rss_feed_url })
      skipped += 1
    }
  }
  return { synced, skipped }
}

// Runs syncMissingCoversFromRss in the background so it doesn't block
// server startup. Errors are logged but don't crash the process.
export function scheduleBootTimeCoverSync(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const { synced, skipped } = await syncMissingCoversFromRss()
        logInfo('rss-cover-sync: boot pass complete', { synced, skipped })
      } catch (err) {
        logError('rss-cover-sync: boot pass failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, 5_000).unref()
}
