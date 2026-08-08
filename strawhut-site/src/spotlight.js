// Monthly rotating homepage spotlight.
//
// Each calendar month, deterministically pick a different set of shows from
// SPOTLIGHT_POOL and mark them `featured`. Same month → same picks (stable);
// new month → the window advances so a fresh trio is spotlighted. No cron
// needed — it recomputes on boot and on each scheduler cycle, so it flips
// automatically when the month rolls over.

import { SPOTLIGHT_POOL, EVERGREEN_SHOWS } from './overrides.js';
import { megaphoneConfigured, downloadsBySlug } from './popularity.js';

const RECENT_DAYS = Math.max(14, parseInt(process.env.SPOTLIGHT_ACTIVE_DAYS || '120', 10));
const MIN_DOWNLOADS = Math.max(0, parseInt(process.env.SPOTLIGHT_MIN_DOWNLOADS || '1000', 10));

// Eligible = recently active (new episode within RECENT_DAYS) OR evergreen OR
// (Megaphone configured and still pulling downloads above MIN_DOWNLOADS).
async function eligibleSlugs(store, { log = () => {}, date = new Date() } = {}) {
  const shows = await store.listShows();
  const bySlug = new Map(shows.map((s) => [s.slug, s]));
  let dmap = null;
  if (megaphoneConfigured()) {
    try { dmap = await downloadsBySlug(store, { log }); } catch (e) { log('downloads lookup failed: ' + e.message); }
  }
  const eligible = [];
  for (const slug of SPOTLIGHT_POOL) {
    const show = bySlug.get(slug);
    if (!show) continue;
    const evergreen = EVERGREEN_SHOWS.includes(slug);
    const eps = await store.listEpisodes(show.id, { limit: 1 });
    const last = eps[0] && eps[0].published_at ? new Date(eps[0].published_at) : null;
    const active = last ? (date - last) / 86400000 <= RECENT_DAYS : false;
    const popular = dmap && dmap.get(slug) != null && dmap.get(slug) >= MIN_DOWNLOADS;
    if (active || evergreen || popular) eligible.push(slug);
    else log(`spotlight: skipping "${show.title}" (inactive, not evergreen, no strong downloads)`);
  }
  return eligible;
}

export function monthlyPicks(poolSlugs, count = 3, date = new Date()) {
  const pool = poolSlugs.slice();
  if (pool.length <= count) return pool;
  const monthIdx = date.getUTCFullYear() * 12 + date.getUTCMonth();
  const start = (monthIdx * count) % pool.length;
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(pool[(start + i) % pool.length]);
  return [...new Set(picks)];
}

/**
 * Apply this month's spotlight: feature the chosen pool shows, unfeature the
 * rest. Only pool shows that actually exist are eligible.
 */
export async function applyMonthlyRotation(store, { count = 3, log = () => {}, date = new Date() } = {}) {
  const shows = await store.listShows();
  const bySlug = new Map(shows.map((s) => [s.slug, s]));
  const present = await eligibleSlugs(store, { log, date });
  if (!present.length) return { applied: false, reason: 'no eligible pool shows' };

  const picks = new Set(monthlyPicks(present, count, date));
  for (const s of shows) {
    const want = picks.has(s.slug);
    if (!!s.featured !== want) await store.updateShow(s.id, { featured: want });
  }
  const titles = [...picks].map((slug) => bySlug.get(slug).title);
  log(`spotlight (this month): ${titles.join(', ')}`);
  return { applied: true, picks: titles };
}
