import { Resend } from 'resend'
import { pool } from './db'

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

// System email (magic links, invites, alerts, notifications) sends from a
// domain that must be VERIFIED under RESEND_API_KEY's Resend team. The
// key's team has strawhutmedia.net verified but NOT strawhutmedia.com, so
// the default sends from strawhutmedia.net — sending from an unverified
// domain fails the send and locks everyone out of magic-link sign-in.
// Override with MAIL_FROM only if that address's domain is verified too.
const FROM = process.env.MAIL_FROM || 'Slate <slate@strawhutmedia.net>'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com'

// Persistent admin-alert dedupe via the sent_admin_alerts table. An
// in-memory Map would reset on every Railway redeploy and re-send the
// same daily digest each boot.
async function shouldSendAdminAlert(key: string, withinMinutes: number): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ last_sent_at: string }>(
      `SELECT last_sent_at FROM sent_admin_alerts WHERE key = $1`,
      [key],
    )
    if (rows.length > 0) {
      const last = new Date(rows[0].last_sent_at).getTime()
      if (Date.now() - last < withinMinutes * 60 * 1000) return false
    }
    await pool.query(
      `INSERT INTO sent_admin_alerts (key, last_sent_at)
       VALUES ($1, now())
       ON CONFLICT (key) DO UPDATE SET last_sent_at = now()`,
      [key],
    )
    return true
  } catch (err) {
    // If dedupe DB call fails, fail open (send the email) rather than
    // silently dropping a real alert.
    console.error('[slate] shouldSendAdminAlert query failed; sending anyway', err)
    return true
  }
}

export async function sendAdminAlert(subject: string, body: string, key?: string) {
  if (!resend) {
    console.log(`[slate] (no RESEND_API_KEY) would alert admin: ${subject}`)
    return
  }
  if (key) {
    // Daily digests use date-suffixed keys (e.g. stuck-digest-2026-04-30)
    // so a 24-hour window is appropriate; per-error keys want 1 hour.
    const isDigest = key.includes('digest')
    const ok = await shouldSendAdminAlert(key, isDigest ? 24 * 60 : 60)
    if (!ok) return
  }
  try {
    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `[Slate] ${subject}`,
      text: body,
    })
  } catch (err) {
    console.error('[slate] sendAdminAlert failed', err)
  }
}

export async function sendInviteEmail(email: string, name: string, inviterName: string) {
  if (!resend) {
    console.log(`[slate] (no RESEND_API_KEY) invite email would go to ${email}`)
    return
  }
  const baseUrl = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
  const result = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `${inviterName} invited you to Slate`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0b0d12">
        <p style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#7a8294;margin:0 0 8px">Straw Hut Media presents</p>
        <h1 style="font-family:Impact,sans-serif;font-size:42px;letter-spacing:0.02em;margin:0 0 24px;background:linear-gradient(90deg,#fbbf24,#f472b6,#a78bfa,#2dd4bf);-webkit-background-clip:text;background-clip:text;color:transparent">SLATE</h1>
        <p style="font-size:16px;line-height:1.5">Hi ${escapeHtml(name)},</p>
        <p style="font-size:16px;line-height:1.5"><strong>${escapeHtml(inviterName)}</strong> just added you to Slate, Straw Hut Media's project tracker.</p>
        <p style="font-size:16px;line-height:1.5">To sign in, head to the link below and request a magic link with this email address:</p>
        <p style="margin:28px 0">
          <a href="${baseUrl}/login" style="display:inline-block;background:#a78bfa;color:white;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">Open Slate</a>
        </p>
        <p style="font-size:12px;color:#7a8294;line-height:1.5">Or paste this URL into your browser:<br><span style="word-break:break-all">${baseUrl}/login</span></p>
      </div>
    `,
  })
  if (result.error) {
    throw new Error(`resend: ${result.error.name || 'send_failed'}: ${result.error.message || JSON.stringify(result.error)}`)
  }
}

export async function sendNotificationEmail(args: {
  to: string
  subject: string
  body: string
  link: string
}) {
  if (!resend) {
    console.log(`[slate] (no RESEND_API_KEY) notify ${args.to}: ${args.subject}`)
    return
  }
  const result = await resend.emails.send({
    from: FROM,
    to: args.to,
    subject: args.subject,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0b0d12">
        <p style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#7a8294;margin:0 0 8px">Straw Hut Media presents</p>
        <h1 style="font-family:Impact,sans-serif;font-size:32px;letter-spacing:0.02em;margin:0 0 16px;background:linear-gradient(90deg,#fbbf24,#f472b6,#a78bfa,#2dd4bf);-webkit-background-clip:text;background-clip:text;color:transparent">SLATE</h1>
        <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(args.subject)}</h2>
        <p style="font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(args.body)}</p>
        <p style="margin:24px 0">
          <a href="${args.link}" style="display:inline-block;background:#a78bfa;color:white;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Open in Slate</a>
        </p>
        <p style="font-size:12px;color:#7a8294;line-height:1.5">${args.link}</p>
      </div>
    `,
  })
  if (result.error) {
    throw new Error(`resend: ${result.error.name || 'send_failed'}: ${result.error.message || JSON.stringify(result.error)}`)
  }
}

