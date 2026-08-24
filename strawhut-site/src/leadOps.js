// Lead operations that run on the always-on server (not a chat session):
//   1. Pre-call PREP — ~15 min before each booked call, email Ryan a briefing:
//      who the person is, what they want, budget/qualification verdict, likely
//      points of confusion, and a few sharp questions to ask.
//   2. FOLLOW-UP — ~90 min after a call, email Ryan a short follow-up DRAFT in
//      his own voice to review and send (he/Caroline send it, never the server).
//
// Bookings are recorded from the /hooks/leads webhook (Appointlet carries the
// call time + questionnaire). State lives in the app_state KV blob 'lead_bookings'
// keyed by email, so there's no schema change. Everything is inert unless both
// RESEND_API_KEY and ANTHROPIC_API_KEY are set; LEAD_OPS=off disables it.

import { sendOwnerEmail, mailConfigured } from './mail.js';

const KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = (process.env.LEAD_OPS_MODEL || process.env.LANDING_COPY_MODEL || 'claude-sonnet-4-6').trim();
const OWNER = (process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com').trim();
const STATE_KEY = 'lead_bookings';

const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- storage (single KV blob keyed by email) -------------------------------
async function load(store) {
  try { return JSON.parse((await store.getState(STATE_KEY)) || '{}') || {}; }
  catch { return {}; }
}
async function save(store, map) {
  // Keep the blob bounded — only the most recent ~200 bookings matter.
  const entries = Object.entries(map).sort((a, b) => String(b[1].recordedAt || '').localeCompare(String(a[1].recordedAt || ''))).slice(0, 200);
  await store.setState(STATE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

// "Tue, Sept. 1, 2026 3:00 p.m. - 3:15 p.m." (America/Los_Angeles) -> ISO UTC.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function parsePtDateTime(text) {
  if (!text) return null;
  const m = String(text).match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),\s+(\d{4})[^0-9]+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)/i);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (mon < 0) return null;
  const day = +m[2], year = +m[3];
  let hour = +m[4]; const min = +m[5];
  const pm = /p/i.test(m[6]);
  if (pm && hour !== 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  const wallMs = Date.UTC(year, mon, day, hour, min);
  // PT offset (DST-aware) for that instant, e.g. "GMT-7".
  let offMin = -420;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(new Date(wallMs));
    const nm = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-7';
    const mm = nm.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (mm) { const h = +mm[1]; offMin = h * 60 + (h < 0 ? -(+(mm[2] || 0)) : +(mm[2] || 0)); }
  } catch { /* keep default */ }
  return new Date(wallMs - offMin * 60000).toISOString();
}

// Called by the /hooks/leads webhook for each parsed booking. Merges into the
// blob, preserving any prep/follow-up already sent for that person.
export async function recordBooking(store, b = {}) {
  if (!store || !b.email) return;
  const email = String(b.email).toLowerCase();
  const map = await load(store);
  const prev = map[email] || {};
  const callAt = b.callAtText ? parsePtDateTime(b.callAtText) : (prev.callAt || null);
  map[email] = {
    ...prev,
    email,
    name: b.name || prev.name || '',
    company: b.company || prev.company || '',
    spend: b.spend || prev.spend || '',
    status: b.status || prev.status || '',
    goals: b.goals || prev.goals || '',
    qual: b.qual || prev.qual || '',
    summary: b.summary || prev.summary || '',
    source: b.source || prev.source || '',
    callAt,
    // If the call time moved, allow prep/follow-up to fire again for the new time.
    prepSentAt: callAt && prev.callAt && callAt !== prev.callAt ? null : prev.prepSentAt || null,
    followupSentAt: callAt && prev.callAt && callAt !== prev.callAt ? null : prev.followupSentAt || null,
    recordedAt: new Date().toISOString(),
  };
  await save(store, map);
}

// --- Claude ----------------------------------------------------------------
async function claude(system, user, maxTokens = 700) {
  if (!KEY) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: 0.4, system, messages: [{ role: 'user', content: user }] }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) { console.error('[leadops] claude HTTP', res.status); return null; }
    const data = await res.json().catch(() => null);
    return (data?.content?.map?.((b) => b.text || '').join('') || '').trim() || null;
  } catch (e) { console.error('[leadops] claude error:', e.message); return null; }
}

const VERDICT = (qual) =>
  qual === 'unqualified-under-1k' ? '🔴 UNDER $1k/mo — not a qualified lead by your rule'
  : qual === 'needs-qualification' ? '🟡 Spend unconfirmed — qualify early in the call'
  : '🟢 Clears the $1k/mo bar';

const BRIEF_SYSTEM = `You brief Ryan, founder of Straw Hut Media (a full-service podcast production company + network), right before a discovery call. Be blunt, concrete, and short. No fluff, no hype, no restating the obvious. Plain sentences. You are given only the booking data — do not invent facts about the person or company you weren't given.`;

function briefUser(b) {
  return `Write a tight pre-call briefing. Use these exact short sections, each 1–2 lines:
WHO: name, company, role if known.
WHAT THEY WANT: infer from their stated goals + status, honestly.
MONEY: their marketing spend and what it implies.
WATCH FOR: the most likely confusion or mismatch (e.g. they may just want to be a guest, not pay for production).
ASK: 2 sharp questions Ryan should open with.

BOOKING DATA
Name: ${b.name || '—'}
Company: ${b.company || '—'}
Marketing spend: ${b.spend || 'unknown'}
Podcast status: ${b.status || 'unknown'}
Goals: ${b.goals || 'unknown'}
Source: ${b.source || '—'}
${b.summary ? `Outreach summary: ${b.summary}` : ''}`;
}

