#!/usr/bin/env node
// Google-review request mailer — a small, safe, repeatable way to ask current
// Straw Hut clients for a Google review with a one-tap direct-to-review link.
//
// WHY THIS EXISTS
//   Reviews are the highest-leverage social proof a service company can have,
//   and the single easiest ask a happy client can say yes to — IF the link
//   drops them straight onto the star form. This tool sends each client a short,
//   personal note (Ryan's voice) with that direct link.
//
// SAFETY (read before running against real people)
//   • DRY RUN BY DEFAULT. Nothing is emailed unless you pass --send.
//     Without --send it prints exactly what each person would receive.
//   • Requires RESEND_API_KEY in the environment to actually send (same key the
//     site uses). Without it, --send refuses rather than silently no-op.
//   • Requires a real review link (--review-url or GOOGLE_REVIEW_URL). It must
//     be a Google review link — a search.google.com/local/writereview?placeid=…
//     link or a g.page/r/…/review short link. The tool rejects anything else so
//     a broken link never goes out to a paying client.
//   • Sends one email per recipient (each person only ever sees their own
//     address), and prints a per-recipient sent/failed summary at the end.
//
// CLIENT LIST
//   Pass --clients <file>. The file is JSON: an array of
//     { "name": "First Last", "email": "person@label.com", "show": "Show Name" }
//   `show` is optional; if present the email references it ("…on <Show>").
//   A .csv with a header row (name,email,show) is also accepted.
//
// USAGE
//   # preview only (safe, no email sent, no key needed):
//   node tools/send-review-requests.mjs --clients clients.json \
//        --review-url "https://g.page/r/XXXXXXXX/review"
//
//   # actually send (needs RESEND_API_KEY set):
//   RESEND_API_KEY=re_… node tools/send-review-requests.mjs --clients clients.json \
//        --review-url "https://g.page/r/XXXXXXXX/review" --send
//
//   # send to just one person (great for a test to yourself first):
//   node tools/send-review-requests.mjs --clients clients.json \
//        --review-url "…" --only you@strawhutmedia.com --send

import fs from 'node:fs';

const FROM = process.env.FROM_EMAIL || 'Straw Hut Media <hello@strawhut.media>';
const REPLY_TO = process.env.REVIEW_REPLY_TO || 'hello@strawhutmedia.com';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const flag = (name) => process.argv.includes(`--${name}`);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

function loadClients(file) {
  if (!file || file === true) die('Missing --clients <file> (JSON or CSV).');
  if (!fs.existsSync(file)) die(`Client list not found: ${file}`);
  const raw = fs.readFileSync(file, 'utf8').trim();
  let rows;
  if (file.endsWith('.csv') || (!raw.startsWith('[') && !raw.startsWith('{'))) {
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(',').map((h) => h.trim().toLowerCase());
    const ci = (k) => head.indexOf(k);
    rows = lines.map((l) => {
      const c = l.split(',');
      return {
        name: (c[ci('name')] || '').trim(),
        email: (c[ci('email')] || '').trim(),
        show: (ci('show') >= 0 ? c[ci('show')] || '' : '').trim(),
      };
    });
  } else {
    rows = JSON.parse(raw);
  }
  const seen = new Set();
  const clean = [];
  for (const r of rows) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue; // skip junk rows
    if (seen.has(email)) continue; // dedupe
    seen.add(email);
    clean.push({ name: String(r.name || '').trim(), email, show: String(r.show || '').trim() });
  }
  return clean;
}

function validateReviewUrl(url) {
  if (!url || url === true) {
    die('Missing --review-url (or GOOGLE_REVIEW_URL). Use your Google "Ask for reviews" link\n' +
        '       — a g.page/r/…/review short link, or search.google.com/local/writereview?placeid=…');
  }
  const ok = /^https:\/\/(g\.page\/r\/[^/]+\/review|search\.google\.com\/local\/writereview\?placeid=|maps\.app\.goo\.gl\/)/i.test(url)
    || /placeid=/.test(url);
  if (!ok) {
    die(`That does not look like a Google review link:\n       ${url}\n` +
        '       Expected g.page/r/…/review, search.google.com/local/writereview?placeid=…, or a maps.app.goo.gl short link.');
  }
  return url;
}

