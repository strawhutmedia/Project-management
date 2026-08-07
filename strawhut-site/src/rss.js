// Feed-agnostic podcast RSS ingestion.
//
// Reads ANY standard podcast RSS feed (RSS 2.0 + the iTunes podcast
// namespace) — Megaphone, Libsyn, Buzzsprout, Anchor/Spotify, Acast, etc.
// Nothing here is host-specific. Playback uses the episode <enclosure>
// audio URL, which every podcast feed provides.

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  trimValues: true,
});

// Some feeds nest text in CDATA, some inline it; normalize either shape.
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node.__cdata != null) return String(node.__cdata);
  if (node['#text'] != null) return String(node['#text']);
  return '';
}

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function pickImage(node) {
  // itunes:image href, or <image><url>, or media:thumbnail
  const it = node['itunes:image'];
  if (it && it['@_href']) return it['@_href'];
  if (node.image) {
    if (typeof node.image === 'string') return node.image;
    if (node.image.url) return text(node.image.url);
    if (node.image['@_href']) return node.image['@_href'];
  }
  const media = node['media:thumbnail'] || node['media:content'];
  if (media && media['@_url']) return media['@_url'];
  return '';
}

function pickAudio(item) {
  const enc = arr(item.enclosure).find((e) => e && e['@_url']);
  if (enc) return enc['@_url'];
  const media = arr(item['media:content']).find(
    (m) => m && m['@_url'] && String(m['@_type'] || '').startsWith('audio')
  );
  return media ? media['@_url'] : '';
}

function toInt(v) {
  const n = parseInt(text(v), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch and parse a podcast feed.
 * @returns {{ show: object, episodes: object[] }}
 */
export async function fetchFeed(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'StrawHutMedia/1.0 (+https://www.strawhutmedia.com)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Feed returned HTTP ${res.status} for ${feedUrl}`);
  }
  const xml = await res.text();
  return parseFeed(xml, feedUrl);
}

export function parseFeed(xml, feedUrl) {
  const doc = parser.parse(xml);
  const rss = doc.rss || doc;
  const channel = rss.channel || (rss.feed ? rss.feed : null);
  if (!channel) {
    throw new Error('Could not find an RSS <channel> — is this a valid podcast feed?');
  }

  const categories = arr(channel['itunes:category'])
    .map((c) => (c && c['@_text']) || text(c))
    .filter(Boolean);

  const show = {
    feed_url: feedUrl,
    title: text(channel.title).trim(),
    description: text(channel.description) || text(channel['itunes:summary']),
    author: text(channel['itunes:author']) || text(channel['managingEditor']),
    image_url: pickImage(channel),
    link: typeof channel.link === 'string' ? channel.link : text(channel.link),
    categories,
  };
  if (!show.title) throw new Error('Feed has no channel title — not a usable podcast feed.');

  const episodes = arr(channel.item).map((item) => {
    const guidRaw = item.guid;
    const guid =
      (guidRaw && (guidRaw.__cdata || guidRaw['#text'] || (typeof guidRaw === 'string' && guidRaw))) ||
      pickAudio(item) ||
      text(item.link) ||
      text(item.title);
    const pub = text(item.pubDate);
    return {
      guid: String(guid).trim(),
      title: text(item.title).trim(),
      description: text(item['content:encoded']) || text(item.description) || text(item['itunes:summary']),
      audio_url: pickAudio(item),
      image_url: pickImage(item) || show.image_url,
      duration: text(item['itunes:duration']),
      published_at: pub ? new Date(pub).toISOString() : null,
      episode_number: toInt(item['itunes:episode']),
      season: toInt(item['itunes:season']),
    };
  });

  return { show, episodes };
}
