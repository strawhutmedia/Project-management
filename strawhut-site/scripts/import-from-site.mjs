// One-time migration: discover every show on the CURRENT strawhutmedia.com
// and import it into this app by its RSS feed. Run once to bring all past
// originals and partner shows across.
//
//   node scripts/import-from-site.mjs
//
// Every imported show defaults to "original"; reclassify partner shows in the
// admin (Shows → "→ Partner"). Re-running is safe — existing shows re-sync
// instead of duplicating.

import { createStore } from '../src/store.js';
import { addShowFromFeed } from '../src/sync.js';

const SITE = process.env.IMPORT_SITE || 'https://www.strawhutmedia.com';
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
    if (NOT_SHOWS.has(p)) continue;
    if (p.includes('/')) continue; // skip episode sub-paths
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

const store = await createStore();
console.log('Discovering shows on', SITE, '…');
const home = await get(SITE + '/');
let paths = discoverShowPaths(home);
try {
  paths = [...new Set([...paths, ...discoverShowPaths(await get(SITE + '/shows'))])];
} catch {}
console.log('Found', paths.length, 'candidate show pages.');

let ok = 0,
  fail = 0;
for (const p of paths) {
  try {
    const html = await get(`${SITE}/${p}`);
    const feed = extractFeed(html);
    if (!feed) {
      console.log('  – no feed found:', p);
      fail++;
      continue;
    }
    const { show, created, added } = await addShowFromFeed(store, feed);
    console.log(`  ${created ? '+' : '='} ${show.title} (${added} eps)`);
    ok++;
  } catch (e) {
    console.log('  ! failed', p, '-', e.message);
    fail++;
  }
}
const stats = await store.stats();
console.log(`\nDone. Imported/updated ${ok} shows (${fail} skipped). Totals:`, stats);
console.log('Reclassify partner shows in the admin under Shows.');
