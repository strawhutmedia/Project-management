// Discover every show on the current strawhutmedia.com and import each by its
// RSS feed. Used by the admin "Import all shows" button and the CLI script.

import { addShowFromFeed } from './sync.js';

const UA = 'StrawHutMedia-Importer/1.0';

// Paths on the current site that are NOT shows.
const NOT_SHOWS = new Set([
  '', 'shows', 'studio', 'advertise', 'press', 'comingshow', 'ourpodcasthosts',
  'trendingepisode', 'commune-courses-380', 'commune-with-jeff-krasno',
  'psychoanalyzing-the-patient',
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

function extractFeed(html) {
  const m =
    html.match(/https:\/\/feeds\.megaphone\.fm\/[A-Za-z0-9]+/) ||
    html.match(/href="(https?:\/\/[^"]+(?:\/rss|\.rss|\/feed)[^"]*)"/i);
  return m ? m[1] || m[0] : null;
}

/**
 * Crawl the site and import every discoverable show.
 * @returns {{ ok: number, failed: number, total: number }}
 */
export async function importFromSite(store, { site = 'https://www.strawhutmedia.com', onProgress = () => {} } = {}) {
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
      const feed = extractFeed(await get(`${site}/${p}`));
      if (!feed) {
        failed++;
        continue;
      }
      const { show, created, added } = await addShowFromFeed(store, feed);
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
