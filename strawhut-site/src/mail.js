// Email sending via Resend's HTTP API (same provider as Slate / Pod Booster).
// No SDK dependency — just fetch. Requires RESEND_API_KEY at runtime.

const FROM = process.env.FROM_EMAIL || 'Straw Hut Media <news@strawhutmedia.com>';

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

/**
 * Deliver a contact-form submission to the admin inbox, with reply-to set to
 * the sender so the admin can just hit reply.
 */
export async function sendContactEmail({ name, email, company, message }) {
  const to = process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<h2>New contact form message</h2>
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
    body: JSON.stringify({ from: FROM, to, subject: `Contact form — ${name || 'someone'}`, html, reply_to: email }),
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
