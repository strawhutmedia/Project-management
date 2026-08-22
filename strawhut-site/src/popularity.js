// Popularity ranking via the Megaphone CMS API — same source Podbooster uses.
//
// Auth (Railway env vars, NOT committed — copy them from the Podbooster service):
//   MEGAPHONE_API_TOKEN   (required)   Authorization: Token token="..."
//   MEGAPHONE_NETWORK_ID  (required)   which network's podcasts to read
//   SPOTLIGHT_COUNT       (optional)   how many shows to feature (default 3)
//
// When configured, we list the network's podcasts, read each one's download
// numbers, rank them, and mark the top N as "featured" so the homepage
// spotlight reflects real popularity. Inert (no-op) when unconfigured, so the
// curated FEATURED_SHOWS list stays in charge until the env vars exist.

import { s3Configured, downloadsByPodcastId } from './megaphoneS3.js';

const BASE = 'https://cms.megaphone.fm/api';
const TOKEN = (process.env.MEGAPHONE_API_TOKEN || '').trim();
const NETWORK_ID = (process.env.MEGAPHONE_NETWORK_ID || '').trim();

export function megaphoneConfigured() {
  return !!(TOKEN && NETWORK_ID);
}
export function spotlightCount() {
  return Math.max(1, parseInt(process.env.SPOTLIGHT_COUNT || '3', 10));
}

async function mg(path, query = {}) {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    headers: {
      Authorization: `Token token="${TOKEN}"`,
      Accept: 'application/json',
      'User-Agent': 'strawhut-site-megaphone-readonly',
    },
  });
  if (!res.ok) throw new Error(`Megaphone ${path} → ${res.status}`);
  return { json: await res.json().catch(() => null), headers: res.headers };
}

async function listPodcasts() {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const { json } = await mg(`/networks/${NETWORK_ID}/podcasts`, { per_page: 100, page });
    if (!Array.isArray(json) || !json.length) break;
    out.push(...json);
    if (json.length < 100) break;
  }
  return out;
}

// Downloads can surface under different field names / an analytics endpoint;
// try the podcast object first, then a 30-day analytics call.
const DL_FIELDS = [
  'downloads', 'totalDownloads', 'downloadCount', 'download_count',
  'uniqueDownloads', 'unique_downloads', 'last30DayDownloads',
  'rollingDownloads', 'plays', 'totalPlays',
];
function extractDownloads(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const f of DL_FIELDS) {
    const v = obj[f];
    if (typeof v === 'number' && v >= 0) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}

async function podcastDownloads(pod) {
  const direct = extractDownloads(pod);
  if (direct != null) return direct;
  // Fallback: per-podcast analytics for the last 30 days.
  const id = pod.id || pod.uid;
  try {
    const { json } = await mg(`/networks/${NETWORK_ID}/podcasts/${id}/analytics`);
    if (Array.isArray(json)) {
      let sum = 0, found = false;
      for (const row of json) { const d = extractDownloads(row); if (d != null) { sum += d; found = true; } }
      if (found) return sum;
    } else {
      const d = extractDownloads(json);
      if (d != null) return d;
    }
  } catch {}
  return null;
}

/** Return podcasts ranked by downloads (desc). Empty if no numbers available. */
export async function computeRankings({ log = () => {} } = {}) {
  const pods = await listPodcasts();
  log(`megaphone: ${pods.length} podcasts in network`);
  const ranked = [];
  for (const p of pods) {
    const downloads = await podcastDownloads(p);
    ranked.push({
      title: p.title || '',
      uid: p.uid || p.id || '',
      feedUrl: p.feedUrl || p.link || '',
      downloads,
    });
  }
  const withNums = ranked.filter((r) => typeof r.downloads === 'number');
  withNums.sort((a, b) => b.downloads - a.downloads);
  return withNums;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Diagnostic: inspect what the Megaphone API actually returns for downloads. */
export async function probe() {
  if (!megaphoneConfigured()) return { configured: false };
  const out = { configured: true };
  try {
    const { json: pods } = await mg(`/networks/${NETWORK_ID}/podcasts`, { per_page: 5 });
    out.podcastCount = Array.isArray(pods) ? pods.length : 0;
    out.podcastKeys = Array.isArray(pods) && pods[0] ? Object.keys(pods[0]) : [];
    out.sample = (Array.isArray(pods) ? pods.slice(0, 3) : []).map((p) => ({
      title: p.title, dl: extractDownloads(p),
    }));
    const first = Array.isArray(pods) && pods[0] ? pods[0].id || pods[0].uid : null;
    out.tries = [];
    for (const ep of first
      ? [
          `/networks/${NETWORK_ID}/podcasts/${first}`,
          `/networks/${NETWORK_ID}/podcasts/${first}/analytics`,
          `/podcasts/${first}/analytics`,
          `/networks/${NETWORK_ID}/podcasts/${first}/episodes?per_page=1`,
        ]
      : []) {
      try {
        const { json } = await mg(ep);
        const obj = Array.isArray(json) ? json[0] : json;
        out.tries.push({ ep, ok: true, type: Array.isArray(json) ? 'array' : 'object', keys: obj ? Object.keys(obj) : [], dl: extractDownloads(obj) });
      } catch (e) {
        out.tries.push({ ep, ok: false, error: e.message });
      }
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

/**
 * Map of show slug -> real Megaphone download count, from the S3 IAB export.
 * Maps export podcast_id -> feed via the CMS podcast list, then to our shows.
 */
export async function downloadsBySlug(store, { log = () => {} } = {}) {
  const map = new Map();
  if (!s3Configured() || !megaphoneConfigured()) return map;
  const byPid = await downloadsByPodcastId({ log });
  if (!byPid || !byPid.size) return map;

  const pods = await listPodcasts(); // id -> { uid, feedUrl, title }
  const podById = new Map(pods.map((p) => [String(p.id), p]));
  const shows = await store.listShows();
  for (const [pid, downloads] of byPid) {
    const pod = podById.get(pid);
    if (!pod) continue;
    const show =
      shows.find((s) => pod.uid && s.feed_url && s.feed_url.includes(pod.uid)) ||
      shows.find((s) => pod.feedUrl && s.feed_url && norm(s.feed_url) === norm(pod.feedUrl)) ||
      shows.find((s) => norm(s.title) === norm(pod.title));
    if (show) map.set(show.slug, (map.get(show.slug) || 0) + downloads);
  }
  return map;
}

/** Rank shows by real Megaphone downloads (S3 export) and feature the top N. */
export async function applyPopularSpotlight(store, { count = spotlightCount(), log = () => {} } = {}) {
  if (!s3Configured()) return { applied: false, reason: 'S3 download export not configured' };
  if (!megaphoneConfigured()) return { applied: false, reason: 'Megaphone API token not configured (needed to map shows)' };

  const dl = await downloadsBySlug(store, { log });
  if (!dl.size) return { applied: false, reason: 'no downloads matched to shows' };

  const shows = await store.listShows();
  const bySlug = new Map(shows.map((s) => [s.slug, s]));
  const ranked = [...dl.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, count).map(([slug, downloads]) => ({ title: bySlug.get(slug)?.title || slug, slug, downloads }));
  const topSlugs = new Set(top.map((t) => t.slug));

  for (const s of shows) {
    const want = topSlugs.has(s.slug);
    if (!!s.featured !== want) await store.updateShow(s.id, { featured: want });
  }
  log(`spotlight by downloads → ${top.map((t) => `${t.title} (${t.downloads})`).join(', ')}`);
  return { applied: true, top };
}
