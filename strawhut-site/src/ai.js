// AI copywriting — reads a show + episode's materials and writes the landing
// page copy (headline, subhead, body), optimized for the two goals (press play,
// then subscribe) and for SEO. Uses the Anthropic Messages API via fetch (no
// SDK dependency), the same ANTHROPIC_API_KEY as Podbooster / Slate.
//
//   ANTHROPIC_API_KEY   (required for AI copy; falls back to a heuristic if unset)
//   LANDING_COPY_MODEL  (optional, default claude-sonnet-4-6)

import { toText } from './util.js';

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
