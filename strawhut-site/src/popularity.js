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

/** Rank by Megaphone downloads and set `featured` on the top N shows. */
export async function applyPopularSpotlight(store, { count = spotlightCount(), log = () => {} } = {}) {
  if (!megaphoneConfigured()) return { applied: false, reason: 'not configured' };
  const ranked = await computeRankings({ log });
  if (!ranked.length) return { applied: false, reason: 'no download numbers returned by API' };

  const shows = await store.listShows();
  const matchShow = (r) =>
    shows.find((s) => r.uid && s.feed_url && s.feed_url.includes(r.uid)) ||
    shows.find((s) => norm(s.title) === norm(r.title));

  const topShowIds = new Set();
  const topList = [];
  for (const r of ranked) {
    const show = matchShow(r);
    if (show && !topShowIds.has(show.id)) {
      topShowIds.add(show.id);
      topList.push({ title: show.title, downloads: r.downloads });
      if (topShowIds.size >= count) break;
    }
  }
  if (!topShowIds.size) return { applied: false, reason: 'could not match any ranked podcast to a show' };

  for (const s of shows) {
    const shouldFeature = topShowIds.has(s.id);
    if (!!s.featured !== shouldFeature) await store.updateShow(s.id, { featured: shouldFeature });
  }
  log(`megaphone: spotlight → ${topList.map((t) => `${t.title} (${t.downloads})`).join(', ')}`);
  return { applied: true, top: topList };
}
