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
import { sendAnnouncement, mailConfigured, sendContactEmail } from './mail.js';
import { importFromSite } from './importer.js';
import * as reco from './recommend.js';
import { matchAllShows, matchShowVideos } from './youtube.js';
import { refreshPress } from './press.js';
import { applyMonthlyRotation } from './spotlight.js';
import { applyPopularSpotlight, megaphoneConfigured } from './popularity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD + ':strawhut';

const store = await createStore();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/styles.css', express.static(path.join(__dirname, '..', 'public', 'styles.css')));
// Hidden onboarding app (standalone static; not linked from the site).
app.use('/onboarding', express.static(path.join(__dirname, '..', 'public', 'onboarding')));
// Services / packages quote builder (standalone static, from Sales-Quoting).
app.use('/services', express.static(path.join(__dirname, '..', 'public', 'services')));
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// Spotlight = most-downloaded shows (Megaphone). Falls back to the curated
// monthly rotation only when Megaphone isn't configured or returns no numbers.
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
  return {
    slug,
    title: (body.title || '').trim(),
    headline: (body.headline || '').trim(),
    subhead: (body.subhead || '').trim(),
    body_html: body.body_html || '',
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
  res.json({ ok: true, ...(await store.stats()), spotlight: { source: sp.source, shows: titles } });
});

// ---- SEO / GEO endpoints --------------------------------------------------
app.get('/robots.txt', (req, res) => res.type('text/plain').send(robotsTxt()));

app.get('/sitemap.xml', async (req, res) => {
  const shows = await store.listShows();
  const episodesByShow = {};
  for (const s of shows) episodesByShow[s.id] = await store.listEpisodes(s.id, { limit: 2000 });
  res.type('application/xml').send(sitemapXml(shows, episodesByShow));
});

app.get('/llms.txt', async (req, res) => {
  const shows = await store.listShows();
  res.type('text/plain').send(llmsTxt(shows));
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

app.get('/studio', (req, res) => res.send(V.studioPage()));

app.get('/contact', (req, res) => res.send(V.contactPage()));
app.post('/contact', async (req, res) => {
  const { name = '', email = '', company = '', message = '', topic = 'general' } = req.body || {};
  const values = { name, email, company, message, topic };
  if (!name.trim() || !email.trim() || !message.trim()) {
    return res.send(V.contactPage({ error: 'Please fill in your name, email, and a message.', values }));
  }
  try {
    if (mailConfigured()) {
      await sendContactEmail({ name, email, company, message, topic });
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

app.post('/subscribe', async (req, res) => {
  const email = (req.body.email || '').trim();
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
app.get('/:showSlug/:episodeSlug', async (req, res, next) => {
  const show = await store.getShowBySlug(req.params.showSlug);
  if (!show) return next();
  const episode = await store.getEpisodeBySlug(show.id, req.params.episodeSlug);
  if (!episode) return next();

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

  // Homepage spotlight: prefer the most-downloaded shows (Megaphone); fall
  // back to the curated monthly rotation only if Megaphone isn't reachable.
  refreshSpotlight();

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
