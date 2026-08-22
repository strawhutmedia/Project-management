// Small shared helpers.

export function slugify(input, fallback = 'item') {
  const s = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || fallback;
}

// Make `slug` unique against a set of taken slugs by appending -2, -3, ...
export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

// Strip HTML tags to a plain-text preview.
export function toText(html, max = 300) {
  const t = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!max || t.length <= max) return t;
  // Never truncate mid-thought with an ellipsis. Cut at the last sentence that
  // fits, so what's shown is always a finished sentence someone wrote.
  const window = t.slice(0, max);
  const whole = window.match(/^[\s\S]*[.!?]["'\u2019\u201d)\]]?(?=\s|$)/);
  if (whole) return whole[0].trim();
  // No sentence ends inside the budget (a run-on description). Fall back to
  // whole words and drop any trailing punctuation, but still no ellipsis.
  return window.replace(/\s+\S*$/, '').replace(/[\s,;:\u2014-]+$/, '').trim();
}

// Escape a string for safe insertion into HTML.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Human-readable duration from seconds or "HH:MM:SS".
export function formatDuration(dur) {
  if (dur == null || dur === '') return '';
  let secs;
  if (typeof dur === 'string' && dur.includes(':')) {
    const parts = dur.split(':').map((n) => parseInt(n, 10) || 0);
    secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  } else {
    secs = parseInt(dur, 10) || 0;
  }
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

export function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** True when a string ends on a finished sentence (so it needs no ellipsis). */
export function endsSentence(s) {
  return /[.!?]["'\u2019\u201d)\]]?$/.test(String(s || '').trim());
}
