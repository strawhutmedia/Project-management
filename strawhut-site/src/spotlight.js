// Monthly rotating homepage spotlight.
//
// Each calendar month, deterministically pick a different set of shows from
// SPOTLIGHT_POOL and mark them `featured`. Same month → same picks (stable);
// new month → the window advances so a fresh trio is spotlighted. No cron
// needed — it recomputes on boot and on each scheduler cycle, so it flips
// automatically when the month rolls over.

import { SPOTLIGHT_POOL } from './overrides.js';

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
  const present = SPOTLIGHT_POOL.filter((slug) => bySlug.has(slug));
  if (!present.length) return { applied: false, reason: 'no pool shows present yet' };

  const picks = new Set(monthlyPicks(present, count, date));
  for (const s of shows) {
    const want = picks.has(s.slug);
    if (!!s.featured !== want) await store.updateShow(s.id, { featured: want });
  }
  const titles = [...picks].map((slug) => bySlug.get(slug).title);
  log(`spotlight (this month): ${titles.join(', ')}`);
  return { applied: true, picks: titles };
}
