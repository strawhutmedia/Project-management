// Turns feeds into stored shows + episodes, and keeps them fresh.
//
// syncShow() is idempotent: it upserts the show's metadata and inserts only
// episodes it hasn't seen before (matched by GUID). New episodes published to
// the podcast host therefore show up as new pages automatically on each run.

import { fetchFeed } from './rss.js';
import { slugify, uniqueSlug } from './util.js';
import { isFrozenShow } from './overrides.js';

/** Add a brand-new show from a feed URL (used by the admin "Add show" form). */
export async function addShowFromFeed(store, feedUrl, opts = {}) {
  const existing = await store.getShowByFeed(feedUrl);
  if (existing) {
    await syncShow(store, existing);
    return { show: await store.getShowBySlug(existing.slug), created: false };
  }
  const { show: feedShow } = await fetchFeed(feedUrl);

  // Build a unique slug across all shows.
  const taken = new Set((await store.listShows()).map((s) => s.slug));
  const slug = uniqueSlug(slugify(feedShow.title, 'show'), taken);

  const saved = await store.upsertShow({
    ...feedShow,
    slug,
    show_type: opts.show_type === 'partnered' ? 'partnered' : 'original',
    featured: !!opts.featured,
    sort_order: opts.sort_order ?? 0,
    spotify_url: opts.spotify_url || null,
    apple_url: opts.apple_url || null,
  });
  const result = await syncShow(store, saved);
  return { show: await store.getShowBySlug(saved.slug), created: true, ...result };
}

/** Refresh one show: update metadata + pull any new episodes. */
export async function syncShow(store, show) {
  const { show: feedShow, episodes } = await fetchFeed(show.feed_url);

  // Refresh metadata but keep admin-controlled fields (slug, featured, order, links).
  await store.upsertShow({
    id: show.id,
    feed_url: show.feed_url,
    slug: show.slug,
    title: feedShow.title || show.title,
    description: feedShow.description || show.description,
    author: feedShow.author || show.author,
    image_url: feedShow.image_url || show.image_url,
    link: feedShow.link || show.link,
    categories: feedShow.categories?.length ? feedShow.categories : show.categories,
    show_type: show.show_type || 'original',
    featured: show.featured,
    sort_order: show.sort_order,
    spotify_url: show.spotify_url,
    apple_url: show.apple_url,
    last_synced: new Date().toISOString(),
  });

  // Frozen shows keep their existing episodes but never gain new ones.
  if (isFrozenShow(show.slug)) {
    return { added: 0, total: episodes.length, frozen: true };
  }

  const seenGuids = await store.existingGuids(show.id);
  const takenSlugs = await store.existingEpisodeSlugs(show.id);
  let added = 0;

  // Insert oldest-first so slug de-duplication is stable over time.
  for (const ep of [...episodes].reverse()) {
    if (!ep.guid || seenGuids.has(ep.guid)) continue;
    const slug = uniqueSlug(slugify(ep.title, 'episode'), takenSlugs);
    takenSlugs.add(slug);
    seenGuids.add(ep.guid);
    await store.insertEpisode({ ...ep, show_id: show.id, slug });
    added++;
  }
  return { added, total: episodes.length };
}

/** Refresh every show. Returns a per-show summary. */
export async function syncAll(store) {
  const shows = await store.listShows();
  const results = [];
  for (const show of shows) {
    try {
      const r = await syncShow(store, show);
      results.push({ show: show.title, ...r });
    } catch (e) {
      console.error(`[sync] ${show.title} failed:`, e.message);
      results.push({ show: show.title, error: e.message });
    }
  }
  return results;
}

/** Background scheduler — re-checks every feed for new episodes. */
export function startScheduler(store, { afterSync } = {}) {
  const minutes = Math.max(5, parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10));
  const run = async () => {
    try {
      const results = await syncAll(store);
      const added = results.reduce((n, r) => n + (r.added || 0), 0);
      if (added > 0) console.log(`[sync] scheduled run added ${added} new episode page(s)`);
      if (afterSync) await afterSync(added);
    } catch (e) {
      console.error('[sync] scheduled run failed:', e.message);
    }
  };
  setInterval(run, minutes * 60 * 1000);
  console.log(`[sync] scheduler started (every ${minutes} min)`);
}
