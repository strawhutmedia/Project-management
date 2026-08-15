// Storage layer. Two interchangeable backends behind one async interface:
//   - Postgres  (when DATABASE_URL is set)  -> production, same as Slate
//   - JSON file (otherwise)                 -> zero-setup local / demo mode
//
// A "show" is essentially one podcast RSS feed plus display settings.
// "episodes" are derived from that feed and refreshed on a schedule.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function newId() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// JSON-file backend
// ---------------------------------------------------------------------------
class JsonStore {
  constructor() {
    this.db = { shows: {}, episodes: {}, subscribers: {}, announcements: {}, press_items: {}, landing_pages: {} };
  }
  async init() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        this.db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this.db.shows ||= {};
        this.db.episodes ||= {};
        this.db.subscribers ||= {};
        this.db.announcements ||= {};
        this.db.press_items ||= {};
        this.db.landing_pages ||= {};
      } else {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        this._flush();
      }
    } catch (e) {
      console.error('[store] failed to load JSON store, starting empty:', e.message);
      this.db = { shows: {}, episodes: {} };
    }
    console.log('[store] using JSON file store at', DATA_FILE);
  }
  _flush() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.db, null, 2));
  }

  async listShows() {
    return Object.values(this.db.shows).sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.title.localeCompare(b.title)
    );
  }
  async getShowById(id) {
    return this.db.shows[id] || null;
  }
  async getShowBySlug(slug) {
    return Object.values(this.db.shows).find((s) => s.slug === slug) || null;
  }
  async getShowByFeed(feedUrl) {
    return Object.values(this.db.shows).find((s) => s.feed_url === feedUrl) || null;
  }
  async upsertShow(show) {
    const existing = show.id ? this.db.shows[show.id] : await this.getShowByFeed(show.feed_url);
    const id = existing?.id || show.id || newId();
    const merged = { ...existing, ...show, id };
    this.db.shows[id] = merged;
    this._flush();
    return merged;
  }
  async updateShow(id, patch) {
    if (!this.db.shows[id]) return null;
    this.db.shows[id] = { ...this.db.shows[id], ...patch, id };
    this._flush();
    return this.db.shows[id];
  }
  async deleteShow(id) {
    delete this.db.shows[id];
    for (const [eid, ep] of Object.entries(this.db.episodes)) {
      if (ep.show_id === id) delete this.db.episodes[eid];
    }
    this._flush();
  }

  async listEpisodes(showId, { limit = 1000, offset = 0 } = {}) {
    return Object.values(this.db.episodes)
      .filter((e) => e.show_id === showId)
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
      .slice(offset, offset + limit);
  }
  async getEpisodeBySlug(showId, slug) {
    return (
      Object.values(this.db.episodes).find((e) => e.show_id === showId && e.slug === slug) || null
    );
  }
  async getEpisodeById(id) {
    return this.db.episodes[id] || null;
  }
  async updateEpisode(id, patch) {
    if (!this.db.episodes[id]) return null;
    this.db.episodes[id] = { ...this.db.episodes[id], ...patch, id };
    this._flush();
    return this.db.episodes[id];
  }
  async countEpisodes(showId) {
    return Object.values(this.db.episodes).filter((e) => e.show_id === showId).length;
  }
  async existingGuids(showId) {
    return new Set(
      Object.values(this.db.episodes)
        .filter((e) => e.show_id === showId)
        .map((e) => e.guid)
    );
  }
  async existingEpisodeSlugs(showId) {
    return new Set(
      Object.values(this.db.episodes)
        .filter((e) => e.show_id === showId)
        .map((e) => e.slug)
    );
  }
  async insertEpisode(ep) {
    const id = ep.id || newId();
    this.db.episodes[id] = { ...ep, id };
    this._flush();
    return this.db.episodes[id];
  }
  async allEpisodesRaw() {
    return Object.values(this.db.episodes);
  }
  async setEpisodeEmbedding(id, vec) {
    if (this.db.episodes[id]) this.db.episodes[id].embedding = vec; // flush batched via save()
  }
  async setEpisodeYouTube(id, youtubeId) {
    if (this.db.episodes[id]) {
      this.db.episodes[id].youtube_id = youtubeId;
      this._flush();
    }
  }
  async save() {
    this._flush();
  }
  async stats() {
    return {
      shows: Object.keys(this.db.shows).length,
      episodes: Object.keys(this.db.episodes).length,
      subscribers: Object.keys(this.db.subscribers).length,
    };
  }

  // --- subscribers (members) ---
  async addSubscriber(email, name) {
    email = String(email || '').trim().toLowerCase();
    if (!email) throw new Error('Email required');
    const existing = Object.values(this.db.subscribers).find((s) => s.email === email);
    if (existing) return existing;
    const id = newId();
    this.db.subscribers[id] = { id, email, name: name || '', created_at: new Date().toISOString() };
    this._flush();
    return this.db.subscribers[id];
  }
  async listSubscribers() {
    return Object.values(this.db.subscribers).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async removeSubscriber(id) {
    delete this.db.subscribers[id];
    this._flush();
  }

  // --- announcements ---
  async createAnnouncement(a) {
    const id = newId();
    this.db.announcements[id] = {
      id, subject: a.subject, body_html: a.body_html,
      sent: false, sent_count: 0, created_at: new Date().toISOString(), sent_at: null,
    };
    this._flush();
    return this.db.announcements[id];
  }
  async listAnnouncements() {
    return Object.values(this.db.announcements).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async getAnnouncement(id) {
    return this.db.announcements[id] || null;
  }
  async markAnnouncementSent(id, count) {
    if (this.db.announcements[id]) {
      Object.assign(this.db.announcements[id], { sent: true, sent_count: count, sent_at: new Date().toISOString() });
      this._flush();
    }
  }
  async deleteAnnouncement(id) {
    delete this.db.announcements[id];
    this._flush();
  }

  // --- press items ---
  async upsertPressItem(item) {
    const existing = Object.values(this.db.press_items).find((p) => p.url === item.url);
    if (existing) return false;
    const id = newId();
    this.db.press_items[id] = { id, ...item, created_at: new Date().toISOString() };
    return true; // caller batches save()
  }
  async listPressItems({ limit = 200 } = {}) {
    return Object.values(this.db.press_items)
      .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
      .slice(0, limit);
  }
  async deletePressItem(id) {
    delete this.db.press_items[id];
    this._flush();
  }
  async setPressItemImage(id, image_url) {
    if (this.db.press_items[id]) { this.db.press_items[id].image_url = image_url; this._flush(); }
  }
  async countPressItems() {
    return Object.keys(this.db.press_items).length;
  }

  // --- landing pages ---
  async createLanding(lp) {
    const id = lp.id || newId();
    this.db.landing_pages[id] = { id, created_at: new Date().toISOString(), ...lp };
    this._flush();
    return this.db.landing_pages[id];
  }
  async listLandings() {
    return Object.values(this.db.landing_pages).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }
  async getLandingBySlug(slug) {
    return Object.values(this.db.landing_pages).find((l) => l.slug === slug) || null;
  }
  async getLandingById(id) {
    return this.db.landing_pages[id] || null;
  }
  async updateLanding(id, patch) {
    if (!this.db.landing_pages[id]) return null;
    this.db.landing_pages[id] = { ...this.db.landing_pages[id], ...patch, id };
    this._flush();
    return this.db.landing_pages[id];
  }
  async deleteLanding(id) {
    delete this.db.landing_pages[id];
    this._flush();
  }
}

// ---------------------------------------------------------------------------
// Postgres backend
// ---------------------------------------------------------------------------
class PgStore {
  constructor(pool) {
    this.pool = pool;
  }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS shows (
        id           TEXT PRIMARY KEY,
        slug         TEXT UNIQUE NOT NULL,
        title        TEXT NOT NULL,
        description  TEXT,
        seo_description TEXT,
        author       TEXT,
        image_url    TEXT,
        feed_url     TEXT UNIQUE NOT NULL,
        link         TEXT,
        categories   TEXT,
        spotify_url  TEXT,
        apple_url    TEXT,
        show_type    TEXT DEFAULT 'original',
        youtube_channel_id TEXT,
        featured     BOOLEAN DEFAULT FALSE,
        sort_order   INTEGER DEFAULT 0,
        last_synced  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS episodes (
        id            TEXT PRIMARY KEY,
        show_id       TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
        guid          TEXT NOT NULL,
        slug          TEXT NOT NULL,
        title         TEXT NOT NULL,
        description   TEXT,
        audio_url     TEXT,
        image_url     TEXT,
        duration      TEXT,
        published_at  TIMESTAMPTZ,
        episode_number INTEGER,
        season        INTEGER,
        embedding     TEXT,
        youtube_id    TEXT,
        UNIQUE (show_id, guid)
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_id, published_at DESC);
      CREATE TABLE IF NOT EXISTS subscribers (
        id         TEXT PRIMARY KEY,
        email      TEXT UNIQUE NOT NULL,
        name       TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS announcements (
        id         TEXT PRIMARY KEY,
        subject    TEXT NOT NULL,
        body_html  TEXT,
        sent       BOOLEAN DEFAULT FALSE,
        sent_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        sent_at    TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS press_items (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        url          TEXT UNIQUE NOT NULL,
        source       TEXT,
        snippet      TEXT,
        query        TEXT,
        published_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS landing_pages (
        id            TEXT PRIMARY KEY,
        slug          TEXT UNIQUE NOT NULL,
        title         TEXT,
        headline      TEXT,
        subhead       TEXT,
        body_html     TEXT,
        hero_image_url TEXT,
        cta_label     TEXT,
        cta_url       TEXT,
        show_id       TEXT,
        episode_id    TEXT,
        indexable     BOOLEAN DEFAULT FALSE,
        gtag_id       TEXT,
        created_at    TIMESTAMPTZ DEFAULT now()
      );
    `);
    // Lightweight migrations: CREATE TABLE IF NOT EXISTS won't add columns to
    // a table that already exists, so add any newer columns idempotently.
    await this.pool.query(`
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS spotify_url        TEXT;
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS apple_url          TEXT;
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS show_type          TEXT DEFAULT 'original';
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT;
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS platform_links     TEXT;
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS seo_description    TEXT;
      ALTER TABLE shows    ADD COLUMN IF NOT EXISTS last_synced        TIMESTAMPTZ;
      ALTER TABLE episodes ADD COLUMN IF NOT EXISTS episode_number     INTEGER;
      ALTER TABLE episodes ADD COLUMN IF NOT EXISTS season             INTEGER;
      ALTER TABLE episodes ADD COLUMN IF NOT EXISTS embedding          TEXT;
      ALTER TABLE episodes ADD COLUMN IF NOT EXISTS youtube_id         TEXT;
      ALTER TABLE press_items ADD COLUMN IF NOT EXISTS image_url       TEXT;
    `);
    console.log('[store] using Postgres store');
  }
  _rowToShow(r) {
    if (!r) return null;
    let platform_links = null;
    if (r.platform_links) { try { platform_links = JSON.parse(r.platform_links); } catch { platform_links = null; } }
    return { ...r, categories: r.categories ? JSON.parse(r.categories) : [], platform_links };
  }
  async listShows() {
    const { rows } = await this.pool.query(
      `SELECT * FROM shows ORDER BY featured DESC, sort_order ASC, title ASC`
    );
    return rows.map((r) => this._rowToShow(r));
  }
  async getShowById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM shows WHERE id=$1`, [id]);
    return this._rowToShow(rows[0]);
  }
  async getShowBySlug(slug) {
    const { rows } = await this.pool.query(`SELECT * FROM shows WHERE slug=$1`, [slug]);
    return this._rowToShow(rows[0]);
  }
  async getShowByFeed(feedUrl) {
    const { rows } = await this.pool.query(`SELECT * FROM shows WHERE feed_url=$1`, [feedUrl]);
    return this._rowToShow(rows[0]);
  }
  async upsertShow(show) {
    const existing = show.id
      ? await this.getShowById(show.id)
      : await this.getShowByFeed(show.feed_url);
    const id = existing?.id || show.id || newId();
    const m = { ...existing, ...show, id };
    await this.pool.query(
      `INSERT INTO shows (id, slug, title, description, author, image_url, feed_url, link, categories, spotify_url, apple_url, show_type, youtube_channel_id, platform_links, featured, sort_order, last_synced, seo_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         slug=$2, title=$3, description=$4, author=$5, image_url=$6, feed_url=$7, link=$8,
         categories=$9, spotify_url=$10, apple_url=$11, show_type=$12, youtube_channel_id=$13, platform_links=$14, featured=$15, sort_order=$16, last_synced=$17, seo_description=$18`,
      [
        id, m.slug, m.title, m.description, m.author, m.image_url, m.feed_url, m.link,
        JSON.stringify(m.categories || []), m.spotify_url, m.apple_url,
        m.show_type || 'original', m.youtube_channel_id || null,
        m.platform_links ? (typeof m.platform_links === 'string' ? m.platform_links : JSON.stringify(m.platform_links)) : null,
        !!m.featured, m.sort_order || 0, m.last_synced || null, m.seo_description || null,
      ]
    );
    return this.getShowById(id);
  }
  async updateShow(id, patch) {
    const cur = await this.getShowById(id);
    if (!cur) return null;
    return this.upsertShow({ ...cur, ...patch, id });
  }
  async deleteShow(id) {
    await this.pool.query(`DELETE FROM shows WHERE id=$1`, [id]);
  }
  async listEpisodes(showId, { limit = 1000, offset = 0 } = {}) {
    const { rows } = await this.pool.query(
      `SELECT * FROM episodes WHERE show_id=$1 ORDER BY published_at DESC NULLS LAST LIMIT $2 OFFSET $3`,
      [showId, limit, offset]
    );
    return rows;
  }
  async getEpisodeBySlug(showId, slug) {
    const { rows } = await this.pool.query(
      `SELECT * FROM episodes WHERE show_id=$1 AND slug=$2`,
      [showId, slug]
    );
    return rows[0] || null;
  }
  async getEpisodeById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM episodes WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async updateEpisode(id, patch) {
    const cur = await this.getEpisodeById(id);
    if (!cur) return null;
    const m = { ...cur, ...patch };
    await this.pool.query(
      `UPDATE episodes SET title=$2, description=$3, image_url=$4, youtube_id=$5 WHERE id=$1`,
      [id, m.title, m.description, m.image_url, m.youtube_id || null]
    );
    return this.getEpisodeById(id);
  }
  async countEpisodes(showId) {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS c FROM episodes WHERE show_id=$1`,
      [showId]
    );
    return rows[0].c;
  }
  async existingGuids(showId) {
    const { rows } = await this.pool.query(`SELECT guid FROM episodes WHERE show_id=$1`, [showId]);
    return new Set(rows.map((r) => r.guid));
  }
  async existingEpisodeSlugs(showId) {
    const { rows } = await this.pool.query(`SELECT slug FROM episodes WHERE show_id=$1`, [showId]);
    return new Set(rows.map((r) => r.slug));
  }
  async insertEpisode(ep) {
    const id = ep.id || newId();
    await this.pool.query(
      `INSERT INTO episodes (id, show_id, guid, slug, title, description, audio_url, image_url, duration, published_at, episode_number, season, youtube_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (show_id, guid) DO NOTHING`,
      [
        id, ep.show_id, ep.guid, ep.slug, ep.title, ep.description, ep.audio_url,
        ep.image_url, ep.duration, ep.published_at || null, ep.episode_number, ep.season,
        ep.youtube_id || null,
      ]
    );
    return { ...ep, id };
  }
  async allEpisodesRaw() {
    const { rows } = await this.pool.query(
      `SELECT id, show_id, slug, title, image_url, duration, embedding, youtube_id FROM episodes`
    );
    return rows;
  }
  async setEpisodeEmbedding(id, vec) {
    await this.pool.query(`UPDATE episodes SET embedding=$2 WHERE id=$1`, [id, JSON.stringify(vec)]);
  }
  async setEpisodeYouTube(id, youtubeId) {
    await this.pool.query(`UPDATE episodes SET youtube_id=$2 WHERE id=$1`, [id, youtubeId]);
  }
  async save() {}
  async stats() {
    const s = await this.pool.query(`SELECT COUNT(*)::int AS c FROM shows`);
    const e = await this.pool.query(`SELECT COUNT(*)::int AS c FROM episodes`);
    const sub = await this.pool.query(`SELECT COUNT(*)::int AS c FROM subscribers`);
    return { shows: s.rows[0].c, episodes: e.rows[0].c, subscribers: sub.rows[0].c };
  }

  // --- subscribers (members) ---
  async addSubscriber(email, name) {
    email = String(email || '').trim().toLowerCase();
    if (!email) throw new Error('Email required');
    const id = newId();
    const { rows } = await this.pool.query(
      `INSERT INTO subscribers (id, email, name) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET name=COALESCE(NULLIF($3,''), subscribers.name)
       RETURNING *`,
      [id, email, name || '']
    );
    return rows[0];
  }
  async listSubscribers() {
    const { rows } = await this.pool.query(`SELECT * FROM subscribers ORDER BY created_at DESC`);
    return rows;
  }
  async removeSubscriber(id) {
    await this.pool.query(`DELETE FROM subscribers WHERE id=$1`, [id]);
  }

  // --- announcements ---
  async createAnnouncement(a) {
    const id = newId();
    const { rows } = await this.pool.query(
      `INSERT INTO announcements (id, subject, body_html) VALUES ($1,$2,$3) RETURNING *`,
      [id, a.subject, a.body_html]
    );
    return rows[0];
  }
  async listAnnouncements() {
    const { rows } = await this.pool.query(`SELECT * FROM announcements ORDER BY created_at DESC`);
    return rows;
  }
  async getAnnouncement(id) {
    const { rows } = await this.pool.query(`SELECT * FROM announcements WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async markAnnouncementSent(id, count) {
    await this.pool.query(
      `UPDATE announcements SET sent=TRUE, sent_count=$2, sent_at=now() WHERE id=$1`,
      [id, count]
    );
  }
  async deleteAnnouncement(id) {
    await this.pool.query(`DELETE FROM announcements WHERE id=$1`, [id]);
  }

  // --- press items ---
  async upsertPressItem(item) {
    const id = newId();
    const { rowCount } = await this.pool.query(
      `INSERT INTO press_items (id, title, url, source, snippet, query, published_at, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (url) DO NOTHING`,
      [id, item.title, item.url, item.source, item.snippet, item.query, item.published_at || null, item.image_url || null]
    );
    return rowCount > 0;
  }
  async listPressItems({ limit = 200 } = {}) {
    const { rows } = await this.pool.query(
      `SELECT * FROM press_items ORDER BY published_at DESC NULLS LAST LIMIT $1`,
      [limit]
    );
    return rows;
  }
  async deletePressItem(id) {
    await this.pool.query(`DELETE FROM press_items WHERE id=$1`, [id]);
  }
  async setPressItemImage(id, image_url) {
    await this.pool.query(`UPDATE press_items SET image_url=$2 WHERE id=$1`, [id, image_url]);
  }
  async countPressItems() {
    const { rows } = await this.pool.query(`SELECT COUNT(*)::int AS c FROM press_items`);
    return rows[0].c;
  }

  // --- landing pages ---
  async createLanding(lp) {
    const id = lp.id || newId();
    await this.pool.query(
      `INSERT INTO landing_pages (id, slug, title, headline, subhead, body_html, hero_image_url, cta_label, cta_url, show_id, episode_id, indexable, gtag_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, lp.slug, lp.title, lp.headline, lp.subhead, lp.body_html, lp.hero_image_url,
       lp.cta_label, lp.cta_url, lp.show_id || null, lp.episode_id || null, !!lp.indexable, lp.gtag_id || null]
    );
    return this.getLandingById(id);
  }
  async listLandings() {
    const { rows } = await this.pool.query(`SELECT * FROM landing_pages ORDER BY created_at DESC`);
    return rows;
  }
  async getLandingBySlug(slug) {
    const { rows } = await this.pool.query(`SELECT * FROM landing_pages WHERE slug=$1`, [slug]);
    return rows[0] || null;
  }
  async getLandingById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM landing_pages WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async updateLanding(id, patch) {
    const cur = await this.getLandingById(id);
    if (!cur) return null;
    const m = { ...cur, ...patch };
    await this.pool.query(
      `UPDATE landing_pages SET slug=$2, title=$3, headline=$4, subhead=$5, body_html=$6, hero_image_url=$7,
         cta_label=$8, cta_url=$9, show_id=$10, episode_id=$11, indexable=$12, gtag_id=$13 WHERE id=$1`,
      [id, m.slug, m.title, m.headline, m.subhead, m.body_html, m.hero_image_url,
       m.cta_label, m.cta_url, m.show_id || null, m.episode_id || null, !!m.indexable, m.gtag_id || null]
    );
    return this.getLandingById(id);
  }
  async deleteLanding(id) {
    await this.pool.query(`DELETE FROM landing_pages WHERE id=$1`, [id]);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export async function createStore() {
  if (process.env.DATABASE_URL) {
    const pg = await import('pg');
    const url = process.env.DATABASE_URL;
    // Railway's internal DB (and localhost) speak plain TCP with no TLS;
    // external/proxy hosts need SSL. Detect and configure accordingly.
    const noSsl = /localhost|127\.0\.0\.1|::1|\.railway\.internal/.test(url) || process.env.PGSSL === 'off';
    const pool = new pg.default.Pool({
      connectionString: url,
      ssl: noSsl ? false : { rejectUnauthorized: false },
    });
    const store = new PgStore(pool);
    await store.init();
    return store;
  }
  const store = new JsonStore();
  await store.init();
  return store;
}
