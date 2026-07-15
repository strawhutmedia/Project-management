// Resend webhook receiver — the reactive safety net behind the pre-send
// email check.
//
// Resend POSTs delivery events here (bounces, complaints). We match each
// event back to its outreach_sends row via the resend_message_id we
// stored at send time, flag the prospect so it never gets re-sent, and —
// if a sending domain's recent bounce/complaint rate spikes — auto-pause
// that domain so the next campaign falls back to a healthier one. The
// pause goes through logError, which emails the admin per the app's
// alerting rules.
//
// Mounted PUBLICLY (Resend can't authenticate as an admin) at
//   POST /api/outreach/resend-webhook
// so it verifies the Svix signature instead, using RESEND_WEBHOOK_SECRET.
// If that env var isn't set the endpoint still works (so it can be wired
// up before signing is configured) but logs that it's running unverified.

import crypto from 'crypto'
import type { Request, Response } from 'express'
import { pool } from '../db'
import { logError, logInfo } from '../diag'

let warnedNoSecret = false

// Svix signature scheme (what Resend uses): the signed payload is
// `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256'd with the
// base64-decoded secret (minus its `whsec_` prefix). The svix-signature
// header is a space-separated list of `v1,<base64sig>` entries.
function verifySignature(raw: Buffer, headers: Request['headers'], secret: string): boolean {
  const id = headers['svix-id']
  const ts = headers['svix-timestamp']
  const sig = headers['svix-signature']
  if (typeof id !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${id}.${ts}.${raw.toString('utf8')}`
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64')
  const expectedBuf = Buffer.from(expected)
  return sig.split(' ').some((part) => {
    const given = part.split(',')[1]
    if (!given) return false
    const givenBuf = Buffer.from(given)
    return givenBuf.length === expectedBuf.length && crypto.timingSafeEqual(givenBuf, expectedBuf)
  })
}

// Auto-pause a domain whose recent bounce+complaint rate is unhealthy.
// Needs a meaningful sample so a single early bounce doesn't nuke a
// fresh domain. 5% is the rough industry line where inbox providers
// start throttling.
async function maybePauseDomain(domainId: string): Promise<void> {
  const { rows } = await pool.query<{ sent: number; bad: number }>(
    `SELECT
        count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE status IN ('bounced', 'complained'))::int AS bad
       FROM outreach_sends
      WHERE sending_domain_id = $1
        AND created_at > now() - interval '7 days'`,
    [domainId],
  )
  const sent = rows[0]?.sent ?? 0
  const bad = rows[0]?.bad ?? 0
  const total = sent + bad
  if (total < 20) return
  if (bad / total <= 0.05) return
  const upd = await pool.query<{ name: string }>(
    `UPDATE sending_domains SET active = FALSE, updated_at = now()
      WHERE id = $1 AND active = TRUE
      RETURNING name`,
    [domainId],
  )
  if (upd.rows[0]) {
    // logError → admin email. This is exactly the "buy a replacement"
    // signal the domains page promises.
    logError('outreach: sending domain auto-paused — bounce rate too high', {
      domainId,
      domain: upd.rows[0].name,
      sent,
      bad,
      rate: `${Math.round((bad / total) * 100)}%`,
    })
  }
}

async function handleNegativeEvent(type: string, messageId: string | null): Promise<void> {
  if (!messageId) return
  const sendRes = await pool.query<{ id: string; prospect_id: string; sending_domain_id: string | null }>(
    `SELECT id, prospect_id, sending_domain_id
       FROM outreach_sends WHERE resend_message_id = $1 LIMIT 1`,
    [messageId],
  )
  const send = sendRes.rows[0]
  if (!send) {
    logInfo('outreach webhook: no matching send for message', { messageId, type })
    return
  }
  const complaint = type === 'email.complained'
  const sendStatus = complaint ? 'complained' : 'bounced'
  await pool.query(`UPDATE outreach_sends SET status = $1 WHERE id = $2`, [sendStatus, send.id])

  // A complaint (marked-as-spam) is a hard "never contact again" → opt
  // them out. A bounce → bounced. Either way flag the address invalid so
  // a future campaign can't re-send to it.
  const prospectStatus = complaint ? 'opted_out' : 'bounced'
  await pool.query(
    `UPDATE outreach_prospects
        SET status = $1,
            bounced_at = CASE WHEN $1 = 'bounced' THEN now() ELSE bounced_at END,
            email_check_status = 'invalid',
            email_check_detail = $2,
            updated_at = now()
      WHERE id = $3`,
    [prospectStatus, complaint ? 'Recipient marked the email as spam' : 'Hard bounce', send.prospect_id],
  )

  logInfo('outreach webhook: flagged prospect', { messageId, type, prospectId: send.prospect_id })
  if (send.sending_domain_id) await maybePauseDomain(send.sending_domain_id)
}

// Count an email open against its prospect. Resend fires one event per open,
// so we increment on each — that's how "viewed N times" works. Opens are
// approximate (Apple Mail preloads the pixel), but useful as a signal.
async function handleOpenEvent(messageId: string | null): Promise<void> {
  if (!messageId) return
  const sendRes = await pool.query<{ prospect_id: string }>(
    `SELECT prospect_id FROM outreach_sends WHERE resend_message_id = $1 LIMIT 1`,
    [messageId],
  )
  const send = sendRes.rows[0]
  if (!send) {
    logInfo('outreach webhook: no matching send for open', { messageId })
    return
  }
  await pool.query(
    `UPDATE outreach_prospects
        SET open_count = open_count + 1,
            first_opened_at = COALESCE(first_opened_at, now()),
            last_opened_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [send.prospect_id],
  )
  logInfo('outreach webhook: recorded open', { messageId, prospectId: send.prospect_id })
}

export async function handleResendWebhook(req: Request, res: Response): Promise<void> {
  const raw: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}))

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    if (!verifySignature(raw, req.headers, secret)) {
      logError('outreach webhook: signature verification failed', {})
      res.status(401).json({ error: 'bad_signature' })
      return
    }
  } else if (!warnedNoSecret) {
    warnedNoSecret = true
    logInfo('outreach webhook: RESEND_WEBHOOK_SECRET not set — accepting events unverified', {})
  }

  let event: { type?: string; data?: { email_id?: string; id?: string } }
  try {
    event = JSON.parse(raw.toString('utf8'))
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  const type = typeof event.type === 'string' ? event.type : ''
  const messageId = event.data?.email_id || event.data?.id || null

  try {
    if (type === 'email.bounced' || type === 'email.complained') {
      await handleNegativeEvent(type, messageId)
    } else if (type === 'email.opened') {
      await handleOpenEvent(messageId)
    }
    // Other event types (delivered, clicked) are acknowledged, not acted on.
  } catch (err) {
    logError('outreach webhook: handler threw', {
      type,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    })
    // Still 200 below — a 500 makes Resend retry-storm the endpoint.
  }

  // Always ack so Resend doesn't retry a well-formed event.
  res.json({ ok: true })
}
