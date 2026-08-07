// Discover every show on the current strawhutmedia.com and import each by its
// RSS feed. Used by the admin "Import all shows" button and the CLI script.

import { addShowFromFeed } from './sync.js';
import { IMPORT_OVERRIDES, RETIRE_FEEDS, isPartnerTitle } from './overrides.js';

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
  // Retire superseded feeds first so stale duplicates don't linger (and slugs
  // free up for the corrected show).
  for (const s of await store.listShows()) {
    if (RETIRE_FEEDS.includes(s.feed_url)) {
      await store.deleteShow(s.id);
      onProgress(`retired stale feed for "${s.title}"`);
    }
  }

  onProgress(`Discovering shows on ${site}…`);
  let paths = discoverShowPaths(await get(site + '/'));
  try {
    paths = [...new Set([...paths, ...discoverShowPaths(await get(site + '/shows'))])];
  } catch {}
  onProgress(`Found ${paths.length} candidate show pages.`);

  let ok = 0;
  let failed = 0;
  for (const p of paths) {
    try {
      const ov = IMPORT_OVERRIDES[p] || {};
      const feed = ov.feed_url || extractFeed(await get(`${site}/${p}`));
      if (!feed) {
        failed++;
        continue;
      }
      const { show, created, added } = await addShowFromFeed(store, feed, {
        show_type: ov.show_type,
      });
      // Enforce classification even for shows that already existed.
      const wantType = ov.show_type || (isPartnerTitle(show.title) ? 'partnered' : null);
      if (wantType && show.show_type !== wantType) {
        await store.updateShow(show.id, { show_type: wantType });
      }
      onProgress(`${created ? '+' : '='} ${show.title} (${added} eps)`);
      ok++;
    } catch (e) {
      onProgress(`! failed ${p}: ${e.message}`);
      failed++;
    }
  }
  onProgress(`Import done: ${ok} shows imported/updated, ${failed} skipped.`);
  return { ok, failed, total: paths.length };
}
