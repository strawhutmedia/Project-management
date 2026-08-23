// GoHighLevel — push website enquiries into the CRM.
//
// Rules this module holds to:
//
//  1. ADDITIVE, NEVER BLOCKING. The email to Ryan is the system of record. GHL
//     is a second destination. Every call is fire-and-forget with a timeout,
//     and a failure is logged, never thrown at the request — a CRM outage must
//     not cost a lead or show an error to a prospect.
//  2. INERT UNTIL CONFIGURED. No token or location id = the module does
//     nothing, same pattern as tracking and Turnstile.
//  3. WRITE ONLY WHAT WE WERE GIVEN. No deletes, no bulk operations.
//
// API: LeadConnector v2. Auth is a Private Integration Token.

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const TIMEOUT_MS = 10000;

const TOKEN = (process.env.GHL_API_TOKEN || '').trim();
const LOCATION_ID = (process.env.GHL_LOCATION_ID || '').trim();

export function ghlConfigured() {
  return Boolean(TOKEN && LOCATION_ID);
}

let _lastError = null;
export function ghlLastError() {
  return _lastError;
}

async function call(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Version: VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || text.slice(0, 160) || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: String(msg).slice(0, 200) };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-only credential check. Confirms the token authenticates and can see the
 * location, WITHOUT creating anything — so it can run on boot and be reported
 * in /healthz without polluting the CRM with test contacts.
 */
export async function verifyGhl() {
  if (!ghlConfigured()) return { ok: false, state: 'unconfigured' };
  const r = await call(`/locations/${encodeURIComponent(LOCATION_ID)}`);
  if (!r.ok) {
    _lastError = r.error;
    return { ok: false, state: 'error', error: r.error };
  }
  const name = r.data?.location?.name || r.data?.name || null;
  return { ok: true, state: 'ok', name };
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Create or update a contact, then attach the enquiry text as a note so the
 * CRM shows what they actually asked for. Returns { ok, id } and never throws.
 */
export async function upsertContact({ name, email, company, message, tags = [], source = 'strawhutmedia.com' } = {}) {
  if (!ghlConfigured() || !email) return { ok: false, state: 'skipped' };
  const { firstName, lastName } = splitName(name);
  const r = await call('/contacts/upsert', {
    method: 'POST',
    body: {
      locationId: LOCATION_ID,
      email: String(email).trim(),
      firstName,
      lastName,
      name: String(name || '').trim() || undefined,
      companyName: String(company || '').trim() || undefined,
      source,
      tags: tags.filter(Boolean),
    },
  });
  if (!r.ok) {
    _lastError = r.error;
    console.error('[ghl] upsert failed:', r.error);
    return { ok: false, error: r.error };
  }
  const id = r.data?.contact?.id || r.data?.id || null;

  // The message is the whole point of the lead — without it the CRM entry is
  // just an email address. Attached as a note; a failure here doesn't undo the
  // contact, which is the more important half.
  if (id && String(message || '').trim()) {
    const n = await call(`/contacts/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: { body: String(message).slice(0, 5000), userId: undefined },
    });
    if (!n.ok) console.error('[ghl] note failed:', n.error);
  }
  return { ok: true, id };
}

// ---- Booking calendar discovery -------------------------------------------
//
// The /book page needs the GHL calendar's embed URL. Rather than making a
// human copy it out of the GHL UI and paste it into an env var — a step that
// silently rots the day the calendar is renamed or replaced — the server asks
// GHL for it with the token it already holds. BOOKING_WIDGET_URL still wins if
// it is set, so a deliberate override is always available.

const WIDGET_BASE = 'https://api.leadconnectorhq.com/widget/booking';

// A location usually has several calendars (per-team-member, round robin,
// event types). We want the short new-business fit call.
const FIT_RE = /(15[\s-]*min|fit\s*call|discovery|intro(?!duction to)|consult|strategy)/i;
// Never auto-pick something that is obviously not for prospects.
const AVOID_RE = /(guest|internal|test|personal|interview|recording|studio\s*session)/i;

export async function listCalendars() {
  if (!ghlConfigured()) return { ok: false, state: 'unconfigured' };
  const r = await call(`/calendars/?locationId=${encodeURIComponent(LOCATION_ID)}`);
  if (!r.ok) {
    _lastError = r.error;
    return { ok: false, error: r.error, status: r.status };
  }
  const list = Array.isArray(r.data?.calendars) ? r.data.calendars
    : Array.isArray(r.data) ? r.data
    : [];
  return { ok: true, calendars: list };
}

/** Highest-scoring active calendar, or null. Exported so it can be reasoned
 *  about (and tested) without a live API call. */
export function pickBookingCalendar(calendars = []) {
  const active = calendars.filter((c) => c && c.id && c.isActive !== false);
  if (!active.length) return null;
  const scored = active.map((c) => {
    const name = String(c.name || '');
    let s = 0;
    if (FIT_RE.test(name)) s += 10;
    if (Number(c.slotDuration) === 15) s += 4;
    else if (Number(c.slotDuration) === 30) s += 2;
    if (AVOID_RE.test(name)) s -= 20;
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].s > -20 ? scored[0].c : null;
}

export function bookingWidgetUrl(calendar) {
  const id = calendar && calendar.id;
  return id ? `${WIDGET_BASE}/${encodeURIComponent(id)}` : '';
}

let _booking = { state: 'unresolved', url: '', name: '', id: '', source: '', error: '', options: [] };
export function ghlBookingState() { return _booking; }

/**
 * Resolve the calendar to embed on /book. Never throws; on any failure the
 * page falls back to its "get in touch" panel rather than an empty iframe.
 */
export async function resolveBookingCalendar() {
  const override = (process.env.BOOKING_WIDGET_URL || '').trim();
  if (override) {
    _booking = { state: 'ok', url: override, name: '', id: '', source: 'env', error: '', options: [] };
    return _booking;
  }
  if (!ghlConfigured()) {
    _booking = { ..._booking, state: 'unconfigured', url: '', source: '' };
    return _booking;
  }
  const r = await listCalendars();
  if (!r.ok) {
    _booking = { ..._booking, state: 'error', url: '', source: '', error: r.error || 'unknown' };
    console.error('[ghl] calendar lookup failed:', _booking.error);
    return _booking;
  }
  // Every active calendar, so a wrong auto-pick is diagnosable from /healthz
  // instead of requiring another deploy to find out what was on offer.
  const options = r.calendars
    .filter((c) => c && c.id && c.isActive !== false)
    .map((c) => ({ id: c.id, name: c.name || '(unnamed)', minutes: c.slotDuration ?? null }));
  const pick = pickBookingCalendar(r.calendars);
  if (!pick) {
    _booking = { state: 'none', url: '', name: '', id: '', source: '', error: 'no suitable active calendar', options };
    console.error('[ghl] no bookable calendar among', options.length, 'active');
    return _booking;
  }
  _booking = {
    state: 'ok',
    url: bookingWidgetUrl(pick),
    name: pick.name || '',
    id: pick.id,
    source: 'ghl',
    error: '',
    options,
  };
  console.log(`[ghl] booking calendar: ${_booking.name} (${_booking.id})`);
  return _booking;
}