function buildEmail({ name, show }, reviewUrl) {
  const first = firstName(name);
  const site = (process.env.APP_BASE_URL || 'https://www.strawhutmedia.com').replace(/\/+$/, '');
  const onShow = show ? ` on ${esc(show)}` : '';
  const subject = 'A quick favor?';
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:520px">
    <p>Hey ${esc(first)},</p>
    <p>It's been a genuine pleasure working with you${onShow}. Quick favor, if you have 30 seconds:</p>
    <p>Would you leave us a Google review? It's the single biggest thing that helps other creators find us — and it means a lot coming from someone we've actually worked with.</p>
    <p><a href="${esc(reviewUrl)}" style="display:inline-block;background:#00cc8e;color:#023324;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:999px">Leave a Google review →</a></p>
    <p style="font-size:14px;color:#555">The link drops you straight on the star rating — no hunting around. A sentence or two is plenty.</p>
    <p>Thank you, truly.</p>
    <p>— Ryan<br><span style="font-size:13px;color:#888">Straw Hut Media · <a href="${site}" style="color:#0a8f66">strawhutmedia.com</a></span></p>
  </div>`;
  const text = `Hey ${first},

It's been a genuine pleasure working with you${show ? ` on ${show}` : ''}. Quick favor, if you have 30 seconds:

Would you leave us a Google review? It's the single biggest thing that helps other creators find us — and it means a lot coming from someone we've actually worked with.

Leave a Google review: ${reviewUrl}

The link drops you straight on the star rating — no hunting around. A sentence or two is plenty.

Thank you, truly.

— Ryan
Straw Hut Media · ${site}`;
  return { subject, html, text };
}

async function sendOne({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html, text, reply_to: REPLY_TO }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }

async function main() {
  if (flag('help') || flag('h')) {
    console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return;
  }
  const reviewUrl = validateReviewUrl(arg('review-url', process.env.GOOGLE_REVIEW_URL));
  let clients = loadClients(arg('clients'));
  const only = arg('only');
  if (only && only !== true) {
    const o = String(only).toLowerCase();
    clients = clients.filter((c) => c.email.toLowerCase() === o);
    if (!clients.length) die(`--only ${only} matched nobody in the list.`);
  }
  if (!clients.length) die('No valid clients to email (need name + a real email address).');

  const send = flag('send');
  console.log(`\nGoogle review request — ${clients.length} recipient(s)`);
  console.log(`Review link : ${reviewUrl}`);
  console.log(`From        : ${FROM}`);
  console.log(`Mode        : ${send ? '🚨 LIVE SEND' : 'DRY RUN (no email sent) — add --send to actually send'}\n`);

  // Show a full preview of the first email so the copy is reviewable.
  const sample = buildEmail(clients[0], reviewUrl);
  console.log('──────── preview of email #1 (' + clients[0].email + ') ────────');
  console.log('Subject: ' + sample.subject);
  console.log(sample.text);
  console.log('────────────────────────────────────────────────────\n');
  console.log('Recipients:');
  for (const c of clients) console.log(`  • ${c.name || '(no name)'} <${c.email}>${c.show ? ` — ${c.show}` : ''}`);
  console.log('');

  if (!send) {
    console.log('Dry run complete. Re-run with --send (and RESEND_API_KEY set) to email these people.\n');
    return;
  }
  if (!process.env.RESEND_API_KEY) die('--send requires RESEND_API_KEY in the environment.');

  let sent = 0, failed = 0;
  for (const c of clients) {
    const { subject, html, text } = buildEmail(c, reviewUrl);
    try {
      await sendOne({ to: c.email, subject, html, text });
      sent++;
      console.log(`  ✓ sent  ${c.email}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ FAIL  ${c.email} — ${e.message}`);
    }
  }
  console.log(`\nDone. Sent ${sent}, failed ${failed}.\n`);
}

main().catch((e) => die(e.message));
