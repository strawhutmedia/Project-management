// Apple Podcasts directory search proxy so the project page can offer
// "find by name" instead of forcing the admin to hunt down the RSS URL.
//
// Uses Apple's free, unauthenticated iTunes Search API:
//   https://itunes.apple.com/search?media=podcast&term=…
//
// We proxy through our server (instead of calling iTunes directly from the
// browser) so the call stays inside our error-handling + logging path and
// we can rate-limit later if needed.
import { Router } from 'express'
import { requireUser, type SessionUser } from '../auth'
import { logError, logInfo } from '../diag'

export const podcastsRouter = Router()
podcastsRouter.use(requireUser)

type ItunesResult = {
  collectionId?: number
  collectionName?: string
  artistName?: string
  artworkUrl60?: string
  artworkUrl100?: string
  artworkUrl600?: string
  feedUrl?: string
  trackCount?: number
  releaseDate?: string
  primaryGenreName?: string
}

podcastsRouter.get('/search', async (req, res) => {
  const _user = (req as typeof req & { user: SessionUser }).user
  const q = String(req.query.q || '').trim()
  if (!q) { res.status(400).json({ error: 'q required' }); return }

  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=12&term=${encodeURIComponent(q)}`
  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: { 'User-Agent': 'Slate/0.2 (+https://slate.strawhutmedia.com)' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('podcasts.search: itunes fetch failed', { q, error: msg })
    res.status(502).json({ error: `itunes_unreachable: ${msg.slice(0, 200)}` })
    return
  }
  if (!upstream.ok) {
    res.status(502).json({ error: `itunes_${upstream.status}` })
    return
  }
  const body = (await upstream.json()) as { resultCount?: number; results?: ItunesResult[] }
  const results = (body.results ?? [])
    .filter((r) => typeof r.feedUrl === 'string' && r.feedUrl.length > 0)
    .map((r) => ({
      itunesId: r.collectionId ?? null,
      title: r.collectionName ?? '(untitled)',
      artist: r.artistName ?? null,
      feedUrl: r.feedUrl as string,
      // 600px tile is the largest size iTunes returns; good enough for the
      // accent-color sample and a thumbnail in the search result list.
      artworkUrl: r.artworkUrl600 ?? r.artworkUrl100 ?? r.artworkUrl60 ?? null,
      trackCount: r.trackCount ?? null,
      genre: r.primaryGenreName ?? null,
    }))

  logInfo('podcasts.search', { q, returned: results.length })
  res.json({ results })
})
