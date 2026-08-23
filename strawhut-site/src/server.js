// Straw Hut Media — public podcast site + admin.
// Feed-agnostic: add any podcast by RSS URL; episode pages generate
// automatically and stay in sync via a background scheduler.

import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from './store.js';
import { addShowFromFeed, syncShow, syncAll, startScheduler } from './sync.js';
import * as V from './views.js';
import * as A from './admin_views.js';
import { robotsTxt, sitemapXml, llmsTxt } from './seo.js';
import { sendAnnouncement, mailConfigured, sendContactEmail, sendTrafficDigest } from './mail.js';
import { importFromSite } from './importer.js';
import { writeLandingCopy, generateLandingCopy, fallbackLandingCopy, aiConfigured, generateShowMetaDescription, generateShowBlurb, generateEpisodeEnrichment } from './ai.js';
import { POSTS, getPost } from './content/resources.js';
import { SERVICE_PAGES, getServicePage } from './content/services.js';
import * as reco from './recommend.js';
import { matchAllShows, matchShowVideos } from './youtube.js';
import { refreshPress } from './press.js';
import { applyMonthlyRotation } from './spotlight.js';
import { applyPopularSpotlight, megaphoneConfigured } from './popularity.js';
import { resolveArtwork, imageWidth, MIN_ACCEPTABLE } from './artwork.js';
import { inspect as inspectSubmission } from './antispam.js';
import { verifyTurnstile, turnstileConfigured } from './turnstile.js';
import { toText as plainText, endsSentence } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD + ':strawhut';

const store = await createStore();

const app = express();
// Railway terminates TLS and proxies to us, so the socket address is always the
// edge. Trust exactly one hop so req.ip is the real visitor (and can't be
// spoofed by an extra X-Forwarded-For entry) — the form rate limit buckets on it.
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Static caching: images/fonts never change → cache hard (30d, immutable);
// CSS can change on deploy → 1h (repeat views cached, then a cheap revalidate).
const IMMUTABLE = /\.(jpe?g|png|webp|gif|svg|ico|woff2?|mp3|m4a)$/i;
const staticOpts = {
  maxAge: '1h',
  setHeaders(res, p) {
    if (IMMUTABLE.test(p)) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  },
};
app.use('/styles.css', express.static(path.join(__dirname, '..', 'public', 'styles.css'), { maxAge: '1h' }));
// Hidden onboarding app (standalone static; not linked from the site).
app.use('/onboarding', express.static(path.join(__dirname, '..', 'public', 'onboarding'), staticOpts));
// Services / packages quote builder (standalone static, from Sales-Quoting).
app.use('/services', express.static(path.join(__dirname, '..', 'public', 'services'), staticOpts));
app.use('/public', express.static(path.join(__dirname, '..', 'public'), staticOpts));

// ---- Domain-migration safety net ----------------------------------------
// When strawhutmedia.com moves onto this app, we must not lose the old site's
// Google ranking. Two pieces:
//   1. Canonical host: force one host (www vs apex) per APP_BASE_URL so search
//      engines see a single URL for every page.
//   2. Legacy redirects: the old IIS site appended a numeric CMS id to every
//      show/episode slug (e.g. /naked-lunch-843, /show-12/episode-34). Strip
//      the id and 301 to the clean slug so every old link keeps its equity.
const CANONICAL_HOST = (() => {
  try { return new URL(process.env.APP_BASE_URL || 'https://www.strawhutmedia.com').host; }
  catch { return 'www.strawhutmedia.com'; }
})();
// Retired subdomains. Their content now lives as a PATH on the main site, which
// consolidates ranking authority instead of splitting it across subdomains.
// 301 (not deletion) so existing links and indexed pages pass their equity on.
const LEGACY_SUBDOMAINS = {
  start: '/podcast-production',   // old GoHighLevel "Start Your Podcast" funnel
  services: '/pricing',           // old IIS quote tool — now native on /pricing
};

// Renamed shows + old section pages that don't map by a simple id-strip.
const LEGACY_EXPLICIT = {
  '/untitled-689': '/only-murders-in-the-building',
  '/ourpodcasthosts': '/shows',
  '/trendingepisode': '/shows',
};

// 1. Canonical host — only touches strawhutmedia.com hosts (never the Railway
//    preview domain or localhost), so it's inert until the domain is live.
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host === CANONICAL_HOST) return next();
  // A retired subdomain lands on its replacement page, not the bare homepage.
  const dest = LEGACY_SUBDOMAINS[host.split('.')[0]];
  if (dest && host.endsWith('.strawhutmedia.com')) {
    return res.redirect(301, `https://${CANONICAL_HOST}${dest}`);
  }
  // Only the apex is folded into the canonical host. Any OTHER subdomain passes
  // through untouched — never assume a strawhutmedia.com subdomain that reaches
  // this service belongs to it (e.g. slate.* is a separate app).
  if (host === 'strawhutmedia.com') {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  next();
});

// 2. Legacy slug redirects.
app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const p = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
  const low = p.toLowerCase();
  if (LEGACY_EXPLICIT[low]) return res.redirect(301, LEGACY_EXPLICIT[low]);
  const parts = p.slice(1).split('/');
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return next();
  const m0 = parts[0].match(/^(.+?)-\d+$/);
  if (!m0) return next();
  try {
    // If the full first segment is already a real show, it's a valid new URL.
    if (await store.getShowBySlug(parts[0])) return next();
    const show = await store.getShowBySlug(m0[1]);
    if (!show) return res.redirect(301, '/shows'); // unknown old id → catalog, never a 404
    if (parts[1]) {
      const em = parts[1].match(/^(.+?)-\d+$/);
      const ep = await store.getEpisodeBySlug(show.id, em ? em[1] : parts[1]);
      return res.redirect(301, ep ? `/${show.slug}/${ep.slug}` : `/${show.slug}`);
    }
    return res.redirect(301, `/${show.slug}`);
  } catch {
    return next();
  }
});

// ---- First-party traffic counting -----------------------------------------
// Counts real page requests per path, per day, straight into our own Postgres.
// Aggregate only — no IP, no user agent stored, no cookie — so it needs no
// consent banner and can't be blocked by tracker blockers. Bots are filtered
// best-effort so the numbers reflect people.
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|node-fetch|axios|monitor/i;
app.use((req, res, next) => {
  next(); // never delay the response
  try {
    if (req.method !== 'GET') return;
    const p = req.path;
    if (p.includes('.') || p.startsWith('/admin') || p.startsWith('/public') ||
        p.startsWith('/api') || p === '/healthz' || p === '/robots.txt' ||
        p === '/sitemap.xml' || p === '/llms.txt') return;
    if (BOT_RE.test(req.headers['user-agent'] || '')) return;
    res.on('finish', () => {
      if (res.statusCode !== 200) return; // only count pages actually served
      store.recordView(p.length > 200 ? p.slice(0, 200) : p).catch(() => {});
    });
  } catch {}
});

