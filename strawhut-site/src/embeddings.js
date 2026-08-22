// Local semantic embeddings — runs a small open-source model IN-PROCESS.
// No external API, no key, no per-call cost. Used to power accurate
// "you might also like" recommendations by meaning, not just genre.
//
// Model: all-MiniLM-L6-v2 (384-dim). ~30MB, downloaded once and cached.

import { toText } from './util.js';

let _extractor = null;
let _loading = null;

async function getExtractor() {
  if (_extractor) return _extractor;
  if (_loading) return _loading;
  _loading = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    // Cache the model under the app dir so it persists between boots where possible.
    env.cacheDir = process.env.TRANSFORMERS_CACHE || './.models';
    _extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    return _extractor;
  })();
  return _loading;
}

/** Embed a single string → normalized Float32 vector (as plain array). */
export async function embed(text) {
  const extractor = await getExtractor();
  const out = await extractor(text || ' ', { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

/** The text we embed for an episode — title carries the most signal, then notes. */
export function episodeText(show, episode) {
  return [
    show?.title,
    show?.categories?.join(' '),
    episode.title,
    toText(episode.description, 500),
  ]
    .filter(Boolean)
    .join('. ');
}

/** Cosine similarity of two normalized vectors. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
