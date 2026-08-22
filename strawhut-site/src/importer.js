// Discover every show on the current strawhutmedia.com and import each by its
// RSS feed. Used by the admin "Import all shows" button and the CLI script.

import { addShowFromFeed } from './sync.js';
import { extractPlatformLinks } from './platforms.js';
import { IMPORT_OVERRIDES, RETIRE_FEEDS, EXCLUDE_SHOW_PATHS, EXTRA_SHOWS } from './overrides.js';

const UA = 'StrawHutMedia-Importer/1.0';

// Paths on the current site that are NOT shows (nav/marketing pages).
const NOT_SHOWS = new Set([
  '', 'shows', 'studio', 'advertise', 'press', 'comingshow', 'ourpodcasthosts',
  'trendingepisode', 'home',
]);

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function discoverShowPaths(html) {
  const paths = new Set();
  for (const m of html.matchAll(/href="\/([a-z0-9][a-z0-9-]+)"/gi)) {
    const p = m[1].toLowerCase();
    if (NOT_SHOWS.has(p) || p.includes('/')) continue;
    paths.add(m[1]);
  }
  return [...paths];
}

// Strip the trailing "-<id>" the site appends to show slugs.
const baseSlug = (p) => p.replace(/-\d+$/, '');

// Read the /shows page's labeled sections ("Original Shows" / "Branded Shows")
// to classify each show. Returns Sets of base slugs. This is authoritative —
// it mirrors exactly how the shows are organized on the current site.
function classifyShows(html) {
  if (!html) return { originalBases: new Set(), brandedBases: new Set() };
  const labels = [...html.matchAll(/class="section-text[^"]*"[^>]*>([^<]+)</g)]
    .map((m) => [m.index, m[1].trim()])
    .sort((a, b) => a[0] - b[0]);
  const ranges = labels.map((l, i) => [l[0], i + 1 < labels.length ? labels[i + 1][0] : html.length, l[1]]);
  const sectionOf = (pos) => {
    for (const [s, e, n] of ranges) if (pos >= s && pos < e) return n;
    return '';
  };
  const originalBases = new Set();
  const brandedBases = new Set();
  for (const m of html.matchAll(/href="(?:https:\/\/www\.strawhutmedia\.com)?\/([a-z0-9][a-z0-9-]+)"/g)) {
    const p = m[1];
    if (NOT_SHOWS.has(p) || p.includes('/')) continue;
    const sec = sectionOf(m.index);
    if (/branded/i.test(sec)) brandedBases.add(baseSlug(p));
    else if (/original/i.test(sec)) originalBases.add(baseSlug(p));
  }
  return { originalBases, brandedBases };
}

// Find a podcast RSS feed URL on a show page. Host-agnostic: Megaphone,
// Spreaker, Libsyn, Simplecast, etc. Prefers a direct host feed over the
// Google Podcasts redirect wrapper.
function extractFeed(html) {
  const patterns = [
    /https?:\/\/feeds\.megaphone\.fm\/[A-Za-z0-9]+/i,
    /https?:\/\/(?:www\.|api\.)?spreaker\.com\/(?:show\/\d+\/episodes\/feed|user\/[^"'\s<>]+\/[^"'\s<>]+)/i,
    /https?:\/\/[^"'\s<>]*(?:libsyn\.com|simplecast\.com|acast\.com|omny\.fm|buzzsprout\.com|anchor\.fm|redcircle\.com|captivate\.fm|transistor\.fm|podbean\.com|rss\.com)[^"'\s<>]*/i,
    /https?:\/\/[^"'\s<>]+\/(?:rss|feed)(?:\.xml)?(?:\?[^"'\s<>]*)?/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && !/podcasts\.google\.com|imgix|gstatic|googleapis|\/assets\//i.test(m[0])) {
      return m[0].replace(/&amp;/g, '&');
    }
  }
  return null;
}

/**
 * Crawl the site and import every discoverable show.
 * @returns {{ ok: number, failed: number, total: number }}
 */
export async function importFromSite(store, { site = 'https://www.strawhutmedia.com', onProgress = () => {} } = {}) {
  // Retire superseded feeds and remove excluded (placeholder) shows first, so
  // stale duplicates don't linger and slugs free up for corrected shows.
  const excludeBases = new Set(EXCLUDE_SHOW_PATHS.map(baseSlug));
  for (const s of await store.listShows()) {
    if (
      RETIRE_FEEDS.includes(s.feed_url) ||
      excludeBases.has(s.slug) ||
      excludeBases.has(baseSlug(s.slug))
    ) {
      await store.deleteShow(s.id);
      onProgress(`removed "${s.title}"`);
    }
  }

  onProgress(`Discovering shows on ${site}…`);
  const homeHtml = await get(site + '/');
  let showsHtml = '';
  try { showsHtml = await get(site + '/shows'); } catch {}
  let paths = discoverShowPaths(homeHtml);
  if (showsHtml) paths = [...new Set([...paths, ...discoverShowPaths(showsHtml)])];

  // Authoritative Original vs Branded(partner) classification from /shows.
  const { originalBases, brandedBases } = classifyShows(showsHtml);
  onProgress(`Found ${paths.length} candidate show pages (${originalBases.size} original, ${brandedBases.size} branded).`);

  let ok = 0;
  let failed = 0;
  for (const p of paths) {
    try {
      if (EXCLUDE_SHOW_PATHS.includes(p) || excludeBases.has(baseSlug(p))) continue;
      const ov = IMPORT_OVERRIDES[p] || {};
      let showHtml = '';
      try { showHtml = await get(`${site}/${p}`); } catch {}
      const feed = ov.feed_url || extractFeed(showHtml);
      if (!feed) {
        failed++;
        continue;
      }
      const base = baseSlug(p);
      const siteType = brandedBases.has(base) ? 'partnered' : originalBases.has(base) ? 'original' : null;
      const wantType = ov.show_type || siteType;

      const { show, created, added } = await addShowFromFeed(store, feed, { show_type: wantType });
      // Enforce classification even for shows that already existed.
      if (wantType && show.show_type !== wantType) await store.updateShow(show.id, { show_type: wantType });
      // Curated subscribe links straight off the current site's show page.
      const links = extractPlatformLinks(showHtml);
      if (Object.keys(links).length) {
        const merged = { ...(show.platform_links || {}), ...links };
        await store.updateShow(show.id, { platform_links: JSON.stringify(merged) });
      }
      onProgress(`${created ? '+' : '='} ${show.title} [${show.show_type}] (${added} eps)`);
      ok++;
    } catch (e) {
      onProgress(`! failed ${p}: ${e.message}`);
      failed++;
    }
  }

  // Shows not discoverable on the site (e.g. Only Murders' official feed).
  for (const ex of EXTRA_SHOWS) {
    try {
      const { show, created, added } = await addShowFromFeed(store, ex.feed_url, { show_type: ex.show_type });
      const patch = {};
      if (ex.show_type && show.show_type !== ex.show_type) patch.show_type = ex.show_type;
      if (ex.slug && show.slug !== ex.slug) patch.slug = ex.slug; // clean, stable URL
      if (Object.keys(patch).length) await store.updateShow(show.id, patch);
      onProgress(`${created ? '+' : '='} (extra) ${show.title} (${added} eps)`);
      ok++;
    } catch (e) {
      onProgress(`! extra feed failed ${ex.feed_url}: ${e.message}`);
    }
  }

  onProgress(`Import done: ${ok} shows imported/updated, ${failed} skipped.`);
  return { ok, failed, total: paths.length };
}