// Spotlight = most-downloaded shows (Megaphone). Falls back to the curated
// monthly rotation only when Megaphone isn't configured or returns no numbers.
// Sitewide footer "Recent episodes" rail — refreshed on boot and after each
// feed sync so every page's footer stays current.
async function refreshFooter() {
  try {
    V.setFooterData({ recentEpisodes: await store.recentEpisodes(12) });
  } catch (e) {
    console.error('[footer] refresh failed:', e.message);
  }
}

let spotlightStatus = { source: 'pending', megaphoneConfigured: megaphoneConfigured() };
async function refreshSpotlight() {
  try {
    if (megaphoneConfigured()) {
      const r = await applyPopularSpotlight(store, { log: (m) => console.log('[spotlight]', m) });
      if (r.applied) {
        spotlightStatus = { source: 'downloads', megaphoneConfigured: true, shows: r.top };
        console.log('[spotlight] by downloads:', r.top.map((t) => t.title).join(', '));
        return;
      }
      spotlightStatus = { source: 'rotation-fallback', megaphoneConfigured: true, reason: r.reason };
      console.log('[spotlight] Megaphone returned no usable numbers — falling back to rotation:', r.reason);
    } else {
      spotlightStatus = { source: 'rotation', megaphoneConfigured: false };
    }
    const rot = await applyMonthlyRotation(store, { log: (m) => console.log('[spotlight]', m) });
    if (rot.picks) spotlightStatus.picks = rot.picks;
  } catch (e) {
    spotlightStatus = { source: 'error', megaphoneConfigured: megaphoneConfigured(), error: e.message };
    console.error('[spotlight] failed:', e.message);
  }
}

// Weekly traffic digest. Checked hourly; sends at most once every 7 days, with
// the last-sent timestamp persisted so restarts and redeploys don't re-send or
// reset the clock. Set TRAFFIC_DIGEST=off to disable.
async function maybeSendTrafficDigest(force = false) {
  if (process.env.TRAFFIC_DIGEST === 'off' || !mailConfigured()) return { sent: false };
  try {
    const last = await store.getState('traffic_digest_at');
    const due = force || !last || Date.now() - new Date(last).getTime() >= 7 * 864e5;
    if (!due) return { sent: false };
    const stats = await store.viewStats(7);
    const to = process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com';
    const siteUrl = (process.env.APP_BASE_URL || 'https://www.strawhutmedia.com').replace(/\/+$/, '');
    await sendTrafficDigest(to, { stats, days: 7, siteUrl });
    await store.setState('traffic_digest_at', new Date().toISOString());
    console.log(`[digest] weekly traffic email sent to ${to} (${stats.total} views)`);
    return { sent: true, total: stats.total };
  } catch (e) {
    console.error('[digest] failed:', e.message);
    return { sent: false, error: e.message };
  }
}

// Upgrade low-resolution cover art. Several feeds publish show artwork well
// below Apple's 1400px minimum (some at 256px), which looks soft wherever we
// render art large. The full-size originals live on Apple, matched EXACTLY by
// the collection id in each show's Apple URL — never by name — so there is no
// risk of putting the wrong artwork on a client's page. The result is stored,
// so each show is resolved once, and calls are paced inside Apple's rate
// limit. Set ARTWORK_HIRES=off to skip.
async function backfillArtwork() {
  if (process.env.ARTWORK_HIRES === 'off') return;
  try {
    const shows = await store.listShows();
    let checked = 0, upgraded = 0;
    for (const show of shows) {
      if (show.artwork_url || !show.apple_url) continue;
      checked++;
      const w = await imageWidth(show.image_url);
      if (w >= MIN_ACCEPTABLE) continue;
      const hi = await resolveArtwork(show);
      if (hi) {
        await store.updateShow(show.id, { artwork_url: hi, image_url: hi });
        upgraded++;
        console.log(`[artwork] ${show.slug}: ${w || '?'}px -> 3000px`);
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (checked) console.log(`[artwork] checked ${checked}, upgraded ${upgraded}`);
  } catch (e) {
    console.error('[artwork] backfill failed:', e.message);
  }
}

// Attach episode_count to shows for list views.
async function withCounts(shows) {
  return Promise.all(
    shows.map(async (s) => ({ ...s, episode_count: await store.countEpisodes(s.id) }))
  );
}

// ---- Admin auth (signed cookie) ------------------------------------------
function sign(val) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(val).digest('hex');
  return `${val}.${h}`;
}
function verify(signed) {
  if (!signed) return false;
  const i = signed.lastIndexOf('.');
  if (i < 0) return false;
  const val = signed.slice(0, i);
  return sign(val) === signed && val === 'ok';
}
function requireAdmin(req, res, next) {
  if (verify(req.cookies?.shm_admin)) return next();
  return res.redirect('/admin/login');
}

// ---- Admin routes ---------------------------------------------------------
app.get('/admin/login', (req, res) => res.send(A.loginPage()));
app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('shm_admin', sign('ok'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    return res.redirect('/admin');
  }
  res.send(A.loginPage({ error: 'Incorrect password.' }));
});
app.get('/admin/logout', (req, res) => {
  res.clearCookie('shm_admin');
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const stats = await store.stats();
  const shows = await withCounts(await store.listShows());
  res.send(A.dashboardPage({ stats, shows, flash: readFlash(req, res) }));
});

app.post('/admin/analytics/send-digest', requireAdmin, async (req, res) => {
  const r = await maybeSendTrafficDigest(true);
  setFlash(res, r.sent
    ? { type: 'ok', msg: `Traffic digest sent (${r.total} page views).` }
    : { type: 'err', msg: `Not sent: ${r.error || 'email not configured'}` });
  res.redirect('/admin/analytics');
});

app.get('/admin/analytics', requireAdmin, async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days || '7', 10)));
  const stats = await store.viewStats(days);
  res.send(A.analyticsPage({ stats, days }));
});

app.get('/admin/shows', requireAdmin, async (req, res) => {
  const shows = await withCounts(await store.listShows());
  res.send(A.showsAdminPage({ shows, flash: readFlash(req, res) }));
});

app.get('/admin/shows/new', requireAdmin, (req, res) =>
  res.send(A.newShowPage({ flash: readFlash(req, res) }))
);

app.post('/admin/shows', requireAdmin, async (req, res) => {
  const feed_url = (req.body.feed_url || '').trim();
  if (!feed_url) return res.send(A.newShowPage({ flash: { type: 'err', msg: 'Feed URL is required.' } }));
  try {
    const { show, created, added } = await addShowFromFeed(store, feed_url, {
      featured: !!req.body.featured,
      show_type: req.body.show_type === 'partnered' ? 'partnered' : 'original',
      spotify_url: (req.body.spotify_url || '').trim() || null,
      apple_url: (req.body.apple_url || '').trim() || null,
    });
    setFlash(res, {
      type: 'ok',
      msg: created
        ? `Added “${show.title}” — pulled ${added} episodes. Pages are live.`
        : `“${show.title}” already existed — re-synced (${added} new episodes).`,
    });
    res.redirect('/admin/shows');
  } catch (e) {
    res.send(
      A.newShowPage({
        flash: { type: 'err', msg: `Could not add feed: ${e.message}` },
        values: req.body,
      })
    );
  }
});

