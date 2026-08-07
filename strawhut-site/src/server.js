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
import { sendAnnouncement, mailConfigured } from './mail.js';
import * as reco from './recommend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD + ':strawhut';

const store = await createStore();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/styles.css', express.static(path.join(__dirname, '..', 'public', 'styles.css')));
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

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

app.post('/admin/sync-all', requireAdmin, async (req, res) => {
  const results = await syncAll(store);
  const added = results.reduce((n, r) => n + (r.added || 0), 0);
  setFlash(res, { type: 'ok', msg: `Synced all feeds — ${added} new episodes across ${results.length} shows.` });
  res.redirect('/admin/shows');
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
app.get('/healthz', async (req, res) => res.json({ ok: true, ...(await store.stats()) }));

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

app.use((req, res) => {
  res
    .status(404)
    .send(
      V.homePage
        ? '<link rel="stylesheet" href="/styles.css"><div class="empty" style="font-family:Poppins,sans-serif"><h1>404</h1><p>Page not found. <a href="/" style="color:#22c55e">Go home</a></p></div>'
        : 'Not found'
    );
});

app.listen(PORT, () => {
  console.log(`[strawhut-site] listening on :${PORT}`);
  console.log(`[strawhut-site] admin at /admin (password via ADMIN_PASSWORD env)`);
  startScheduler(store);
  // Build the semantic recommendation index in the background.
  reco.buildIndex(store).catch((e) => console.error('[reco] buildIndex failed:', e.message));
});
