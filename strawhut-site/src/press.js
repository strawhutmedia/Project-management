// Press mentions — auto-pulled from Google News RSS (free, no API key).
// Each configured query returns recent media coverage as a standard RSS feed,
// which we parse, de-dupe, and store for the public Press page.

import { XMLParser } from 'fast-xml-parser';
import { PRESS_QUERIES, pressHintFor, pressBlockedSince, pressPurgeExisting } from './overrides.js';
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

// Resolve an article's real featured image. Google News uses opaque redirect
// links and blocks datacenter IPs (Railway), so we can't scrape the article
// ourselves. Microlink resolves the redirect to the real publisher URL and
// returns its og:image — the actual featured photo. Free tier is ~50 req/day,
// so we keep an in-memory daily budget and degrade gracefully (null → the card
// keeps its branded fallback and we retry the item on a later run/day).
const ML_DAILY_BUDGET = parseInt(process.env.MICROLINK_DAILY_BUDGET || '45', 10);
let _mlBudget = { day: '', used: 0 };
function mlToday() { return new Date().toISOString().slice(0, 10); }
function mlCanCall() {
  const d = mlToday();
  if (_mlBudget.day !== d) _mlBudget = { day: d, used: 0 };
  return _mlBudget.used < ML_DAILY_BUDGET;
}

export async function fetchOgImage(url) {
  if (!url || !mlCanCall()) return null;
  _mlBudget.used++;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const api = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
    const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const img = j && j.status === 'success' && j.data && j.data.image && j.data.image.url;
    return img && /^https?:\/\//i.test(img) ? img : null;
  } catch {
    return null;
  }
}

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
  // Remove any existing post-cutoff mentions of excluded talent (e.g. Brandi
  // Glanville press dated on/after July 1). Pre-cutoff/undated items are kept.
  let removed = 0;
  for (const p of await store.listPressItems({ limit: 1000 })) {
    if (pressPurgeExisting(`${p.title || ''} ${p.snippet || ''} ${p.source || ''}`, p.published_at)) {
      await store.deletePressItem(p.id);
      removed++;
    }
  }
  if (removed) log(`press: removed ${removed} post-cutoff mention(s)`);

  // Backfill lead images for items saved before image support (up to a cap per
  // run so a large table fills in over a few refreshes rather than one long one).
  // Clear any placeholder value left by the diagnostic so it re-resolves.
  for (const p of await store.listPressItems({ limit: 1000 })) {
    if (p.image_url && p.image_url.includes('example.com')) await store.setPressItemImage(p.id, null);
  }
  let backfilled = 0;
  const missing = (await store.listPressItems({ limit: 1000 })).filter((p) => !p.image_url);
  for (const p of missing.slice(0, 20)) {
    const img = await fetchOgImage(p.url);
    if (img) { await store.setPressItemImage(p.id, img); backfilled++; }
    else if (!mlCanCall()) break; // daily image budget spent; resume next run
    await sleep(1100); // respect microlink's ~1 req/sec
  }
  if (backfilled) log(`press: backfilled ${backfilled} thumbnail(s)`);

  const jobs = PRESS_QUERIES.map((q) => ({ query: q, show: null, hint: null }));
  if (includeShows) {
    for (const s of await store.listShows()) {
      if (!s.title) continue;
      const hint = pressHintFor(s.slug); // e.g. ['Phil Rosenthal'] or multiple hosts
      const query = hint
        ? `"${s.title}" (${hint.map((h) => `"${h}"`).join(' OR ')})`
        : `"${s.title}"`;
      jobs.push({ query, show: s, hint });
    }
  }

  let added = 0;
  for (const { query, show, hint } of jobs) {
    try {
      const items = await fetchQuery(query, show ? 8 : 25);
      let n = 0;
      for (const item of items) {
        // Keep existing press, but don't add NEW mentions of excluded talent
        // dated on/after their cutoff (e.g. Brandi Glanville since July 1).
        if (pressBlockedSince(`${item.title} ${item.snippet}`, item.published_at)) continue;
        if (show) {
          const hay = `${item.title} ${item.snippet}`.toLowerCase();
          // With a hint, require ANY hint term (host) to appear; otherwise use
          // the general host/podcast/network relevance gate.
          const ok = hint
            ? hint.some((h) => hay.includes(h.toLowerCase()))
            : relevantToShow(item, show);
          if (!ok) continue;
        }
        // Fetch a lead image so the card isn't text-only (best-effort).
        item.image_url = await fetchOgImage(item.url);
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