app.post('/admin/shows/:id/sync', requireAdmin, async (req, res) => {
  const show = await store.getShowById(req.params.id);
  if (show) {
    try {
      const { added } = await syncShow(store, show);
      setFlash(res, { type: 'ok', msg: `Synced “${show.title}” — ${added} new episodes.` });
    } catch (e) {
      setFlash(res, { type: 'err', msg: `Sync failed: ${e.message}` });
    }
  }
  res.redirect('/admin/shows');
});

app.post('/admin/shows/:id/feature', requireAdmin, async (req, res) => {
  const show = await store.getShowById(req.params.id);
  if (show) await store.updateShow(show.id, { featured: !show.featured });
  res.redirect('/admin/shows');
});

app.post('/admin/shows/:id/type', requireAdmin, async (req, res) => {
  const show = await store.getShowById(req.params.id);
  if (show)
    await store.updateShow(show.id, {
      show_type: show.show_type === 'partnered' ? 'original' : 'partnered',
    });
  res.redirect('/admin/shows');
});

app.post('/admin/shows/:id/delete', requireAdmin, async (req, res) => {
  await store.deleteShow(req.params.id);
  setFlash(res, { type: 'ok', msg: 'Show deleted.' });
  res.redirect('/admin/shows');
});

app.post('/admin/youtube-match', requireAdmin, async (req, res) => {
  setFlash(res, {
    type: 'ok',
    msg: 'Matching YouTube videos to episodes in the background — this can take a while for the full catalog. Refresh later.',
  });
  res.redirect('/admin/shows');
  matchAllShows(store, { mode: 'auto', log: (m) => console.log('[youtube]', m) })
    .then((n) => console.log(`[youtube] done — linked ${n} episodes to video`))
    .catch((e) => console.error('[youtube] failed:', e.message));
});

app.post('/admin/shows/:id/youtube', requireAdmin, async (req, res) => {
  const show = await store.getShowById(req.params.id);
  if (show) {
    try {
      const { channelId, matched } = await matchShowVideos(store, show, {
        mode: 'full',
        log: (m) => console.log('[youtube]', m),
      });
      setFlash(res, {
        type: channelId ? 'ok' : 'err',
        msg: channelId
          ? `Linked ${matched} episodes of “${show.title}” to their YouTube videos.`
          : `Couldn't find a matching YouTube channel for “${show.title}”.`,
      });
    } catch (e) {
      setFlash(res, { type: 'err', msg: `YouTube match failed: ${e.message}` });
    }
  }
  res.redirect('/admin/shows');
});

app.post('/admin/sync-all', requireAdmin, async (req, res) => {
  const results = await syncAll(store);
  const added = results.reduce((n, r) => n + (r.added || 0), 0);
  setFlash(res, { type: 'ok', msg: `Synced all feeds — ${added} new episodes across ${results.length} shows.` });
  res.redirect('/admin/shows');
});

app.post('/admin/import', requireAdmin, async (req, res) => {
  setFlash(res, {
    type: 'ok',
    msg: 'Importing all shows from strawhutmedia.com in the background — refresh this page in a minute to watch them appear.',
  });
  res.redirect('/admin/shows');
  // Fire-and-forget: crawl + import continues after the response is sent.
  importFromSite(store, { onProgress: (m) => console.log('[import]', m) })
    .then((r) => {
      console.log('[import] complete', r);
      reco.refresh(store).catch(() => {});
    })
    .catch((e) => console.error('[import] failed:', e.message));
});

// ---- Admin: announcements ----
app.get('/admin/announcements', requireAdmin, async (req, res) => {
  const announcements = await store.listAnnouncements();
  const subs = await store.listSubscribers();
  res.send(
    A.announcementsPage({
      announcements,
      subscriberCount: subs.length,
      mailReady: mailConfigured(),
      flash: readFlash(req, res),
    })
  );
});
app.post('/admin/announcements', requireAdmin, async (req, res) => {
  const subject = (req.body.subject || '').trim();
  const body_html = (req.body.body_html || '').trim();
  if (subject && body_html) {
    await store.createAnnouncement({ subject, body_html });
    setFlash(res, { type: 'ok', msg: 'Draft saved. Click “Send” to email it to members.' });
  }
  res.redirect('/admin/announcements');
});
app.post('/admin/announcements/:id/send', requireAdmin, async (req, res) => {
  const a = await store.getAnnouncement(req.params.id);
  if (!a) return res.redirect('/admin/announcements');
  try {
    const subs = await store.listSubscribers();
    const { sent, failed, errors } = await sendAnnouncement(subs, { subject: a.subject, html: a.body_html });
    await store.markAnnouncementSent(a.id, sent);
    setFlash(res, {
      type: failed ? 'err' : 'ok',
      msg: `Sent to ${sent} members${failed ? `, ${failed} failed (${errors.join('; ')})` : ''}.`,
    });
  } catch (e) {
    setFlash(res, { type: 'err', msg: e.message });
  }
  res.redirect('/admin/announcements');
});
app.post('/admin/announcements/:id/delete', requireAdmin, async (req, res) => {
  await store.deleteAnnouncement(req.params.id);
  setFlash(res, { type: 'ok', msg: 'Announcement deleted.' });
  res.redirect('/admin/announcements');
});

// ---- Admin: press ----
app.get('/admin/press', requireAdmin, async (req, res) => {
  const items = await store.listPressItems({ limit: 300 });
  res.send(A.pressAdminPage({ items, flash: readFlash(req, res) }));
});
app.post('/admin/press/refresh', requireAdmin, async (req, res) => {
  try {
    const added = await refreshPress(store, { log: (m) => console.log('[press]', m) });
    setFlash(res, { type: 'ok', msg: `Refreshed — ${added} new mention(s) added.` });
  } catch (e) {
    setFlash(res, { type: 'err', msg: `Press refresh failed: ${e.message}` });
  }
  res.redirect('/admin/press');
});
app.post('/admin/press', requireAdmin, async (req, res) => {
  const title = (req.body.title || '').trim();
  const url = (req.body.url || '').trim();
  if (title && url) {
    await store.upsertPressItem({ title, url, source: (req.body.source || '').trim(), snippet: '', query: 'manual', published_at: new Date().toISOString() });
    if (store.save) await store.save();
    setFlash(res, { type: 'ok', msg: 'Press item added.' });
  }
  res.redirect('/admin/press');
});
app.post('/admin/press/:id/delete', requireAdmin, async (req, res) => {
  await store.deletePressItem(req.params.id);
  setFlash(res, { type: 'ok', msg: 'Press item removed.' });
  res.redirect('/admin/press');
});

// ---- Admin: episode editor ----
function parseYouTubeId(input) {
  const s = (input || '').trim();
  if (!s) return null;
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return s || null;
}

