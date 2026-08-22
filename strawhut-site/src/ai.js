// AI copywriting — reads a show + episode's materials and writes the landing
// page copy (headline, subhead, body), optimized for the two goals (press play,
// then subscribe) and for SEO. Uses the Anthropic Messages API via fetch (no
// SDK dependency), the same ANTHROPIC_API_KEY as Podbooster / Slate.
//
//   ANTHROPIC_API_KEY   (required for AI copy; falls back to a heuristic if unset)
//   LANDING_COPY_MODEL  (optional, default claude-sonnet-4-6)

import { toText, endsSentence} from './util.js';

const KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = (process.env.LANDING_COPY_MODEL || 'claude-sonnet-4-6').trim();

export function aiConfigured() {
  return !!KEY;
}

const SYSTEM = `You are a senior direct-response copywriter for Straw Hut Media, an award-winning podcast network.
You write landing pages for a SINGLE podcast episode; these pages run as paid Google Ads.
Two goals, in priority order:
  1) Get the visitor to press PLAY on the audio player embedded on the page.
  2) Get them to SUBSCRIBE to the show on their podcast app.
Voice: premium, confident, editorial — like great magazine cover copy. NEVER cheesy or salesy.
Hard rules: no "listen free", no "tune in", no exclamation-point spam, no clickbait lies, no emojis.
Be specific to THIS episode's actual content (guests, topics, moments). Naturally include SEO keywords
(the show name, host name, guest names, and topics) without keyword-stuffing.`;

function buildPrompt({ show, episode }) {
  const showTitle = show?.title || '';
  const host = show?.author || '';
  const showDesc = toText(show?.description, 600);
  const epTitle = episode?.title || '';
  const epDesc = toText(episode?.description, 1400);
  return `Write landing-page copy for this episode. Return STRICT JSON only, no markdown, with keys:
{
  "headline": "a specific, click-worthy hook, ~5-11 words, honest to the episode (may differ from the raw title)",
  "subhead": "one sentence, ~15-26 words, that makes someone want to press play right now",
  "body_html": "2-3 short <p>...</p> paragraphs that set up the episode, tease the payoff, and end with a soft nudge to follow/subscribe to the show. Plain <p> tags only."
}

SHOW: ${showTitle}
HOST: ${host}
SHOW DESCRIPTION: ${showDesc}
EPISODE TITLE: ${epTitle}
EPISODE DESCRIPTION: ${epDesc}`;
}