export async function sendInvoiceEmail(args: {
  to: string
  replyTo?: string
  companyName: string
  contractorName: string
  invoiceNumber: string
  period: string
  totalLabel: string
  payMethod: string
  pdf: Buffer
}) {
  if (!resend) {
    console.log(`[slate] (no RESEND_API_KEY) invoice ${args.invoiceNumber} would go to ${args.to}`)
    return
  }
  const result = await resend.emails.send({
    from: FROM,
    to: args.to,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    subject: `Invoice ${args.invoiceNumber} — ${args.companyName}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0b0d12">
        <h1 style="font-family:Impact,sans-serif;font-size:30px;margin:0 0 16px;color:#A96B12">${escapeHtml(args.companyName)}</h1>
        <p style="font-size:15px;line-height:1.5">Hi ${escapeHtml(args.contractorName)},</p>
        <p style="font-size:15px;line-height:1.5">Attached is invoice <strong>${escapeHtml(args.invoiceNumber)}</strong>${args.period ? ` for <strong>${escapeHtml(args.period)}</strong>` : ''}.</p>
        <p style="font-size:15px;line-height:1.5">Total: <strong>${escapeHtml(args.totalLabel)}</strong></p>
        <p style="font-size:14px;line-height:1.5;color:#555">You'll receive payment via ${escapeHtml(args.payMethod)}. No action needed on your end.</p>
        <p style="font-size:15px;line-height:1.5;margin-top:24px">Thanks,<br>${escapeHtml(args.companyName)}</p>
      </div>
    `,
    attachments: [
      {
        filename: `${args.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`,
        content: args.pdf,
      },
    ],
  })
  if (result.error) {
    throw new Error(`resend: ${result.error.name || 'send_failed'}: ${result.error.message || JSON.stringify(result.error)}`)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function sendMagicLink(email: string, link: string) {
  if (!resend) {
    console.log(`[slate] (no RESEND_API_KEY) magic link for ${email}: ${link}`)
    return
  }
  const result = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Sign in to Slate',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0b0d12">
        <p style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#7a8294;margin:0 0 8px">Straw Hut Media presents</p>
        <h1 style="font-family:Impact,sans-serif;font-size:42px;letter-spacing:0.02em;margin:0 0 24px;background:linear-gradient(90deg,#fbbf24,#f472b6,#a78bfa,#2dd4bf);-webkit-background-clip:text;background-clip:text;color:transparent">SLATE</h1>
        <p style="font-size:16px;line-height:1.5">Tap the button below to sign in. Link expires in 15 minutes.</p>
        <p style="margin:28px 0">
          <a href="${link}" style="display:inline-block;background:#a78bfa;color:white;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">Sign in to Slate</a>
        </p>
        <p style="font-size:12px;color:#7a8294;line-height:1.5">If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all">${link}</span></p>
      </div>
    `,
  })
  // Resend returns { data, error } — surface the error so it lands in our error log
  if (result.error) {
    throw new Error(`resend: ${result.error.name || 'send_failed'}: ${result.error.message || JSON.stringify(result.error)}`)
  }
}