app.get('/admin/shows/:id/episodes', requireAdmin, async (req, res) => {
  const show = await store.getShowById(req.params.id);
  if (!show) return res.redirect('/admin/shows');
  const perPage = 50;
  const pageNum = Math.max(1, parseInt(req.query.page || '1', 10));
  const total = await store.countEpisodes(show.id);
  const episodes = await store.listEpisodes(show.id, { limit: perPage, offset: (pageNum - 1) * perPage });
  res.send(A.episodesAdminPage({ show, episodes, total, pageNum, perPage, flash: readFlash(req, res) }));
});

app.get('/admin/episodes/:id/edit', requireAdmin, async (req, res) => {
  const episode = await store.getEpisodeById(req.params.id);
  if (!episode) return res.redirect('/admin/shows');
  const show = await store.getShowById(episode.show_id);
  res.send(A.episodeEditPage({ show, episode, flash: readFlash(req, res) }));
});

app.post('/admin/episodes/:id', requireAdmin, async (req, res) => {
  const episode = await store.getEpisodeById(req.params.id);
  if (!episode) return res.redirect('/admin/shows');
  await store.updateEpisode(episode.id, {
    title: (req.body.title || '').trim() || episode.title,
    description: req.body.description ?? episode.description,
    image_url: (req.body.image_url || '').trim() || null,
    youtube_id: parseYouTubeId(req.body.youtube_id),
  });
  setFlash(res, { type: 'ok', msg: 'Episode saved.' });
  res.redirect(`/admin/shows/${episode.show_id}/episodes`);
});

// ---- Admin: landing pages ----
import { slugify, uniqueSlug } from './util.js';

// Resolve a pasted episode URL/path to { show_id, episode_id }.
async function resolveEpisodeRef(input) {
  if (!input) return {};
  let path = input.trim();
  try { path = new URL(path).pathname; } catch {}
  const parts = path.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2) return {};
  const show = await store.getShowBySlug(parts[0]);
  if (!show) return {};
  const ep = await store.getEpisodeBySlug(show.id, parts[1]);
  return { show_id: show.id, episode_id: ep ? ep.id : null };
}

async function landingFromBody(body) {
  const { show_id, episode_id } = await resolveEpisodeRef(body.episode_url);
  const taken = new Set((await store.listLandings()).map((l) => l.slug));
  const slug = uniqueSlug(slugify(body.slug || body.title || 'landing', 'landing'), taken);
  let headline = (body.headline || '').trim();
  let subhead = (body.subhead || '').trim();
  let body_html = body.body_html || '';
  // Auto-write copy from the episode's materials when the admin left it blank.
  if (episode_id && show_id && !(headline && subhead && body_html)) {
    try {
      const show = await store.getShowById(show_id);
      const episode = (await store.listEpisodes(show_id, { limit: 5000 })).find((e) => e.id === episode_id);
      if (episode) {
        const copy = await writeLandingCopy({ show, episode, log: (m) => console.log('[ai]', m) });
        headline = headline || copy.headline;
        subhead = subhead || copy.subhead;
        body_html = body_html || copy.body_html;
      }
    } catch (e) {
      console.error('[ai] landing copy failed:', e.message);
    }
  }
  return {
    slug,
    title: (body.title || '').trim(),
    headline,
    subhead,
    body_html,
    hero_image_url: (body.hero_image_url || '').trim(),
    cta_label: (body.cta_label || '').trim(),
    cta_url: (body.cta_url || '').trim(),
    gtag_id: (body.gtag_id || '').trim(),
    indexable: !!body.indexable,
    show_id,
    episode_id,
  };
}

app.get('/admin/landing', requireAdmin, async (req, res) => {
  const landings = await store.listLandings();
  // Campaign pages are auto-created per episode and served from
  // /go/<show>/<episode> — that's the URL an ad points at, so show that rather
  // than the /lp/<slug> the record happens to carry. Only a handful of landings
  // have an episode, so these lookups stay cheap.
  const shows = new Map();
  for (const l of landings) {
    if (!l.show_id || !l.episode_id) continue;
    try {
      if (!shows.has(l.show_id)) shows.set(l.show_id, await store.getShowById(l.show_id));
      const show = shows.get(l.show_id);
      const ep = await store.getEpisodeById(l.episode_id);
      if (show && ep) {
        l.go_url = `/go/${show.slug}/${ep.slug}`;
        l.show_title = show.title;
        l.episode_title = ep.title;
      }
    } catch { /* a deleted show or episode just leaves it as a plain landing */ }
  }
  res.send(A.landingsAdminPage({ landings, flash: readFlash(req, res) }));
});
app.get('/admin/landing/new', requireAdmin, (req, res) =>
  res.send(A.landingFormPage({ flash: readFlash(req, res) }))
);
app.post('/admin/landing', requireAdmin, async (req, res) => {
  if (!req.body.title) return res.send(A.landingFormPage({ flash: { type: 'err', msg: 'Name is required.' }, values: req.body }));
  const lp = await landingFromBody(req.body);
  const created = await store.createLanding(lp);
  setFlash(res, { type: 'ok', msg: `Landing page created at /lp/${created.slug}` });
  res.redirect('/admin/landing');
});
app.get('/admin/landing/:id/edit', requireAdmin, async (req, res) => {
  const l = await store.getLandingById(req.params.id);
  if (!l) return res.redirect('/admin/landing');
  // Reconstruct the episode_url field for editing convenience.
  let episode_url = '';
  if (l.show_id) {
    const show = await store.getShowById(l.show_id);
    if (show && l.episode_id) {
      const eps = await store.listEpisodes(show.id, { limit: 5000 });
      const ep = eps.find((e) => e.id === l.episode_id);
      if (ep) episode_url = `/${show.slug}/${ep.slug}`;
    }
  }
  res.send(A.landingFormPage({ values: { ...l, episode_url }, isEdit: true, actionId: l.id, flash: readFlash(req, res) }));
});
app.post('/admin/landing/:id', requireAdmin, async (req, res) => {
  const existing = await store.getLandingById(req.params.id);
  if (!existing) return res.redirect('/admin/landing');
  const { show_id, episode_id } = await resolveEpisodeRef(req.body.episode_url);
  await store.updateLanding(existing.id, {
    title: (req.body.title || '').trim(),
    slug: slugify(req.body.slug || req.body.title || existing.slug, 'landing'),
    headline: (req.body.headline || '').trim(),
    subhead: (req.body.subhead || '').trim(),
    body_html: req.body.body_html || '',
    hero_image_url: (req.body.hero_image_url || '').trim(),
    cta_label: (req.body.cta_label || '').trim(),
    cta_url: (req.body.cta_url || '').trim(),
    gtag_id: (req.body.gtag_id || '').trim(),
    indexable: !!req.body.indexable,
    show_id,
    episode_id,
  });
  setFlash(res, { type: 'ok', msg: 'Landing page saved.' });
  res.redirect('/admin/landing');
});
app.post('/admin/landing/:id/delete', requireAdmin, async (req, res) => {
  await store.deleteLanding(req.params.id);
  setFlash(res, { type: 'ok', msg: 'Landing page deleted.' });
  res.redirect('/admin/landing');
});

