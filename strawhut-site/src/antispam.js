// First-party spam defence for public forms.
//
// Deliberately no CAPTCHA and no third-party service: those add friction for
// real prospects (and a new vendor). These checks are invisible to humans and
// stop the overwhelming majority of automated submissions, which are scripts
// POSTing directly or filling every field they can find.
//
// Anything that could plausibly be a real person is DELIVERED, not blocked —
// losing a genuine lead costs far more than receiving a spam email. Suspicious
// content is flagged in the subject so it can be filtered, never dropped.

import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'strawhut-forms';
const MIN_FILL_MS = 3000;        // no human completes a form in under 3s
const MAX_AGE_MS = 6 * 3600e3;   // token good for 6h, then the page is stale
export const HONEYPOT = 'website'; // bots fill anything that looks like a field

function sign(v) {
  return crypto.createHmac('sha256', SECRET).update(String(v)).digest('base64url').slice(0, 24);
}

/** Hidden fields to embed in a form: a signed timestamp plus a honeypot. */
export function formFields() {
  const ts = Date.now();
  return `<input type="hidden" name="_ts" value="${ts}">
<input type="hidden" name="_tk" value="${sign(ts)}">
<div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">
  <label>Website<input type="text" name="${HONEYPOT}" tabindex="-1" autocomplete="off" value=""></label>
</div>`;
}

/**
 * Decide what to do with a submission.
 * @returns {{ok:boolean, reason?:string, suspicious?:boolean, flags?:string[]}}
 */
export function inspect(body = {}, { ip = '' } = {}) {
  // 1. Honeypot — invisible to humans, irresistible to form-fillers.
  if (String(body[HONEYPOT] || '').trim()) return { ok: false, reason: 'honeypot' };

  // 2. Signed timestamp — proves the form was actually rendered by us, and
  //    that a human spent time on it. Blocks scripts POSTing the endpoint cold.
  const ts = Number(body._ts || 0);
  const tk = String(body._tk || '');
  if (!ts || !tk || tk !== sign(ts)) return { ok: false, reason: 'bad-token' };
  const age = Date.now() - ts;
  if (age < MIN_FILL_MS) return { ok: false, reason: 'too-fast' };
  if (age > MAX_AGE_MS) return { ok: false, reason: 'stale' };

  // 3. Rate limit per IP.
  if (!allow(ip)) return { ok: false, reason: 'rate-limited' };

  // 4. Content heuristics — FLAG ONLY. A real person occasionally writes
  //    something that trips these, so they must never block delivery.
  const flags = [];
  const name = String(body.name || '');
  const msg = String(body.message || '');
  if (/https?:\/\/|\[url=|<a\s/i.test(msg)) flags.push('links');
  if (looksRandom(name)) flags.push('random-name');
  if (msg.trim() && !/\s/.test(msg.trim()) && msg.trim().length > 12) flags.push('no-spaces');
  if (/\b(seo services|backlinks|crypto|casino|viagra|loan offer)\b/i.test(msg)) flags.push('keywords');
  return { ok: true, suspicious: flags.length >= 2, flags };
}

/** Heuristic for machine-generated strings like "XogfpHAiFLNaEwrRxfko". */
function looksRandom(s) {
  const t = String(s).trim();
  if (t.length < 10 || /\s/.test(t)) return false;      // real names have spaces
  const vowels = (t.match(/[aeiou]/gi) || []).length / t.length;
  const caseFlips = (t.match(/[a-z][A-Z]/g) || []).length;
  return vowels < 0.28 || caseFlips >= 4;               // unpronounceable or camel-noise
}

// --- simple in-memory rate limit (per process; fine for one web dyno) -------
const hits = new Map();
const WINDOW_MS = 3600e3;
const MAX_PER_WINDOW = 5;
function allow(ip) {
  if (!ip) return true;
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}
