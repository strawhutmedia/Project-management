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

// Press: search queries used to auto-pull media mentions from Google News.
// Quoted for precision. Override with the PRESS_QUERIES env var (comma-separated).
export const PRESS_QUERIES = (process.env.PRESS_QUERIES
  ? process.env.PRESS_QUERIES.split(',')
  : ['"Straw Hut Media"']
).map((s) => s.trim()).filter(Boolean);
