import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

const FROM = process.env.MAIL_FROM || 'Slate <slate@strawhutmedia.com>'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com'

const recentAdminAlerts = new Map<string, number>()

export async function sendAdminAlert(subject: string, body: string, key?: string) {
  if (!resend) {
    console.log(`[slate] (no RESEND_API_KEY) would alert admin: ${subject}`)
    return
  }
  if (key) {
    const last = recentAdminAlerts.get(key)
    const now = Date.now()
    if (last && now - last < 60 * 60 * 1000) return
    recentAdminAlerts.set(key, now)
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
