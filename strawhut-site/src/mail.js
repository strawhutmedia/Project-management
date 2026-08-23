// Email sending via Resend's HTTP API (same provider as Slate / Pod Booster).
// No SDK dependency — just fetch. Requires RESEND_API_KEY at runtime.

// Sender must be a Resend-verified domain. strawhutmedia.com is NOT verified in
// this account; strawhut.media IS (and reads as "Straw Hut Media"). Mail is
// still delivered TO the .com inboxes; only the visible sender uses .media.
// Override with FROM_EMAIL if the verified sender ever changes.
const FROM = process.env.FROM_EMAIL || 'Straw Hut Media <hello@strawhut.media>';

export function mailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

async function sendOne({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Contact-form routing: each topic goes to the right inbox. Order = the order
// shown in the dropdown; the first entry is the default.
export const CONTACT_ROUTES = {
  general: { label: 'General inquiry', to: 'hello@strawhutmedia.com' },
  booking: { label: 'Get booked as a guest on a show', to: 'booking@strawhutmedia.com' },
  press: { label: 'Press / media', to: 'press@strawhutmedia.com' },
};

/**
 * Deliver a contact-form submission to the inbox for its topic, with reply-to
 * set to the sender so the recipient can just hit reply.
 */
/**
 * Instant acknowledgement to the PROSPECT, with a way to book immediately.
 *
 * Until this existed, someone who filled the contact form heard nothing at all
 * until a human happened to read the inbox. Speed of first response is the
 * single biggest lever on whether an enquiry turns into a client, and silence
 * is the worst possible first impression from a production company.
 *
 * Deliberately short and human — it is not a marketing email. Never throws:
 * failing to acknowledge must not fail the submission.
 */
export async function sendContactAutoReply({ name, email, topic, canBook = true }) {
  if (!process.env.RESEND_API_KEY || !email) return { ok: false, skipped: true };
  const site = (process.env.APP_BASE_URL || 'https://www.strawhutmedia.com').replace(/\/+$/, '');
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  // Someone who just used the contact form must never be sent to /book while
  // no calendar is live — /book would route them straight back to the form
  // they came from. Silence beats a loop.
  const isGuest = topic === 'booking';
  const offerCall = !isGuest && canBook;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a">
    <p>Hi ${esc(first)},</p>
    <p>Thanks for reaching out to Straw Hut Media — your message landed and a real person will read it.</p>
    ${
      isGuest
        ? `<p>We'll come back to you about guesting on one of our shows.</p>`
        : offerCall
        ? `<p>If it's easier than waiting on email, you can grab a free 15-minute call right now and we'll tell you straight whether we're the right partner for what you're building:</p>
           <p><a href="${site}/book" style="display:inline-block;background:#00cc8e;color:#023324;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:999px">Book a 15-minute call →</a></p>
           <p style="font-size:14px;color:#555">No slides, no hard sell. Fifteen minutes.</p>`
        : `<p>We'll come back to you shortly — usually the same day — with a straight answer on whether we're the right partner for what you're building, and a time to talk it through.</p>`
    }
    <p>— Straw Hut Media</p>
    <p style="font-size:13px;color:#888">Full-service podcast production &amp; network · <a href="${site}" style="color:#0a8f66">strawhutmedia.com</a></p>
  </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: email,
        subject: offerCall ? "Thanks for reaching out — want to grab 15 minutes?" : 'Thanks for getting in touch — Straw Hut Media',
        html,
        reply_to: 'hello@strawhutmedia.com',
      }),
    });
    if (!res.ok) {
      const b = await res.text().catch(() => '');
      console.error('[mail] auto-reply failed:', res.status, b.slice(0, 160));
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[mail] auto-reply error:', e.message);
    return { ok: false };
  }
}

