// Press mentions — auto-pulled from Google News RSS (free, no API key).
// Each configured query returns recent media coverage as a standard RSS feed,
// which we parse, de-dupe, and store for the public Press page.

import { XMLParser } from 'fast-xml-parser';
import { PRESS_QUERIES, pressHintFor } from './overrides.js';
import { toText } from './util.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', cdataPropName: '__cdata' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node.__cdata != null) return String(node.__cdata);
  if (node['#text'] != null) return String(node['#text']);
  return '';
}
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

function newsUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch + parse one query's mentions (capped to the freshest `limit`). */
async function fetchQuery(query, limit = 15) {
  const res = await fetch(newsUrl(query), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const doc = parser.parse(await res.text());
  const items = arr(doc?.rss?.channel?.item).slice(0, limit);
  return items.map((it) => {
    const rawTitle = text(it.title);
    const source = (it.source && (it.source['#text'] || it.source.__cdata)) || '';
    // Google News titles are "Headline - Outlet"; strip the trailing outlet.
    const title = source && rawTitle.endsWith(` - ${source}`)
      ? rawTitle.slice(0, -(source.length + 3))
      : rawTitle.replace(/\s+-\s+[^-]+$/, '');
    const pub = text(it.pubDate);
    return {
      title: title.trim(),
      url: text(it.link).trim(),
      source: String(source).trim(),
      published_at: pub ? new Date(pub).toISOString() : null,
      snippet: toText(text(it.description), 240),
      query,
    };
  }).filter((i) => i.title && i.url);
}

// Does a show-title mention actually look like it's about THAT show (not a
// same-named book/film/person)? Require it to reference the podcast, the
// network, or the host — filtering out name collisions.
function relevantToShow(item, show) {
  const hay = `${item.title} ${item.snippet}`.toLowerCase();
  const needles = ['podcast', 'straw hut'];
  if (show.author) {
    const a = show.author.toLowerCase().replace(/\b(inc|llc|media|productions?|network)\b/g, '').trim();
    if (a.length > 2) needles.push(a);
  }
  // Host name(s) after "with" / "w/" in the title (e.g. "…with Jay Kogen").
  const m = show.title.match(/(?:with|w\/)\s+(.+)$/i);
  if (m) {
    for (const part of m[1].toLowerCase().split(/\s+and\s+|,|&/)) {
      const p = part.trim();
      if (p.length > 2) needles.push(p);
    }
  }
  return needles.some((n) => n && hay.includes(n));
}

/**
 * Refresh press. Searches the configured company queries PLUS every show's
 * exact title. Company matches always post; per-show matches must pass a
 * relevance gate (avoids same-name book/film/person collisions). De-dupes by
 * URL, throttled to be gentle on Google News.
 */
export async function refreshPress(store, { log = () => {}, includeShows = true } = {}) {
  const jobs = PRESS_QUERIES.map((q) => ({ query: q, show: null, hint: null }));
  if (includeShows) {
    for (const s of await store.listShows()) {
      if (!s.title) continue;
      const hint = pressHintFor(s.title); // e.g. ['Phil Rosenthal']
      const query = hint ? `"${s.title}" ${hint.map((h) => `"${h}"`).join(' ')}` : `"${s.title}"`;
      jobs.push({ query, show: s, hint });
    }
  }

  let added = 0;
  for (const { query, show, hint } of jobs) {
    try {
      const items = await fetchQuery(query, show ? 8 : 25);
      let n = 0;
      for (const item of items) {
        if (show) {
          const hay = `${item.title} ${item.snippet}`.toLowerCase();
          // With a hint, require every hint term to appear; otherwise use the
          // general host/podcast/network relevance gate.
          const ok = hint
            ? hint.every((h) => hay.includes(h.toLowerCase()))
            : relevantToShow(item, show);
          if (!ok) continue;
        }
        if (await store.upsertPressItem(item)) { added++; n++; }
      }
      if (n) log(`press: ${query} → +${n}`);
    } catch (e) {
      log(`press: ${query} failed — ${e.message}`);
    }
    await sleep(350);
  }
  if (added && store.save) await store.save();
  log(`press: refresh complete, ${added} new across ${jobs.length} queries`);
  return added;
}
