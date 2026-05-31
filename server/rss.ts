// Lightweight RSS reader for podcast feeds. We only care about a handful
// of channel-level fields (title, description, cover art), so regex
// against a stable iTunes-podcasting feed shape is enough — no XML
// parser dependency. Each helper returns the value or null when missing.
import { logError, logInfo } from './diag'

const FETCH_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 5 * 1024 * 1024 // 5 MB — podcast RSS feeds are tiny

export type PodcastFeedMeta = {
  title: string | null
  description: string | null
  coverArtUrl: string | null
  episodes: Array<{ title: string; description: string | null }>
}

export async function fetchPodcastFeed(url: string): Promise<PodcastFeedMeta> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Slate/0.2 (+https://slate.strawhutmedia.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('rss: fetch failed', { url, error: msg })
    throw new Error(`rss_fetch_failed: ${msg.slice(0, 200)}`)
  }
  if (!res.ok) {
    throw new Error(`rss_http_${res.status}`)
  }
  // Cap the read so a misconfigured feed can't OOM us.
  const reader = res.body?.getReader()
  if (!reader) throw new Error('rss_no_body')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BODY_BYTES) {
      reader.cancel().catch(() => {})
      throw new Error('rss_body_too_large')
    }
    chunks.push(value)
  }
  const body = new TextDecoder('utf-8').decode(concat(chunks))
  const meta = parseChannelMeta(body)
  logInfo('rss: parsed', { url, hasCover: Boolean(meta.coverArtUrl), title: meta.title })
  return meta
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}

function parseChannelMeta(xml: string): PodcastFeedMeta {
  // Scope to the <channel>…</channel> block so we don't accidentally pick
  // up the first <item>'s title or image.
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i)
  const channel = channelMatch ? channelMatch[1] : xml

  // Title — first non-empty <title> inside the channel.
  const titleMatch = channel.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeXml(stripCdata(titleMatch[1])).trim() : null

  // Description — try <itunes:summary> first, then <description>.
  const descMatch = channel.match(/<itunes:summary[^>]*>([\s\S]*?)<\/itunes:summary>/i)
    || channel.match(/<description[^>]*>([\s\S]*?)<\/description>/i)
  const description = descMatch ? decodeXml(stripCdata(descMatch[1])).trim().slice(0, 1000) : null

  // Cover art — iTunes-style attribute first, fall back to <image><url>.
  let coverArtUrl: string | null = null
  const itunesImg = channel.match(/<itunes:image[^>]+href\s*=\s*["']([^"']+)["']/i)
  if (itunesImg) coverArtUrl = itunesImg[1].trim()
  if (!coverArtUrl) {
    const imageUrl = channel.match(/<image[^>]*>[\s\S]*?<url[^>]*>([\s\S]*?)<\/url>/i)
    if (imageUrl) coverArtUrl = decodeXml(stripCdata(imageUrl[1])).trim()
  }

  // Episodes — pull up to 12 <item> blocks (most recent first) with
  // title + description for downstream voice analysis. Channel block
  // doesn't include <item>s, so scan the full XML for these.
  const episodes: Array<{ title: string; description: string | null }> = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml)) !== null && episodes.length < 12) {
    const body = m[1]
    const t = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!t) continue
    const d = body.match(/<itunes:summary[^>]*>([\s\S]*?)<\/itunes:summary>/i)
      || body.match(/<description[^>]*>([\s\S]*?)<\/description>/i)
    episodes.push({
      title: decodeXml(stripCdata(t[1])).trim(),
      description: d ? decodeXml(stripCdata(d[1])).trim().slice(0, 600) : null,
    })
  }

  return { title, description, coverArtUrl, episodes }
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}