const VOICE_SYSTEM = `You draft a short follow-up email AS Ryan, founder of Straw Hut Media, to send after a discovery call. Ryan's voice: warm, plain, human — like a friend, never corporate or salesy. Three beats: (1) genuine warmth about the conversation, (2) a direct, sincere "I'd love to work with you", (3) a soft open door with zero pressure ("Let me know if it's something we can make happen"). NEVER use: "founder to founder", "for a brand like", "circle back", "synergy", "the opportunity is", package-pushing, urgency, fake enthusiasm, emoji spam. Short. Say the real thing and stop. Output ONLY the email body (no subject line, no signature block beyond "— Ryan").`;

function followUser(b) {
  return `Draft the follow-up email body to ${b.name || 'the prospect'}${b.company ? ` at ${b.company}` : ''} after our discovery call about ${b.goals ? `their goals (${b.goals})` : 'their podcast'}. Keep it to 4–6 short sentences. This is a DRAFT for Ryan to review and send — write it as him.`;
}

// --- sweeps ----------------------------------------------------------------
function within(callAtIso, lowMin, highMin, now) {
  if (!callAtIso) return false;
  const diff = (new Date(callAtIso).getTime() - now) / 60000; // minutes until call (negative = past)
  return diff <= highMin && diff >= lowMin;
}

async function runSweeps(store) {
  if (process.env.LEAD_OPS === 'off' || !mailConfigured() || !KEY) return;
  const map = await load(store);
  const now = Date.now();
  let changed = false;

  for (const b of Object.values(map)) {
    // PREP: fire once when the call is 0–20 min away (allow a 5-min grace if a tick was missed).
    if (b.callAt && !b.prepSentAt && within(b.callAt, -5, 20, now)) {
      const brief = await claude(BRIEF_SYSTEM, briefUser(b), 600);
      const when = new Date(b.callAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#12182f">
        <p style="margin:0 0 4px"><strong>Call prep — ${esc(b.name || 'lead')}${b.company ? `, ${esc(b.company)}` : ''}</strong></p>
        <p style="margin:0 0 12px;color:#555">${esc(when)} PT · <strong>${esc(VERDICT(b.qual))}</strong></p>
        <div style="white-space:pre-wrap;background:#f5f7fb;border-radius:10px;padding:14px 16px">${esc(brief || 'Spend: ' + (b.spend || '?') + '\nGoals: ' + (b.goals || '?') + '\nStatus: ' + (b.status || '?'))}</div>
        <p style="margin:14px 0 0;font-size:13px;color:#888">Auto-sent ~15 min before the call · Straw Hut lead ops</p>
      </div>`;
      const r = await sendOwnerEmail({ to: OWNER, subject: `Call prep — ${b.name || 'lead'}${b.company ? ` (${b.company})` : ''} · ${b.qual === 'unqualified-under-1k' ? '🔴' : '🟢'}`, html });
      if (r.ok) { b.prepSentAt = new Date().toISOString(); changed = true; console.log('[leadops] prep sent for', b.email); }
    }

    // FOLLOW-UP: ~90 min to 24h after the call, for qualified/borderline leads only.
    if (b.callAt && !b.followupSentAt && b.qual !== 'unqualified-under-1k' && within(b.callAt, -1440, -90, now)) {
      const draft = await claude(VOICE_SYSTEM, followUser(b), 500);
      if (draft) {
        const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#12182f">
          <p style="margin:0 0 4px"><strong>Follow-up draft — ${esc(b.name || 'lead')}${b.company ? `, ${esc(b.company)}` : ''}</strong></p>
          <p style="margin:0 0 12px;color:#555">In your voice — review, tweak, and send (you or Caroline). Not sent to them.</p>
          <div style="white-space:pre-wrap;background:#eefaf4;border:1px solid rgba(0,204,142,0.35);border-radius:10px;padding:14px 16px">${esc(draft)}</div>
          <p style="margin:14px 0 0;font-size:13px;color:#888">Their email: ${esc(b.email)} · Straw Hut lead ops</p>
        </div>`;
        const r = await sendOwnerEmail({ to: OWNER, subject: `Follow-up draft — ${b.name || 'lead'}${b.company ? ` (${b.company})` : ''}`, html });
        if (r.ok) { b.followupSentAt = new Date().toISOString(); changed = true; console.log('[leadops] follow-up draft sent for', b.email); }
      }
    }
  }
  if (changed) await save(store, map);
}

// Start the background loop. Safe to call always — no-ops unless configured.
export function startLeadOps(store) {
  if (process.env.LEAD_OPS === 'off') { console.log('[leadops] disabled (LEAD_OPS=off)'); return; }
  if (!mailConfigured() || !KEY) { console.log('[leadops] inert (needs RESEND_API_KEY + ANTHROPIC_API_KEY)'); return; }
  console.log('[leadops] pre-call prep + follow-up loop active (every 5 min)');
  const tick = () => runSweeps(store).catch((e) => console.error('[leadops] sweep failed:', e.message));
  setTimeout(tick, 30000);            // first pass shortly after boot
  setInterval(tick, 5 * 60 * 1000);   // then every 5 minutes
}
