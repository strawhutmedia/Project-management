// Straw Hut Media newsletter — a biweekly digest of new episodes across the
// network, plus soft CTAs (book a call, take the course). Cadence chosen by the
// owner: every other week.
//
// SAFETY: the scheduler NEVER emails subscribers. On its cadence it generates a
// draft and emails it to the OWNER for review; sending to the real list happens
// only when the owner clicks "Send to subscribers" in /admin/newsletter. The
// per-recipient unsubscribe link is injected by sendAnnouncement().

import { sendAnnouncement, sendOwnerEmail, mailConfigured } from './mail.js';
import { esc } from './util.js';

const BASE = (process.env.APP_BASE_URL || 'https://www.strawhutmedia.com').replace(/\/+$/, '');
const OWNER = process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com';
const EVERY_MS = 14 * 24 * 60 * 60 * 1000; // biweekly

function clip(s, n) {
  const t = String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// Build the issue content from real store data. Returns null if there's nothing
// worth sending (no episodes yet).
export async function buildIssue(store, { count = 6 } = {}) {
  const eps = (await store.recentEpisodes(count)) || [];
  if (!eps.length) return null;
  const featured = eps[0];

  const epCards = eps
    .map((e) => {
      const url = e.show_slug && e.slug ? `${BASE}/${esc(e.show_slug)}/${esc(e.slug)}` : BASE;
      const img = e.image_url || e.show_image || '';
      const thumb = img
        ? `<td width="84" valign="top" style="padding:0 14px 0 0">
             <a href="${url}"><img src="${esc(img)}" width="84" height="84" alt="" style="display:block;width:84px;height:84px;border-radius:12px;object-fit:cover"></a>
           </td>`
        : '';
      return `<tr><td style="padding:0 0 18px">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          ${thumb}
          <td valign="top">
            <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#00996b;font-weight:700">${esc(e.show_title || 'Straw Hut Media')}</div>
            <a href="${url}" style="color:#12182f;font-weight:700;font-size:16px;text-decoration:none;line-height:1.35">${esc(clip(e.title, 90))}</a>
            ${e.description ? `<div style="color:#5a6270;font-size:14px;line-height:1.5;margin-top:4px">${esc(clip(e.description, 130))}</div>` : ''}
            <a href="${url}" style="display:inline-block;margin-top:8px;color:#00996b;font-weight:600;font-size:14px;text-decoration:none">Listen →</a>
          </td>
        </tr></table>
      </td></tr>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f6;padding:0">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">New episodes across the Straw Hut Media network.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef1f6;padding:24px 0">
   <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:92vw;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
      <!-- header -->
      <tr><td style="background:#12182f;padding:26px 30px">
        <div style="color:#f2f3f8;font-weight:800;letter-spacing:.16em;font-size:15px">STRAW HUT MEDIA</div>
        <div style="color:#9aa2c0;font-size:13px;margin-top:4px">New shows, new episodes, and behind-the-scenes.</div>
      </td></tr>
      <!-- intro -->
      <tr><td style="padding:26px 30px 6px">
        <h1 style="margin:0 0 8px;color:#12182f;font-size:22px;line-height:1.3">Fresh from across the network</h1>
        <p style="margin:0;color:#5a6270;font-size:15px;line-height:1.6">Here's what's new from the Straw Hut Media shows — hit play on anything that catches your eye.</p>
      </td></tr>
      <!-- episodes -->
      <tr><td style="padding:22px 30px 4px">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${epCards}</table>
      </td></tr>
      <!-- CTA band -->
      <tr><td style="padding:8px 30px 30px">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fb;border:1px solid #e2e7f0;border-radius:14px">
          <tr><td style="padding:22px 24px">
            <div style="color:#12182f;font-weight:700;font-size:17px;margin-bottom:6px">Thinking about your own show?</div>
            <div style="color:#5a6270;font-size:14px;line-height:1.55;margin-bottom:14px">We produce, launch, and grow podcasts end to end — or teach you to do it yourself.</div>
            <a href="${BASE}/book" style="display:inline-block;background:#00cc8e;color:#023324;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px">Book a 15-min call</a>
            &nbsp;
            <a href="${BASE}/podcast-primer" style="display:inline-block;color:#00996b;font-weight:600;text-decoration:none;padding:11px 6px;font-size:14px">Take the course →</a>
          </td></tr>
        </table>
      </td></tr>
      <!-- footer -->
      <tr><td style="padding:0 30px 28px">
        <hr style="border:none;border-top:1px solid #e2e7f0;margin:0 0 16px">
        <div style="color:#9aa2c0;font-size:12px;line-height:1.6">
          Straw Hut Media — full-service podcast production &amp; network, Hollywood, CA.<br>
          You're getting this because you subscribed at <a href="${BASE}" style="color:#00996b;text-decoration:none">strawhutmedia.com</a>.
          <a href="{{unsubscribe}}" style="color:#9aa2c0;text-decoration:underline">Unsubscribe</a>.
        </div>
      </td></tr>
    </table>
   </td></tr>
  </table>
  </body></html>`;

  const text =
    `Fresh from across the Straw Hut Media network:\n\n` +
    eps.map((e) => `• ${e.show_title || 'Straw Hut Media'} — ${clip(e.title, 90)}\n  ${e.show_slug && e.slug ? `${BASE}/${e.show_slug}/${e.slug}` : BASE}`).join('\n\n') +
    `\n\nThinking about your own show? Book a 15-min call: ${BASE}/book\nTake the course: ${BASE}/podcast-primer\n\nUnsubscribe: {{unsubscribe}}`;

  const subject = `Straw Hut Media — new from ${clip(featured.show_title || 'the network', 40)}${eps.length > 1 ? ` + ${eps.length - 1} more` : ''}`;
  return { subject, html, text, count: eps.length };
}

// Email the DRAFT to the owner for review. Never touches the subscriber list.
export async function sendDraftToOwner(store) {
  if (!mailConfigured()) return { ok: false, reason: 'no RESEND_API_KEY' };
  const issue = await buildIssue(store);
  if (!issue) return { ok: false, reason: 'no episodes to feature yet' };
  const subs = await store.listSubscribers();
  const banner = `<div style="font-family:-apple-system,Segoe UI,sans-serif;background:#fff4d6;color:#7a5b00;padding:12px 16px;font-size:14px;line-height:1.5">
    <strong>DRAFT — review before sending.</strong> This is the biweekly Straw Hut newsletter draft. It has <strong>not</strong> gone to anyone.
    You currently have <strong>${subs.length}</strong> subscriber${subs.length === 1 ? '' : 's'}. To send it, open
    <a href="${BASE}/admin/newsletter" style="color:#0a7f5c">${BASE}/admin/newsletter</a> and click “Send to subscribers.”
  </div>`;
  const r = await sendOwnerEmail({ to: OWNER, subject: `[DRAFT] ${issue.subject}`, html: banner + issue.html });
  if (r.ok) await store.setState('newsletter_draft_at', new Date().toISOString());
  return { ok: r.ok, subscriberCount: subs.length, subject: issue.subject };
}

// Actually send to the subscriber list (owner-triggered only).
export async function sendToSubscribers(store) {
  if (!mailConfigured()) return { ok: false, sent: 0, reason: 'no RESEND_API_KEY' };
  const issue = await buildIssue(store);
  if (!issue) return { ok: false, sent: 0, reason: 'no episodes to feature yet' };
  const subs = await store.listSubscribers();
  if (!subs.length) return { ok: false, sent: 0, reason: 'no subscribers yet' };
  const r = await sendAnnouncement(subs, { subject: issue.subject, html: issue.html });
  await store.setState('newsletter_sent_at', new Date().toISOString());
  return { ok: true, ...r, subject: issue.subject };
}

// Send a single test copy to the owner (with a real unsubscribe link resolved).
export async function sendTestToOwner(store) {
  if (!mailConfigured()) return { ok: false, reason: 'no RESEND_API_KEY' };
  const issue = await buildIssue(store);
  if (!issue) return { ok: false, reason: 'no episodes to feature yet' };
  const html = issue.html.replace(/\{\{unsubscribe\}\}/g, `${BASE}/unsubscribe?e=${encodeURIComponent(OWNER)}`);
  return sendOwnerEmail({ to: OWNER, subject: `[TEST] ${issue.subject}`, html });
}

// Scheduler: on the biweekly cadence, email the owner a fresh draft. Never
// emails subscribers. Safe to call on boot + on an interval; it self-throttles.
export async function maybeSendNewsletterDraft(store, { force = false } = {}) {
  if (!mailConfigured()) return { ok: false, reason: 'no RESEND_API_KEY' };
  const last = await store.getState('newsletter_draft_at');
  if (!force && last && Date.now() - new Date(last).getTime() < EVERY_MS) {
    return { ok: false, skipped: 'not due yet' };
  }
  return sendDraftToOwner(store);
}
