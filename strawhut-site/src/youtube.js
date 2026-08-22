// YouTube video matching.
//
// Podcasts on the Straw Hut network also post full episodes to YouTube. This
// module (1) finds a show's YouTube channel, (2) enumerates its uploads, and
// (3) matches each podcast episode to its exact video by title. Full episodes
// are uploaded to YouTube with the SAME title as the podcast episode, so a
// normalized title match is highly accurate (~1.0); short promo clips have
// different titles and are correctly ignored.
//
// Ongoing: the channel's RSS feed (latest 15) is polled to attach videos to
// new episodes as they're posted. No API key required.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const MATCH_THRESHOLD = 0.62;

function dec(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
const norm = (s) => dec(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => new Set(norm(s).split(' ').filter(Boolean));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

async function getText(url, opts = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' }, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Extract a balanced JSON object beginning at the first '{' after `marker`.
function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return html.slice(start, j + 1); }
  }
  return null;
}

function walkVideos(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkVideos(n, out); return; }
  if (node.videoRenderer?.videoId) {
    const t = node.videoRenderer.title?.runs?.[0]?.text || node.videoRenderer.title?.simpleText;
    if (t) out.push({ id: node.videoRenderer.videoId, title: t });
  }
  if (node.lockupViewModel?.contentId) {
    const t = node.lockupViewModel.metadata?.lockupMetadataViewModel?.title?.content;
    if (t) out.push({ id: node.lockupViewModel.contentId, title: t });
  }
  for (const k of Object.keys(node)) walkVideos(node[k], out);
}
function findToken(node) {
  let token = null;
  (function walk(n) {
    if (!n || typeof n !== 'object' || token) return;
    const t = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (t) { token = t; return; }
    if (Array.isArray(n)) n.forEach(walk);
    else for (const k of Object.keys(n)) walk(n[k]);
  })(node);
  return token;
}

/**
 * Find the show's real channel by searching YouTube, then VERIFYING each
 * candidate: the correct channel's recent uploads will title-match some of the
 * show's episodes. Returns null if nothing verifies (avoids wrong channels).
 */
export async function findBestChannel(showTitle, episodes) {
  const html = await getText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(showTitle)}`
  );
  const ids = [...new Set([...html.matchAll(/"channelId":"(UC[A-Za-z0-9_-]{22})"/g)].map((m) => m[1]))].slice(0, 4);
  const epList = episodes.map((e) => ({ id: e.id, title: e.title }));
  let best = null, bestStrong = 0;
  for (const id of ids) {
    try {
      const recent = await fetchChannelRecent(id);
      const map = matchEpisodesToVideos(epList, recent);
      let strong = 0;
      for (const v of map.values()) if (v.score >= 0.8) strong++;
      if (strong > bestStrong) { bestStrong = strong; best = id; }
    } catch {}
  }
  return bestStrong >= 1 ? best : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Attach YouTube videos to a show's episodes.
 * mode 'full'   → discover channel if needed + enumerate whole back catalog.
 * mode 'recent' → poll channel RSS (latest ~15), match only unmatched episodes.
 * mode 'auto'   → full when the show has no channel yet, else recent.
 */
export async function matchShowVideos(store, show, { mode = 'auto', log = () => {} } = {}) {
  const episodes = await store.listEpisodes(show.id, { limit: 5000 });
  if (!episodes.length) return { channelId: show.youtube_channel_id || null, matched: 0 };

  let channelId = show.youtube_channel_id;
  const effective = mode === 'auto' ? (channelId ? 'recent' : 'full') : mode;

  if (!channelId) {
    channelId = await findBestChannel(show.title, episodes);
    if (!channelId) { log(`  no YouTube channel found for "${show.title}"`); return { channelId: null, matched: 0 }; }
    await store.updateShow(show.id, { youtube_channel_id: channelId });
  }

  const targets =
    effective === 'recent' ? episodes.filter((e) => !e.youtube_id) : episodes;
  if (!targets.length) return { channelId, matched: 0 };

  const videos =
    effective === 'recent' ? await fetchChannelRecent(channelId) : await fetchChannelUploads(channelId);
  const map = matchEpisodesToVideos(targets.map((e) => ({ id: e.id, title: e.title })), videos);
  let matched = 0;
  for (const [epId, { youtube_id }] of map) {
    await store.setEpisodeYouTube(epId, youtube_id);
    matched++;
  }
  log(`  ${show.title}: linked ${matched} episodes to YouTube (${effective})`);
  return { channelId, matched };
}

/** Match every show. Runs sequentially with a small delay to be gentle. */
export async function matchAllShows(store, { mode = 'auto', log = () => {} } = {}) {
  const shows = await store.listShows();
  let total = 0;
  for (const show of shows) {
    try {
      const r = await matchShowVideos(store, show, { mode, log });
      total += r.matched;
    } catch (e) {
      log(`  ${show.title}: YouTube match failed — ${e.message}`);
    }
    await sleep(1200);
  }
  return total;
}

/** Enumerate ALL uploads for a channel (back catalog). */
export async function fetchChannelUploads(channelId, { maxPages = 40 } = {}) {
  const page = await getText(`https://www.youtube.com/channel/${channelId}/videos`);
  const apiKey = (page.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const clientVersion =
    (page.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) ||
      page.match(/"clientVersion":"([^"]+)"/) || [])[1] || '2.20240101';
  const initialRaw = extractJson(page, 'ytInitialData');
  if (!initialRaw) return [];
  const out = [];
  let data = JSON.parse(initialRaw);
  walkVideos(data, out);
  let token = findToken(data);
  let pages = 1;
  while (token && apiKey && pages < maxPages) {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion } }, continuation: token }),
    });
    if (!res.ok) break;
    data = await res.json();
    const before = out.length;
    walkVideos(data, out);
    token = findToken(data);
    pages++;
    if (out.length === before) break;
  }
  const seen = new Set();
  return out.filter((v) => !seen.has(v.id) && seen.add(v.id));
}

/** Latest ~15 uploads via the channel RSS feed (fast; for ongoing sync). */
export async function fetchChannelRecent(channelId) {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
    const title = (e.match(/<title>([^<]*)</) || [])[1];
    if (id && title) out.push({ id, title });
  }
  return out;
}

/**
 * Match episodes to videos by normalized title.
 * @param episodes [{id, title}]
 * @param videos   [{id, title}]
 * @returns Map episodeId -> { youtube_id, score }
 */
export function matchEpisodesToVideos(episodes, videos) {
  const vt = videos.map((v) => ({ ...v, tk: toks(v.title) }));
  const result = new Map();
  for (const ep of episodes) {
    const et = toks(ep.title);
    let best = null, bs = 0;
    for (const v of vt) {
      const j = jaccard(et, v.tk);
      if (j > bs) { bs = j; best = v; }
    }
    if (best && bs >= MATCH_THRESHOLD) result.set(ep.id, { youtube_id: best.id, score: bs });
  }
  return result;
}
