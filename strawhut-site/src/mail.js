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
export async function sendContactEmail({ name, email, company, message, topic }) {
  const route = CONTACT_ROUTES[topic] || CONTACT_ROUTES.general;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<h2>New contact form message</h2>
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
    body: JSON.stringify({ from: FROM, to: route.to, subject: `[${route.label}] ${name || 'someone'}`, html, reply_to: email }),
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
