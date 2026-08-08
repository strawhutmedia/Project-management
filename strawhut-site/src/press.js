// Press mentions — auto-pulled from Google News RSS (free, no API key).
// Each configured query returns recent media coverage as a standard RSS feed,
// which we parse, de-dupe, and store for the public Press page.

import { XMLParser } from 'fast-xml-parser';
import { PRESS_QUERIES } from './overrides.js';
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

/** Fetch + parse one query's mentions. */
async function fetchQuery(query) {
  const res = await fetch(newsUrl(query), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const doc = parser.parse(await res.text());
  const items = arr(doc?.rss?.channel?.item);
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

/** Fetch all configured queries and upsert into the store. Returns count added. */
export async function refreshPress(store, { log = () => {} } = {}) {
  let added = 0;
  for (const q of PRESS_QUERIES) {
    try {
      const items = await fetchQuery(q);
      for (const item of items) {
        const isNew = await store.upsertPressItem(item);
        if (isNew) added++;
      }
      log(`press: "${q}" → ${items.length} items`);
    } catch (e) {
      log(`press: "${q}" failed — ${e.message}`);
    }
  }
  if (added && store.save) await store.save();
  return added;
}