function parseJson(text) {
  if (!text) return null;
  let t = text.trim();
  // Strip code fences if the model added them.
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Generate landing copy via Claude. Returns null if unconfigured or on error. */
export async function generateLandingCopy({ show, episode, log = () => {} } = {}) {
  if (!KEY || !episode) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1100,
        temperature: 0.7,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt({ show, episode }) }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      log(`ai: copy gen HTTP ${res.status}`);
      return null;
    }
    const data = await res.json().catch(() => null);
    const text = data?.content?.map?.((b) => b.text || '').join('') || '';
    const parsed = parseJson(text);
    if (!parsed || !parsed.headline) return null;
    return {
      headline: String(parsed.headline).trim().slice(0, 200),
      subhead: String(parsed.subhead || '').trim().slice(0, 300),
      body_html: String(parsed.body_html || '').trim(),
    };
  } catch (e) {
    log(`ai: copy gen failed — ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-show SEO meta descriptions. There are dozens of shows; a unique,
// keyword-aware ~155-char description per show meaningfully lifts search CTR
// and gives AI assistants a clean summary of each show. Generated once and
// stored (shows.seo_description); regenerated only when missing.
// ---------------------------------------------------------------------------
const META_SYSTEM = `You write SEO meta descriptions for podcast show pages on Straw Hut Media, a full-service podcast production company and network.
Write ONE meta description, 140-160 characters, plain text (no quotes, no emojis, no hashtags).
It must: describe what THIS show is about, name the host if given, read naturally to a human, and include the words "podcast" and, where it fits, "Straw Hut Media".
Never use "listen free", "tune in", clickbait, or exclamation points.`;

const BLURB_SYSTEM = `You write short display copy for a podcast network's website.

You are given a show's own description, written and approved by its team. Your job
is ONLY to shorten it so it fits a small space — never to reinvent it.

Rules:
- 1 to 2 COMPLETE sentences. It must end on a full stop, question mark or
  exclamation mark. Never end mid-thought.
- NEVER use an ellipsis (…  or ...). Not at the end, not anywhere.
- Stay under the character limit you are given. This is a hard limit.
- Keep the show's own voice, claims and names. Do not invent hosts, guests,
  awards, numbers or anything not present in the source.
- No marketing filler ("dive in", "join us as we"), no hashtags, no URLs,
  no "on this podcast" throat-clearing. Get to what the show actually is.
- Plain text only. Return ONLY the copy, nothing else.`;

/**
 * Shorten a show's own description into display copy that fits, as complete
 * sentences. Used when the team's copy has no sentence break inside the space
 * available, so trimming it would otherwise leave a fragment.
 */
export async function generateShowBlurb({ show, max = 165, log = () => {} } = {}) {
  if (!KEY || !show) return null;
  const desc = toText(show.description, 900);
  if (!desc) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        temperature: 0.3,
        system: BLURB_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Shorten this to at most ${max} characters, as 1-2 complete sentences.\n\nSHOW: ${show.title || ''}\nHOST: ${show.author || ''}\nDESCRIPTION: ${desc}`,
          },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) { log(`ai: blurb HTTP ${res.status}`); return null; }
    const data = await res.json().catch(() => null);
    let text = data?.content?.map?.((b) => b.text || '').join('').trim() || '';
    text = text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').replace(/\s*(?:\u2026|\.\.\.)\s*$/, '');
    // Only accept output that actually satisfies the brief — otherwise the
    // caller keeps the team's own copy rather than shipping worse text.
    if (!text || text.length > max || !endsSentence(text)) {
      log(`ai: blurb rejected for ${show.slug} (len ${text.length}, ends "${text.slice(-12)}")`);
      return null;
    }
    return text;
  } catch (e) {
    log(`ai: blurb failed — ${e.message}`);
    return null;
  }
}

export async function generateShowMetaDescription({ show, log = () => {} } = {}) {
  if (!KEY || !show) return null;
  const title = show.title || '';
  const host = show.author || '';
  const desc = toText(show.description, 700);
  const cats = Array.isArray(show.categories) ? show.categories.slice(0, 4).join(', ') : '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        temperature: 0.5,
        system: META_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Write the meta description. Return ONLY the description text, nothing else.\n\nSHOW: ${title}\nHOST: ${host}\nCATEGORIES: ${cats}\nDESCRIPTION: ${desc}`,
          },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      log(`ai: meta gen HTTP ${res.status}`);
      return null;
    }
    const data = await res.json().catch(() => null);
    let text = data?.content?.map?.((b) => b.text || '').join('').trim() || '';
    text = text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ');
    if (!text) return null;
    return text.slice(0, 200);
  } catch (e) {
    log(`ai: meta gen failed — ${e.message}`);
    return null;
  }
}

/** Non-AI fallback: decent, non-cheesy copy pulled straight from the materials. */
export function fallbackLandingCopy({ show, episode } = {}) {
  const epTitle = episode?.title || show?.title || 'Listen now';
  const desc = toText(episode?.description, 400);
  // First substantial sentence makes a fine subhead.
  const sentence = (desc.match(/[^.!?]{25,180}[.!?]/) || [])[0];
  const subhead = sentence
    ? sentence.trim()
    : show?.title
      ? `A new episode of ${show.title}.`
      : '';
  const body = episode?.description || '';
  return { headline: epTitle, subhead, body_html: body };
}

/** Best available copy: AI if configured, else the heuristic fallback. */
export async function writeLandingCopy({ show, episode, log = () => {} } = {}) {
  const ai = await generateLandingCopy({ show, episode, log });
  return ai || fallbackLandingCopy({ show, episode });
}
