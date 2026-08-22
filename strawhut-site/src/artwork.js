// High-resolution cover art.
//
// Podcast hosts often serve small show artwork — several of ours come off
// Megaphone at 256x256, far below Apple's 1400px minimum, which looks soft
// anywhere we render art large. The full-resolution originals were uploaded to
// Apple, and Apple will serve them at any size, so we resolve artwork from
// there and fall back to the feed's image only if that fails.
//
// Matching is EXACT: every show stores its Apple URL, which contains the
// collection id, so we look that id up directly rather than searching by name
// and risking the wrong show's artwork on a client's page.

const LOOKUP = 'https://itunes.apple.com/lookup?id=';
const MIN_ACCEPTABLE = 1400; // Apple's own minimum for podcast art

/** Pull the numeric collection id out of a podcasts.apple.com URL. */
export function appleIdFrom(url) {
  const m = String(url || '').match(/\/id(\d{6,})/);
  return m ? m[1] : null;
}

/** Rewrite an Apple artwork URL to the size we want (they render on demand). */
export function appleArtAt(url, px = 3000) {
  return String(url || '').replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${px}x${px}bb.jpg`);
}

async function getJson(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'strawhutmedia.com' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Best available artwork URL for a show, or null if Apple can't improve on it.
 * Only returns a URL we've confirmed Apple actually serves.
 */
export async function resolveArtwork(show) {
  const id = appleIdFrom(show.apple_url);
  if (!id) return null;
  const data = await getJson(LOOKUP + encodeURIComponent(id));
  const r = data?.results?.[0];
  if (!r || String(r.collectionId) !== String(id)) return null; // never trust a mismatch
  const art = r.artworkUrl600 || r.artworkUrl100;
  if (!art) return null;
  return appleArtAt(art, 3000);
}

/** Pixel width of an image URL, or 0 if it can't be read. */
export async function imageWidth(url) {
  if (!url) return 0;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return 0;
    const buf = Buffer.from(await r.arrayBuffer());
    // JPEG: walk the segment markers to the SOF frame header.
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return buf.readUInt16BE(i + 7);
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return 0;
    }
    // PNG: width lives in the IHDR chunk.
    if (buf.slice(1, 4).toString() === 'PNG') return buf.readUInt32BE(16);
    return 0;
  } catch {
    return 0;
  }
}

export { MIN_ACCEPTABLE };