// ---- Admin: members ----
app.get('/admin/members', requireAdmin, async (req, res) => {
  const subscribers = await store.listSubscribers();
  res.send(A.membersPage({ subscribers, flash: readFlash(req, res) }));
});
app.post('/admin/members/:id/delete', requireAdmin, async (req, res) => {
  await store.removeSubscriber(req.params.id);
  setFlash(res, { type: 'ok', msg: 'Member removed.' });
  res.redirect('/admin/members');
});

// Tiny flash-message helper via short-lived cookie.
function setFlash(res, flash) {
  res.cookie('shm_flash', Buffer.from(JSON.stringify(flash)).toString('base64'), { maxAge: 10000 });
}
function readFlash(req, res) {
  const raw = req.cookies?.shm_flash;
  if (!raw) return null;
  res.clearCookie('shm_flash');
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ---- Health --------------------------------------------------------------
app.get('/healthz', async (req, res) => {
  const sp = spotlightStatus || {};
  const titles = (sp.shows || []).map((x) => x.title).concat(sp.picks || []);
  // Booleans only — never the keys themselves. Tells us at a glance whether the
  // AI-dependent features (meta descriptions, show blurbs, episode hooks) can
  // actually run on this service, which is otherwise invisible from outside.
  res.json({
    ok: true,
    ...(await store.stats()),
    features: { ai: aiConfigured(), showSeo: process.env.SHOW_SEO !== 'off', turnstile: turnstileConfigured() },
    enrichedEpisodes: await store.enrichedCount().catch((e) => `error: ${e.message.slice(0, 80)}`),
    lastEnrichError: _lastEnrichError,
    spotlight: { source: sp.source, shows: titles },
  });
});

// ---- SEO / GEO endpoints --------------------------------------------------
app.get('/robots.txt', (req, res) => res.type('text/plain').send(robotsTxt()));

app.get('/sitemap.xml', async (req, res) => {
  const shows = await store.listShows();
  const episodesByShow = {};
  for (const s of shows) episodesByShow[s.id] = await store.listEpisodes(s.id, { limit: 2000 });
  res.type('application/xml').send(
    sitemapXml(shows, episodesByShow, {
      posts: POSTS,
      servicePaths: SERVICE_PAGES.map((s) => s.path),
    })
  );
});

app.get('/llms.txt', async (req, res) => {
  const shows = await store.listShows();
  res.type('text/plain').send(
    llmsTxt(shows, {
      posts: POSTS,
      services: SERVICE_PAGES.map((s) => ({ title: s.navLabel, path: s.path, summary: s.summary })),
    })
  );
});

// ---- Public routes --------------------------------------------------------
app.get('/', async (req, res) => {
  const shows = await withCounts(await store.listShows());
  res.send(V.homePage({ shows }));
});

app.get('/shows', async (req, res) => {
  const shows = await withCounts(await store.listShows());
  res.send(V.showsIndexPage({ shows }));
});

app.get('/privacy', (req, res) => res.send(V.privacyPage()));
app.get('/studio', (req, res) => res.send(V.studioPage()));
// We have one studio — the old LA landing page is consolidated into /studio.
app.get('/podcast-studio-los-angeles', (req, res) => res.redirect(301, '/studio'));

app.get('/about', (req, res) => res.send(V.aboutPage()));

// 15-minute "are we a fit" discovery call, booked through GoHighLevel so leads
// land in the CRM. Set BOOKING_WIDGET_URL to the GHL calendar embed URL.
const BOOKING_WIDGET_URL = process.env.BOOKING_WIDGET_URL || '';
app.get('/book', (req, res) => res.send(V.bookPage({ widgetUrl: BOOKING_WIDGET_URL })));

// Packages + custom quote builder (embeds the self-hosted Sales-Quoting tool).
app.get('/pricing', (req, res) => res.send(V.pricingPage()));

app.get('/contact', (req, res) => res.send(V.contactPage()));
app.post('/contact', async (req, res) => {
  const { name = '', email = '', company = '', message = '', topic = 'general' } = req.body || {};
  const values = { name, email, company, message, topic };
  if (!name.trim() || !email.trim() || !message.trim()) {
    return res.send(V.contactPage({ error: 'Please fill in your name, email, and a message.', values }));
  }
  // Invisible bot checks. A rejected submission gets the normal thank-you page:
  // telling a bot why it failed just teaches it what to fix next time.
  const check = inspectSubmission(req.body, { ip: req.ip });
  if (!check.ok) {
    console.log('[contact] blocked', check.reason, '-', String(email).slice(0, 60));
    return res.send(V.contactPage({ sent: true }));
  }
  // Turnstile. Only an actively rejected token is treated as proof of a bot;
  // a missing or unverifiable one is flagged and still delivered.
  const cf = await verifyTurnstile(req.body['cf-turnstile-response'], req.ip);
  if (cf.status === 'failed') {
    console.log('[contact] blocked turnstile', cf.codes.join(','), '-', String(email).slice(0, 60));
    return res.send(V.contactPage({ sent: true }));
  }
  const flags = [...check.flags];
  if (cf.status === 'missing') flags.push('no-captcha');
  if (cf.status === 'unreachable') console.warn('[contact] turnstile unreachable:', cf.codes.join(','));
  const suspicious = check.suspicious || flags.length >= 2;
  try {
    if (mailConfigured()) {
      await sendContactEmail({ name, email, company, message, topic, flags: suspicious ? flags : [] });
    } else {
      console.log('[contact] (email not configured) message from', email, `[${topic}]`, '-', message.slice(0, 120));
    }
    res.send(V.contactPage({ sent: true }));
  } catch (e) {
    console.error('[contact] send failed:', e.message);
    res.send(V.contactPage({ error: 'Something went wrong sending your message. Please email us directly at hello@strawhutmedia.com.', values }));
  }
});

app.get('/press', async (req, res) => {
  const items = await store.listPressItems({ limit: 200 });
  res.send(V.pressPage({ items }));
});

// ---- Resources (guides / blog) --------------------------------------------
app.get('/resources', (req, res) => res.send(V.resourcesIndexPage({ posts: POSTS })));
app.get('/resources/:slug', (req, res, next) => {
  const post = getPost(req.params.slug);
  if (!post) return next();
  const related = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
  res.send(V.resourcePostPage({ post, related }));
});

// ---- Per-service landing pages --------------------------------------------
for (const svc of SERVICE_PAGES) {
  app.get(svc.path, async (req, res) => {
    const shows = await store.listShows().catch(() => []);
    res.send(V.servicePage(svc, { shows }));
  });
}

app.get('/lp/:slug', async (req, res, next) => {
  const landing = await store.getLandingBySlug(req.params.slug);
  if (!landing) return next();
  let show = null;
  let episode = null;
  if (landing.episode_id && landing.show_id) {
    show = await store.getShowById(landing.show_id);
    if (show) {
      const eps = await store.listEpisodes(show.id, { limit: 5000 });
      episode = eps.find((e) => e.id === landing.episode_id) || null;
    }
  }
  res.send(V.landingPage({ landing, show, episode }));
});

// ---- Campaign landing pages (Google Ads destinations) --------------------
// Every episode gets a campaign-ready landing page at /go/<show>/<episode>.
// Podbooster points a Straw Hut campaign's final URL here; the page renders the
// clean landing card with AI-written copy (generated once, cached, noindex,
// fully tracked). Reuses any hand-made landing tied to the same episode.
async function resolveOrCreateEpisodeLanding(show, episode) {
  const landings = await store.listLandings();
  const existing = landings.find((l) => l.episode_id === episode.id);
  if (existing) return existing;
  const fb = fallbackLandingCopy({ show, episode });
  const slug = uniqueSlug(slugify('go-' + (episode.slug || episode.title), 'go'), new Set(landings.map((l) => l.slug)));
  const landing = await store.createLanding({
    slug,
    title: 'Auto LP — ' + episode.title,
    headline: fb.headline,
    subhead: fb.subhead,
    body_html: fb.body_html,
    hero_image_url: episode.image_url || show.image_url || '',
    cta_label: '',
    cta_url: '',
    show_id: show.id,
    episode_id: episode.id,
    indexable: false,
    gtag_id: '',
  });
  // Upgrade to AI copy in the background so the first hit stays fast.
  if (aiConfigured()) {
    generateLandingCopy({ show, episode })
      .then((copy) => (copy && copy.headline ? store.updateLanding(landing.id, { ...landing, ...copy }) : null))
      .catch(() => {});
  }
  return landing;
}

const _norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Resolver for Podbooster: given a show title + episode title (and/or the audio
// URL), return the canonical /go URL (and warm its copy). Rarely called — once
// per campaign launch.
app.get('/go/resolve', async (req, res) => {
  try {
    const audio = (req.query.audio || '').toString().trim();
    const showT = _norm(req.query.show);
    const epT = _norm(req.query.episode);
    const shows = await store.listShows();
    let mShow = showT ? shows.find((s) => _norm(s.title) === showT) || shows.find((s) => _norm(s.title).includes(showT)) : null;
    let mEp = null;
    if (mShow) {
      const eps = await store.listEpisodes(mShow.id, { limit: 5000 });
      mEp =
        (audio && eps.find((e) => e.audio_url === audio)) ||
        eps.find((e) => _norm(e.title) === epT) ||
        (epT && eps.find((e) => _norm(e.title).includes(epT))) ||
        null;
    }
    if (!mShow || !mEp) return res.status(404).json({ ok: false, error: 'episode not found' });
    await resolveOrCreateEpisodeLanding(mShow, mEp);
    const base = (process.env.APP_BASE_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
    res.json({ ok: true, url: `${base}/go/${mShow.slug}/${mEp.slug}`, show: mShow.title, episode: mEp.title });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Legacy campaign URL. The episode page now IS the landing page, so there's one
// link and one layout; anything still pointing here is sent to the real page,
// preserving ad query parameters (gclid, utm_*) so attribution survives.
app.get('/go/:showSlug/:episodeSlug', async (req, res, next) => {
  const show = await store.getShowBySlug(req.params.showSlug);
  if (!show) return next();
  const episode = await store.getEpisodeBySlug(show.id, req.params.episodeSlug);
  if (!episode) return next();
  // Keep the record so Admin > Landing Pages still lists which episodes are
  // being advertised, and warm the enrichment for the incoming click.
  enrichEpisodeInBackground(show, episode);
  resolveOrCreateEpisodeLanding(show, episode).catch(() => {});
  const qs = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : '';
  res.redirect(301, `/${show.slug}/${episode.slug}${qs}`);
});

app.post('/subscribe', async (req, res) => {
  const email = (req.body.email || '').trim();
  const check = inspectSubmission(req.body, { ip: req.ip });
  const cf = await verifyTurnstile(req.body['cf-turnstile-response'], req.ip);
  if (!check.ok || cf.status === 'failed') {
    console.log('[subscribe] blocked', check.reason || 'turnstile:' + cf.codes.join(','), '-', email.slice(0, 60));
    return res.send(
      V.messagePage({
        title: "You're subscribed — Straw Hut Media",
        heading: "You're on the list! 🎉",
        message: 'Thanks for subscribing to Straw Hut Media updates.',
      })
    );
  }
  try {
    await store.addSubscriber(email, req.body.name);
    res.send(
      V.messagePage({
        title: "You're subscribed — Straw Hut Media",
        heading: "You're on the list! 🎉",
        message: 'Thanks for subscribing to Straw Hut Media updates.',
      })
    );
  } catch (e) {
    res.status(400).send(
      V.messagePage({ title: 'Subscribe', heading: 'Hmm, that didn’t work', message: e.message })
    );
  }
});

app.get('/unsubscribe', async (req, res) => {
  const email = (req.query.e || '').toString().trim().toLowerCase();
  const subs = await store.listSubscribers();
  const found = subs.find((s) => s.email === email);
  if (found) await store.removeSubscriber(found.id);
  res.send(
    V.messagePage({
      title: 'Unsubscribed — Straw Hut Media',
      heading: 'You’ve been unsubscribed',
      message: found ? `${email} will no longer receive updates.` : 'That address wasn’t on our list.',
    })
  );
});

// Show page: /:showSlug
app.get('/:showSlug', async (req, res, next) => {
  const show = await store.getShowBySlug(req.params.showSlug);
  if (!show) return next();
  const PER_PAGE = 60;
  const pageNum = Math.max(1, parseInt(req.query.page || '1', 10));
  const total = await store.countEpisodes(show.id);
  const episodes = await store.listEpisodes(show.id, {
    limit: PER_PAGE,
    offset: (pageNum - 1) * PER_PAGE,
  });
  res.send(V.showPage({ show, episodes, total, pageNum, perPage: PER_PAGE }));
});

// Episode page: /:showSlug/:episodeSlug
// Landing-page enrichment is generated the first time an episode page is
// viewed, then cached forever. Doing it on demand rather than backfilling all
// 5,370 episodes means the cost follows real traffic — most of the catalogue is
// never looked at, and the pages that are get enriched within one page view.
const _enriching = new Set();
let _lastEnrichError = null;
function enrichEpisodeInBackground(show, episode) {
  if (!aiConfigured() || process.env.SHOW_SEO === 'off') return;
  if (episode.ai_hook || _enriching.has(episode.id)) return;
  _enriching.add(episode.id);
  generateEpisodeEnrichment({ show, episode, log: (m) => console.log('[episode]', m) })
    .then((out) => {
      if (!out) return;
      return store.updateEpisode(episode.id, {
        ai_hook: out.hook || null,
        ai_takeaways: out.takeaways?.length ? JSON.stringify(out.takeaways) : null,
      });
    })
    .catch((e) => {
      _lastEnrichError = e.message.slice(0, 160);
      console.error('[episode] enrich failed:', e.message);
    })
    .finally(() => _enriching.delete(episode.id));
}

app.get('/:showSlug/:episodeSlug', async (req, res, next) => {
  const show = await store.getShowBySlug(req.params.showSlug);
  if (!show) return next();
  const episode = await store.getEpisodeBySlug(show.id, req.params.episodeSlug);
  if (!episode) return next();

  // Render immediately with whatever is cached; enrich for the next visitor.
  enrichEpisodeInBackground(show, episode);

  // (3) Recommendations — more from this show + similar episodes elsewhere.
  const fromShow = await store.listEpisodes(show.id, { limit: 6 });
  const moreFromShow = fromShow.filter((e) => e.slug !== episode.slug).slice(0, 3);

  // Prefer accurate embedding-based recommendations; fall back to genre-match
  // while the embedding index is still building.
  let related = reco.related(episode.id, show.id, { limit: 4 }).map((r) => ({
    show: { slug: r.showSlug, title: r.showTitle, image_url: r.image_url },
    episode: { slug: r.slug, title: r.title, image_url: r.image_url, duration: r.duration },
  }));
  if (!related.length) {
    const cats = new Set(show.categories || []);
    const others = (await store.listShows()).filter((s) => s.id !== show.id);
    others.sort(
      (a, b) =>
        ((a.categories || []).some((c) => cats.has(c)) ? 0 : 1) -
        ((b.categories || []).some((c) => cats.has(c)) ? 0 : 1)
    );
    for (const s of others.slice(0, 3)) {
      const eps = await store.listEpisodes(s.id, { limit: 1 });
      if (eps[0]) related.push({ show: s, episode: eps[0] });
    }
  }

  res.send(V.episodePage({ show, episode, moreFromShow, related }));
});

// Smart 404: recover old/mistyped URLs by redirecting to the right page,
// otherwise show an on-brand page with "did you mean…" suggestions.
const slugTokens = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

app.use(async (req, res) => {
  const notFound = (suggestions = []) => res.status(404).send(V.notFoundPage({ suggestions }));
  // Only try to recover clean-looking page requests (skip assets, admin, etc.).
  if (req.method !== 'GET' || req.path.includes('.') || req.path.startsWith('/admin')) {
    return notFound();
  }
  try {
    const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (!parts.length) return notFound();
    const shows = await store.listShows();
    const showBase = parts[0].replace(/-\d+$/, ''); // old slugs had a -<id> suffix
    const show = shows.find((s) => s.slug === parts[0] || s.slug === showBase);

    if (show) {
      // Old show URL → redirect to the clean one (or resolve the episode).
      if (parts.length === 1) return res.redirect(301, `/${show.slug}`);
      const epBase = parts[1].replace(/-\d+$/, '');
      const ep =
        (await store.getEpisodeBySlug(show.id, parts[1])) ||
        (await store.getEpisodeBySlug(show.id, epBase));
      return res.redirect(301, ep ? `/${show.slug}/${ep.slug}` : `/${show.slug}`);
    }

    // Hyphen-less vanity URLs from the old site (/onlymurders, /nakedlunch,
    // /wicked …). Google still has these indexed, and the token-based matcher
    // below can't see them because it splits on hyphens. Compare the
    // alphanumeric-only form so they 301 instead of 404ing away their ranking.
    const compact = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cq = compact(showBase);
    if (parts.length === 1 && cq.length >= 5) {
      const hit =
        shows.find((s) => compact(s.slug) === cq) ||
        shows.find((s) => compact(s.title) === cq) ||
        shows.find((s) => compact(s.slug).startsWith(cq)) ||
        shows.find((s) => compact(s.title).startsWith(cq));
      if (hit) return res.redirect(301, `/${hit.slug}`);
    }

    // No direct match → fuzzy "did you mean" against show slugs.
    const qt = slugTokens(showBase);
    const suggestions = shows
      .map((s) => {
        const st = slugTokens(s.slug);
        const inter = [...qt].filter((x) => st.has(x)).length;
        let score = qt.size ? inter / (qt.size + st.size - inter) : 0;
        if (showBase.length >= 4 && s.slug.includes(showBase)) score = Math.max(score, 0.7);
        for (const q of qt) {
          if (q.length < 4) continue; // ignore tiny tokens like "on", "gg"
          if ([...st].some((t) => t.length >= 4 && (t.includes(q) || q.includes(t)))) score = Math.max(score, 0.5);
        }
        return { s, score };
      })
      .filter((x) => x.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.s);
    return notFound(suggestions);
  } catch {
    return notFound();
  }
});

// Fill in AI-written SEO meta descriptions for any shows still missing one.
// Paced and best-effort: silently no-ops without an API key.
// Display copy for the featured banner and cards. The team's own description is
// always preferred — we only write a shortened version for shows whose copy has
// no sentence break inside the space available, where trimming would otherwise
// leave a dangling fragment. Nothing on the site ever renders an ellipsis.
const BLURB_MAX = 165;
async function backfillShowBlurbs() {
  if (process.env.SHOW_SEO === 'off' || !aiConfigured()) return;
  const shows = await store.listShows();
  const needs = shows.filter(
    (s) => !s.blurb && s.description && !endsSentence(plainText(s.description, BLURB_MAX))
  );
  if (!needs.length) return;
  console.log(`[blurb] shortening ${needs.length} show description(s) that don't trim cleanly…`);
  let done = 0;
  for (const show of needs) {
    try {
      const text = await generateShowBlurb({ show, max: BLURB_MAX, log: (m) => console.log('[blurb]', m) });
      if (text) { await store.updateShow(show.id, { blurb: text }); done++; }
    } catch (e) {
      console.error('[blurb] show', show.slug, 'failed:', e.message);
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  console.log(`[blurb] wrote ${done}/${needs.length}`);
}

// A visitor should never meet a cold page. Enrichment happens on first view,
// but the FIRST visitor to an episode would see the card without its hook — so
// warm the episodes people actually land on: the newest few per show, plus any
// episode an ad points at. Bounded per boot so the cost stays predictable.
const WARM_PER_SHOW = 3;
const WARM_MAX = 150;
async function warmEpisodeEnrichment() {
  if (process.env.SHOW_SEO === 'off' || !aiConfigured()) return;
  const shows = await store.listShows();
  const queue = [];
  for (const show of shows) {
    const eps = await store.listEpisodes(show.id, { limit: WARM_PER_SHOW });
    for (const ep of eps) if (!ep.ai_hook && (ep.description || ep.title)) queue.push({ show, ep });
  }
  // Episodes with a landing record are ad destinations — warm those first.
  const advertised = new Set((await store.listLandings()).map((l) => l.episode_id).filter(Boolean));
  queue.sort((a, b) => (advertised.has(b.ep.id) ? 1 : 0) - (advertised.has(a.ep.id) ? 1 : 0));
  const batch = queue.slice(0, WARM_MAX);
  if (!batch.length) return;
  console.log(`[episode] warming ${batch.length} episode page(s)…`);
  let done = 0;
  for (const { show, ep } of batch) {
    try {
      const out = await generateEpisodeEnrichment({ show, episode: ep, log: (m) => console.log('[episode]', m) });
      if (out) {
        await store.updateEpisode(ep.id, {
          ai_hook: out.hook || null,
          ai_takeaways: out.takeaways?.length ? JSON.stringify(out.takeaways) : null,
        });
        done++;
      }
    } catch (e) {
      console.error('[episode] warm failed for', ep.slug, '-', e.message);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log(`[episode] warmed ${done}/${batch.length}`);
}

async function backfillShowSeo() {
  if (process.env.SHOW_SEO === 'off' || !aiConfigured()) return;
  const shows = await store.listShows();
  const missing = shows.filter((s) => !s.seo_description);
  if (!missing.length) return;
  console.log(`[seo] writing meta descriptions for ${missing.length} show(s)…`);
  let done = 0;
  for (const show of missing) {
    try {
      const text = await generateShowMetaDescription({ show, log: (m) => console.log('[seo]', m) });
      if (text) {
        await store.updateShow(show.id, { seo_description: text });
        done++;
      }
    } catch (e) {
      console.error('[seo] show', show.slug, 'failed:', e.message);
    }
    await new Promise((r) => setTimeout(r, 900)); // gentle pacing
  }
  console.log(`[seo] meta descriptions written for ${done}/${missing.length} shows`);
}

app.listen(PORT, async () => {
  console.log(`[strawhut-site] listening on :${PORT}`);
  console.log(`[strawhut-site] admin at /admin (password via ADMIN_PASSWORD env)`);
  // After each scheduled feed sync: refresh recommendations and attach
  // YouTube videos to any newly-published episodes.
  startScheduler(store, {
    afterSync: async () => {
      await reco.refresh(store).catch(() => {});
      if (process.env.YOUTUBE_MATCH !== 'off') {
        await matchAllShows(store, { mode: 'recent', log: (m) => console.log('[youtube]', m) }).catch(() => {});
      }
      await refreshPress(store, { log: (m) => console.log('[press]', m) }).catch(() => {});
      await refreshSpotlight();
      await refreshFooter();
    },
  });

  // Self-populate: on each boot, import every show from the current
  // strawhutmedia.com. Idempotent — existing shows just re-sync, and any
  // show missing (or newly published) is added. Set AUTO_IMPORT=off to skip.
  try {
    if (process.env.AUTO_IMPORT !== 'off') {
      console.log('[import] syncing full show catalog from strawhutmedia.com…');
      const r = await importFromSite(store, { onProgress: (m) => console.log('[import]', m) });
      console.log('[import] catalog sync complete', r);
    }
  } catch (e) {
    console.error('[import] auto-import failed:', e.message);
  }

  // Seed a demo Google-Ads landing page for review (Seen on the Screen).
  // Idempotent: only creates it if it doesn't already exist, so editing or
  // deleting it in the admin sticks. Set SEED_DEMO_LANDING=off to skip.
  try {
    const show = (await store.listShows()).find((s) => s.slug === 'seen-on-the-screen-with-jacqueline-coley');
    const eps = show ? await store.listEpisodes(show.id, { limit: 1 }) : [];
    const ep = eps[0];
    const existingLp = await store.getLandingBySlug('seen-on-the-screen');
    if (existingLp && show && ep) {
      // Regenerate AI copy on the demo while it's still placeholder/unedited
      // (headline == raw episode title, empty subhead, or old salesy copy).
      const unedited =
        !existingLp.subhead ||
        /listen free/i.test(existingLp.subhead) ||
        existingLp.headline === ep.title;
      if (unedited) {
        const copy = await writeLandingCopy({ show, episode: ep, log: (m) => console.log('[ai]', m) });
        await store.updateLanding(existingLp.id, { ...existingLp, ...copy });
        console.log('[seed] regenerated demo landing copy (ai:' + aiConfigured() + ')');
      }
    } else if (!existingLp && process.env.SEED_DEMO_LANDING !== 'off' && show && ep) {
      const copy = await writeLandingCopy({ show, episode: ep, log: (m) => console.log('[ai]', m) });
      await store.createLanding({
        slug: 'seen-on-the-screen',
        title: 'Seen on the Screen — Google Ads LP (demo)',
        headline: copy.headline,
        subhead: copy.subhead,
        body_html: copy.body_html,
        hero_image_url: ep.image_url || show.image_url || '',
        cta_label: '',
        cta_url: '',
        show_id: show.id,
        episode_id: ep.id,
        indexable: false,
        gtag_id: '',
      });
      console.log('[seed] demo landing page created → /lp/seen-on-the-screen (ai:' + aiConfigured() + ')');
    }
  } catch (e) {
    console.error('[seed] demo landing failed:', e.message);
  }

  // Homepage spotlight: prefer the most-downloaded shows (Megaphone); fall
  // back to the curated monthly rotation only if Megaphone isn't reachable.
  refreshSpotlight();

  // Populate the footer "Recent episodes" rail.
  refreshFooter();

  // Upgrade any low-resolution cover art from Apple (background, paced).
  backfillArtwork().catch((e) => console.error('[artwork]', e.message));

  // Weekly traffic digest — checked hourly, sends once every 7 days.
  setInterval(() => maybeSendTrafficDigest().catch(() => {}), 60 * 60 * 1000);
  maybeSendTrafficDigest().catch(() => {});

  // Backfill unique, AI-written SEO meta descriptions for shows that don't have
  // one yet. Runs once per boot in the background, paced to be gentle on the
  // API; no-ops entirely if ANTHROPIC_API_KEY isn't set. Set SHOW_SEO=off to skip.
  backfillShowSeo()
    .then(() => backfillShowBlurbs())
    .then(() => warmEpisodeEnrichment())
    .catch((e) => console.error('[seo] show backfill failed:', e.message));

  // Pull press mentions in the background so the Press page is populated.
  refreshPress(store, { log: (m) => console.log('[press]', m) })
    .then((n) => console.log(`[press] initial pull — ${n} mentions`))
    .catch((e) => console.error('[press] initial pull failed:', e.message));

  // Build the semantic recommendation index in the background, then match
  // YouTube videos to episodes for any shows not yet processed.
  reco
    .buildIndex(store)
    .catch((e) => console.error('[reco] buildIndex failed:', e.message))
    .finally(() => {
      if (process.env.YOUTUBE_MATCH !== 'off') {
        console.log('[youtube] matching videos to episodes in the background…');
        matchAllShows(store, { mode: 'auto', log: (m) => console.log('[youtube]', m) })
          .then((n) => console.log(`[youtube] initial match complete — ${n} episodes linked`))
          .catch((e) => console.error('[youtube] match failed:', e.message));
      }
    });
});
