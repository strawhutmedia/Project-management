// Curated corrections applied during import.
//
// Why this exists: the public strawhutmedia.com pages don't always point at a
// show's current feed (some shows migrated hosts), and they don't expose which
// shows are "partner" vs "original". This file encodes those facts explicitly
// so imports are always correct — no manual admin clicks.
//
// - IMPORT_OVERRIDES: keyed by the show's path on strawhutmedia.com. Sets the
//   feed to use (overriding whatever the page links) and/or the show_type.
// - PARTNER_SHOWS: titles that should be classified as partner shows.
// - RETIRE_FEEDS: superseded feed URLs — any show still on one of these is
//   removed before import so a stale duplicate can't linger.

export const IMPORT_OVERRIDES = {
  // Moved from Spreaker → Megaphone; partner show.
  'commune-courses-380': {
    feed_url: 'https://feeds.megaphone.fm/SHM5016877983',
    show_type: 'partnered',
  },
  // Already on Megaphone (feeds.megaphone.fm/commune); just a partner show.
  'commune-with-jeff-krasno': { show_type: 'partnered' },
};

// Titles (case-insensitive) to mark as partner shows. Extend as needed.
export const PARTNER_SHOWS = [
  'Commune with Jeff Krasno',
  'Commune Courses',
];

// Feeds that have been superseded — remove any show still importing from them.
export const RETIRE_FEEDS = [
  'https://www.spreaker.com/show/6055146/episodes/feed', // old Commune Courses (now Megaphone)
];

// Homepage spotlight pool — shows we're proud to feature. Each month the site
// rotates through this pool and spotlights a different set of 3 (see
// src/spotlight.js). Edit this list to change what can be spotlighted.
export const SPOTLIGHT_POOL = [
  'naked-lunch',
  'dont-be-alone-with-jay-kogen',
  'seen-on-the-screen-with-jacqueline-coley',
  'wicked-the-official-podcast',
  'only-murders-in-the-building',
];

// Evergreen shows: ended but still worth spotlighting (e.g. Wicked keeps
// pulling downloads). These stay eligible for rotation even when not "active."
// (When Megaphone is configured, ongoing downloads also keep a show eligible
// automatically — this list is the manual safety net.)
export const EVERGREEN_SHOWS = ['wicked-the-official-podcast'];

// Shows to import that are NOT discoverable by crawling strawhutmedia.com
// (e.g. Only Murders, whose official feed lives elsewhere). Each: { feed_url,
// show_type, slug? }. slug is optional — otherwise derived from the title.
export const EXTRA_SHOWS = [
  {
    // Official OMITB podcast (Hulu / Michael Cyril Creighton) — the show's own
    // Megaphone feed, NOT any Straw Hut feed. Verified via Apple id 1835954447.
    feed_url: 'https://feeds.megaphone.fm/ESP6559945162',
    show_type: 'partnered',
    slug: 'only-murders-in-the-building',
  },
];

// Show pages on the current site that are NOT real shows (placeholders/mistakes).
// Skipped on import and removed if already present.
export const EXCLUDE_SHOW_PATHS = [
  'untitled-689', // placeholder "Untitled" — not a real show
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const isPartnerTitle = (title) => PARTNER_SHOWS.some((p) => norm(p) === norm(title));

// Per-show press disambiguation. For shows whose title collides with a famous
// book/film/generic phrase, require ANY of these host/keyword terms in the
// search and in the result — so only the real podcast's coverage is posted.
// Keyed by the show's slug.
export const PRESS_SHOW_HINTS = {
  'naked-lunch': ['Phil Rosenthal'], // not the Burroughs novel/film
  'pride': ['Levi Chambers', 'Caitlynn McDaniel'], // hosts (past & present)
  'next-city': ['Lucas Grindley'],
  'confess-your-mess': ['Emile Ennis', 'AJ Gibson'],
};
export const pressHintFor = (slug) => PRESS_SHOW_HINTS[String(slug || '').toLowerCase().trim()] || null;

// Talent we no longer actively work with. We KEEP their existing show,
// episodes, and press — but freeze the show (see FROZEN_SHOWS below) so no NEW
// episodes are added, and stop adding NEW press mentioning them dated on/after
// `since`. Override via PRESS_EXCLUDE_SINCE_JSON (a JSON array).
export const PRESS_EXCLUDE_SINCE = process.env.PRESS_EXCLUDE_SINCE_JSON
  ? JSON.parse(process.env.PRESS_EXCLUDE_SINCE_JSON)
  : [{ name: 'Brandi Glanville', since: '2026-07-01' }];

// Block a freshly-fetched mention? True if it names an excluded person AND is
// dated on/after their cutoff. Undated items are treated as new → blocked.
// Existing press already in the DB is never touched — this only gates new adds.
export function pressBlockedSince(text, publishedAt) {
  const t = String(text || '').toLowerCase();
  for (const { name, since } of PRESS_EXCLUDE_SINCE) {
    if (!name || !t.includes(name.toLowerCase())) continue;
    if (!publishedAt) return true;
    const d = new Date(publishedAt);
    if (isNaN(d.getTime())) return true;
    if (d.getTime() >= new Date(since).getTime()) return true;
  }
  return false;
}

// For purging items ALREADY in the DB: remove an excluded person's mentions
// that are definitively dated on/after the cutoff. Undated existing items are
// kept (they're part of "the press we currently have").
export function pressPurgeExisting(text, publishedAt) {
  if (!publishedAt) return false;
  const d = new Date(publishedAt);
  if (isNaN(d.getTime())) return false;
  const t = String(text || '').toLowerCase();
  return PRESS_EXCLUDE_SINCE.some(
    ({ name, since }) => name && t.includes(name.toLowerCase()) && d.getTime() >= new Date(since).getTime()
  );
}

// Shows to keep but FREEZE — existing episodes stay; no new episodes are added
// on sync. Matched by slug (and base slug, ignoring any trailing "-<id>").
// Override via the FROZEN_SHOWS env var (comma-separated slugs).
export const FROZEN_SHOWS = (process.env.FROZEN_SHOWS
  ? process.env.FROZEN_SHOWS.split(',')
  : ['brandi-glanville-unfiltered']
).map((s) => s.trim().toLowerCase()).filter(Boolean);

export const isFrozenShow = (slug) => {
  const s = String(slug || '').toLowerCase().trim();
  return FROZEN_SHOWS.includes(s) || FROZEN_SHOWS.includes(s.replace(/-\d+$/, ''));
};

// Press: search queries used to auto-pull media mentions from Google News.
// Quoted for precision. Override with the PRESS_QUERIES env var (comma-separated).
export const PRESS_QUERIES = (process.env.PRESS_QUERIES
  ? process.env.PRESS_QUERIES.split(',')
  : ['"Straw Hut Media"']
).map((s) => s.trim()).filter(Boolean);
