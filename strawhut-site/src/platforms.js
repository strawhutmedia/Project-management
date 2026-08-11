// Per-show "listen & subscribe on" platform links. We scrape the exact links
// from the current strawhutmedia.com show page during import (so a logo goes to
// the REAL show page on that platform), derive Overcast from the Apple ID, use
// the matched YouTube channel when we have one, and fall back to a platform
// search by title otherwise. Feed-agnostic: works for any show.

// A generic "broadcast" glyph for platforms without a distinct single-path mark.
const BROADCAST =
  '<path d="M12 9a3 3 0 0 1 3 3h-2a1 1 0 0 0-2 0H9a3 3 0 0 1 3-3zm0-4a7 7 0 0 1 7 7h-2a5 5 0 0 0-10 0H5a7 7 0 0 1 7-7zm0 8.5a2 2 0 0 1 2 2c0 .9-2 5.5-2 5.5s-2-4.6-2-5.5a2 2 0 0 1 2-2z"/>';

// Order = display order. color = brand color (used on hover + icon).
export const PLATFORMS = [
  { key: 'spotify', label: 'Spotify', color: '#1DB954', icon: '<path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 01-.277-1.215c3.809-.87 7.076-.496 9.712 1.115a.623.623 0 01.207.857zm1.223-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 01-.973-.519.781.781 0 01.519-.972c3.632-1.102 8.147-.568 11.234 1.328a.78.78 0 01.257 1.072zm.105-2.835c-3.223-1.914-8.54-2.09-11.618-1.156a.935.935 0 11-.543-1.79c3.532-1.072 9.404-.865 13.115 1.338a.935.935 0 01-.954 1.608z"/>' },
  { key: 'apple', label: 'Apple Podcasts', color: '#B150E2', icon: '<path d="M5.34 0A5.33 5.33 0 0 0 0 5.34v13.32A5.33 5.33 0 0 0 5.34 24h13.32A5.33 5.33 0 0 0 24 18.66V5.34A5.33 5.33 0 0 0 18.66 0zM12 3.6a6.6 6.6 0 0 1 1.86 12.93c-.02-.5-.06-.86-.12-1.08a5.4 5.4 0 1 0-3.48 0c-.06.22-.1.58-.12 1.08A6.6 6.6 0 0 1 12 3.6zm0 3a3.6 3.6 0 0 0-1.02 7.05c.06-.9.24-1.5.42-1.83a1.8 1.8 0 1 1 1.2 0c.18.33.36.93.42 1.83A3.6 3.6 0 0 0 12 6.6zm0 6.9c-.9 0-1.5.3-1.5 2.1 0 1.14.15 2.64.36 3.54.15.66.66 1.26 1.14 1.26s.99-.6 1.14-1.26c.21-.9.36-2.4.36-3.54 0-1.8-.6-2.1-1.5-2.1z"/>' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', icon: '<path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12z"/>' },
  { key: 'pocketcasts', label: 'Pocket Casts', color: '#F43E37', icon: '<path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 3.36a8.64 8.64 0 1 1 0 17.28v-2.52a6.12 6.12 0 1 0 0-12.24z"/>' },
  { key: 'overcast', label: 'Overcast', color: '#FC7E0F', icon: '<path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 4.5l2.5 5.7L12 20l-2.5-9.8z"/>' },
  { key: 'iheart', label: 'iHeartRadio', color: '#C6002B', icon: '<path d="M12 21s-6.716-4.35-9.428-7.06C.86 12.22.86 9.34 2.57 7.63a4.5 4.5 0 0 1 6.364 0L12 10.7l3.066-3.07a4.5 4.5 0 0 1 6.364 6.31C18.716 16.65 12 21 12 21z"/>' },
  { key: 'tunein', label: 'TuneIn', color: '#1C1F3B', icon: BROADCAST },
  { key: 'castbox', label: 'Castbox', color: '#F55B23', icon: BROADCAST },
  { key: 'goodpods', label: 'Goodpods', color: '#7C5CFC', icon: BROADCAST },
  { key: 'amazon', label: 'Amazon Music', color: '#25D1DA', icon: BROADCAST },
];

const RX = {
  spotify: /https?:\/\/open\.spotify\.com\/show\/[A-Za-z0-9]+/i,
  apple: /https?:\/\/podcasts\.apple\.com\/[^"'\s<>]*id\d+/i,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/|c\/|@)[^"'\s<>]+/i,
  pocketcasts: /https?:\/\/(?:pca\.st|pocketcasts\.com)\/[^"'\s<>]+/i,
  overcast: /https?:\/\/overcast\.fm\/[^"'\s<>]+/i,
  iheart: /https?:\/\/(?:www\.)?iheart\.com\/podcast\/[^"'\s<>]+/i,
  tunein: /https?:\/\/tunein\.com\/[^"'\s<>]+/i,
  castbox: /https?:\/\/castbox\.fm\/[^"'\s<>]+/i,
  goodpods: /https?:\/\/(?:www\.)?goodpods\.com\/[^"'\s<>]+/i,
  amazon: /https?:\/\/music\.amazon\.com\/podcasts\/[^"'\s<>]+/i,
};

/** Pull whatever curated platform URLs are on a show page's HTML. */
export function extractPlatformLinks(html) {
  const out = {};
  if (!html) return out;
  for (const [k, re] of Object.entries(RX)) {
    const m = html.match(re);
    if (m) out[k] = m[0].replace(/&amp;/g, '&');
  }
  return out;
}

/**
 * Resolve the ordered set of platform buttons for a show: prefer the exact
 * scraped link, then derive/search-fallback so each requested logo still works.
 */
export function resolvePlatformLinks(show) {
  const links = (show && show.platform_links) || {};
  const q = encodeURIComponent(show?.title || '');
  const appleId = (links.apple || '').match(/id(\d+)/)?.[1];
  const out = [];
  for (const p of PLATFORMS) {
    let url = links[p.key] || null;
    if (!url) {
      switch (p.key) {
        case 'spotify': url = `https://open.spotify.com/search/${q}`; break;
        case 'apple': url = `https://podcasts.apple.com/search?term=${q}`; break;
        case 'youtube':
          url = show?.youtube_channel_id
            ? `https://www.youtube.com/channel/${show.youtube_channel_id}`
            : `https://www.youtube.com/results?search_query=${q}%20podcast`;
          break;
        case 'overcast': url = appleId ? `https://overcast.fm/itunes${appleId}` : null; break;
        case 'iheart': url = `https://www.iheart.com/search/?q=${q}`; break;
        case 'tunein': url = `https://tunein.com/search/?query=${q}`; break;
        case 'castbox': url = `https://castbox.fm/search/${q}`; break;
        case 'goodpods': url = `https://www.goodpods.com/search?query=${q}`; break;
        default: url = null; // pocketcasts / amazon: only when scraped (no reliable search)
      }
    }
    if (url) out.push({ label: p.label, color: p.color, icon: p.icon, url });
  }
  return out;
}
