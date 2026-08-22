// Semantic recommendation engine.
//
// Builds an in-memory index of episode embeddings (computed locally, see
// embeddings.js) and serves "you might also like" by true meaning-similarity.
// A minimum-similarity threshold means we show FEWER (or no) recommendations
// rather than inaccurate ones — accuracy over filling slots.

import { embed, episodeText, cosine } from './embeddings.js';

const MIN_SIM = 0.25; // below this, we don't consider it a real match

let index = []; // { id, show_id, showSlug, showTitle, slug, title, image_url, duration, vec }
let byId = new Map();
let ready = false;

export function indexReady() {
  return ready;
}

function addToIndex(entry) {
  index.push(entry);
  byId.set(entry.id, entry);
}

/**
 * Compute embeddings for any episodes missing them and build the index.
 * Safe to call once at boot; long-running episodes embed in the background
 * while the site serves the genre fallback until ready.
 */
export async function buildIndex(store, { log = console.log } = {}) {
  const shows = await store.listShows();
  const showById = Object.fromEntries(shows.map((s) => [s.id, s]));
  const eps = await store.allEpisodesRaw();
  let embedded = 0;
  for (const e of eps) {
    if (byId.has(e.id)) continue;
    let vec = e.embedding;
    if (typeof vec === 'string') {
      try {
        vec = JSON.parse(vec);
      } catch {
        vec = null;
      }
    }
    if (!vec || !vec.length) {
      const show = showById[e.show_id];
      vec = await embed(episodeText(show, e));
      await store.setEpisodeEmbedding(e.id, vec);
      embedded++;
      if (embedded % 200 === 0) {
        await store.save?.();
        log(`[reco] embedded ${embedded} episodes…`);
      }
    }
    const show = showById[e.show_id] || {};
    addToIndex({
      id: e.id,
      show_id: e.show_id,
      showSlug: show.slug,
      showTitle: show.title,
      slug: e.slug,
      title: e.title,
      image_url: e.image_url || show.image_url,
      duration: e.duration,
      vec,
    });
  }
  await store.save?.();
  ready = true;
  log(`[reco] index ready: ${index.length} episodes (${embedded} newly embedded)`);
}

/** Pick up newly-synced episodes (called after scheduled feed syncs). */
export async function refresh(store) {
  if (!ready) return;
  try {
    await buildIndex(store, { log: () => {} });
  } catch (e) {
    console.error('[reco] refresh failed:', e.message);
  }
}

/**
 * Cross-show recommendations for an episode, ranked by meaning similarity,
 * max one per show for variety, filtered by MIN_SIM for accuracy.
 */
export function related(episodeId, showId, { limit = 4 } = {}) {
  if (!ready) return [];
  const cur = byId.get(episodeId);
  if (!cur) return [];
  const scored = [];
  for (const x of index) {
    if (x.show_id === showId) continue; // cross-show only
    const sim = cosine(cur.vec, x.vec);
    if (sim >= MIN_SIM) scored.push({ x, sim });
  }
  scored.sort((a, b) => b.sim - a.sim);
  const seenShows = new Set();
  const out = [];
  for (const { x, sim } of scored) {
    if (seenShows.has(x.show_id)) continue;
    seenShows.add(x.show_id);
    out.push({ ...x, sim });
    if (out.length >= limit) break;
  }
  return out;
}