export async function sendContactEmail({ name, email, company, message, topic, flags = [] }) {
  const route = CONTACT_ROUTES[topic] || CONTACT_ROUTES.general;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Never dropped — just labelled, so a mail rule can quarantine it and a real
  // lead that trips a heuristic still lands in the inbox.
  const suspect = flags.length ? `[possible spam: ${flags.join(', ')}] ` : '';
  const html = `<h2>New contact form message</h2>
    ${suspect ? `<p style="background:#fff4d6;padding:8px 10px;border-radius:6px"><strong>⚠ Flagged as possible spam</strong> (${esc(flags.join(', '))}). Delivered anyway in case it's real.</p>` : ''}
    <p><strong>Regarding:</strong> ${esc(route.label)}</p>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    ${company ? `<p><strong>Company / show:</strong> ${esc(company)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p style="white-space:pre-wrap">${esc(message)}</p>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: route.to, subject: `${suspect}[${route.label}] ${name || 'someone'}`, html, reply_to: email }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Send an announcement to a list of subscribers.
 * Sends individually so one bad address doesn't fail the batch, and so each
 * recipient only sees their own address.
 * @returns {{ sent: number, failed: number, errors: string[] }}
 */
export async function sendAnnouncement(subscribers, { subject, html }) {
  if (!mailConfigured()) {
    throw new Error('RESEND_API_KEY is not set — cannot send email. Set it on the server first.');
  }
  let sent = 0;
  let failed = 0;
  const errors = [];
  for (const sub of subscribers) {
    try {
      const personalized = html.replace(
        /\{\{unsubscribe\}\}/g,
        `${(process.env.APP_BASE_URL || '').replace(/\/+$/, '')}/unsubscribe?e=${encodeURIComponent(sub.email)}`
      );
      await sendOne({ to: sub.email, subject, html: personalized });
      sent++;
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(`${sub.email}: ${e.message}`);
    }
  }
  return { sent, failed, errors };
}

/** Weekly traffic digest to the owner. Plain, scannable, no tracking pixels. */
export async function sendTrafficDigest(to, { stats, days = 7, siteUrl }) {
  if (!mailConfigured()) return { ok: false, reason: 'no RESEND_API_KEY' };
  const { total, previous, top } = stats;
  const delta = previous > 0 ? Math.round(((total - previous) / previous) * 100) : null;
  const arrow = delta === null ? '' : delta >= 0 ? '▲' : '▼';
  const colour = delta === null ? '#6b7280' : delta >= 0 ? '#00994f' : '#c0392b';
  const rows = top.slice(0, 15).map((r, i) => `
    <tr>
      <td style="padding:7px 10px;color:#9aa2c0;font-size:13px">${i + 1}</td>
      <td style="padding:7px 10px"><a href="${siteUrl}${r.path}" style="color:#0a7f5c;text-decoration:none">${r.path}</a></td>
      <td style="padding:7px 10px;text-align:right;font-weight:600">${r.hits.toLocaleString()}</td>
    </tr>`).join('');
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:620px;margin:0 auto;color:#12182f">
    <h2 style="margin:0 0 4px">Straw Hut Media — weekly traffic</h2>
    <p style="color:#6b7280;margin:0 0 22px;font-size:14px">Last ${days} days on strawhutmedia.com</p>
    <div style="background:#f5f7fb;border-radius:12px;padding:20px;margin-bottom:22px">
      <div style="font-size:34px;font-weight:700;line-height:1">${total.toLocaleString()}</div>
      <div style="color:#6b7280;font-size:14px">page views
        ${delta === null ? '' : `· <span style="color:${colour};font-weight:600">${arrow} ${Math.abs(delta)}%</span> vs previous ${days} days`}
      </div>
    </div>
    <h3 style="margin:0 0 8px;font-size:15px">Most visited pages</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows || '<tr><td style="padding:10px;color:#6b7280">No visits recorded.</td></tr>'}</table>
    <p style="margin-top:24px;font-size:13px;color:#6b7280">
      Full dashboard: <a href="${siteUrl}/admin/analytics" style="color:#0a7f5c">${siteUrl}/admin/analytics</a>
    </p>
  </div>`;
  return sendOne({ to, subject: `Straw Hut traffic — ${total.toLocaleString()} page views this week`, html });
}
