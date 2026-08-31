// Automatic newsletter-list maintenance.
//
// The subscriber list is the site's own `subscribers` table. It fills itself
// from two automatic sources so nobody ever hand-imports a list:
//
//   1. The website subscribe form  → store.addSubscriber (see /subscribe).
//   2. A Google Sheet the owner keeps → polled here on a schedule.
//
// The Google Sheet is the owner's working master (e.g. exported from GHL /
// ManyChat). Publish it to the web as CSV (File → Share → Publish to web →
// pick the tab → CSV) and set the resulting URL as NEWSLETTER_SHEET_CSV_URL.
// We poll it, find the email + name columns by header, and UPSERT — we never
// delete on absence, so an unsubscribe (which removes the row) is never undone
// by a stale sheet.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped double-quotes, and \r\n. Returns an array of string arrays.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      // ignore; \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Pull the owner's Google Sheet (published CSV) and upsert any new subscribers.
 * Never removes anyone. Safe to call on boot and on an interval.
 * @returns {{ ok, seen?, added?, reason? }}
 */
export async function syncFromSheet(store, url = process.env.NEWSLETTER_SHEET_CSV_URL) {
  if (!url) return { ok: false, reason: 'no NEWSLETTER_SHEET_CSV_URL set' };
  let text;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim()));
  if (!rows.length) return { ok: true, seen: 0, added: 0 };

  // Locate columns from the header row.
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  let emailIdx = header.findIndex((h) => h === 'email' || h.includes('email'));
  let firstIdx = header.findIndex((h) => h === 'first_name' || h === 'first name' || h === 'first');
  let lastIdx = header.findIndex((h) => h === 'last_name' || h === 'last name' || h === 'last');
  let nameIdx = header.findIndex((h) => h === 'name' || h === 'full name' || h === 'full_name');
  let dataStart = 1;
  // If there's no header (first row already looks like an email), scan column 0.
  if (emailIdx === -1 && EMAIL_RE.test(String(rows[0][0]).trim())) {
    emailIdx = 0; dataStart = 0;
  }
  if (emailIdx === -1) return { ok: false, reason: 'no email column found in sheet' };

  let seen = 0, added = 0;
  const existing = new Set((await store.listSubscribers()).map((s) => s.email));
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    const email = String(r[emailIdx] || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    seen++;
    const name =
      nameIdx >= 0 && r[nameIdx]
        ? String(r[nameIdx]).trim()
        : [firstIdx >= 0 ? r[firstIdx] : '', lastIdx >= 0 ? r[lastIdx] : ''].filter(Boolean).join(' ').trim();
    if (existing.has(email)) continue;
    try { await store.addSubscriber(email, name); existing.add(email); added++; }
    catch { /* skip bad row */ }
  }
  return { ok: true, seen, added };
}

// Scheduler: poll the sheet hourly. Inert without NEWSLETTER_SHEET_CSV_URL.
export function startSubscriberSync(store, { intervalMs = 60 * 60 * 1000 } = {}) {
  if (!process.env.NEWSLETTER_SHEET_CSV_URL) return;
  const run = () =>
    syncFromSheet(store)
      .then((r) => { if (r.added) console.log(`[subscribers] sheet sync: +${r.added} new (of ${r.seen} seen)`); })
      .catch((e) => console.error('[subscribers] sheet sync error:', e.message));
  setTimeout(run, 15 * 1000); // shortly after boot
  setInterval(run, intervalMs);
}
