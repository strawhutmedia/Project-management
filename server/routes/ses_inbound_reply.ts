// Receives replies to cold-outreach sends. A show's outreach_templates.reply_to
// can point at a Slate-owned capture address instead of a real human inbox —
// p-<projectId>@<inbound reply domain> — so nobody's real mailbox has to be
// wired into AWS. When SES receives mail for that address, it publishes the
// full message to an SNS topic (receipt rule action: SNS, content included);
// this endpoint parses it, matches the sender back to the prospect they were
// sent to, marks them 'replied' (same bookkeeping as the manual "mark as
// replied" button — Rolodex auto-file included), and emails whoever's
// configured as this show's notify_email (falling back to ADMIN_EMAIL) with
// the reply itself and a link into Slate — nobody's real inbox ever needs to
// receive the raw reply for this to work.
//
// Mounted PUBLICLY (SNS can't authenticate as an admin) at
//   POST /api/ses/inbound-reply
import type { Request, Response } from 'express'
import { simpleParser } from 'mailparser'
import { pool } from '../db'
import { escapeHtml, FROM } from '../email'
import { Resend } from '../mailTransport'
import { logError, logInfo } from '../diag'
import { autoConfirmSubscription, parseSnsBody, verifySnsSignature } from '../sns_verify'
import { fileProspectInRolodex } from './outreach'

const resendKey = process.env.RESEND_API_KEY
const resend = new Resend(resendKey)

// Matches the local-part Slate generates for a show's inbound capture
// address: p-<project uuid>@anything.
const CAPTURE_ADDRESS_RE =
  /^p-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i

function extractProjectId(destinations: string[]): string | null {
  for (const addr of destinations) {
    const m = CAPTURE_ADDRESS_RE.exec(addr.trim())
    if (m) return m[1]
  }
  return null
}

async function notifyOfReply(opts: {
  projectId: string
  projectName: string
  prospectName: string
  prospectEmail: string
  subject: string
  bodySnippet: string
}): Promise<void> {
  const tpl = await pool.query<{ notify_email: string | null }>(
    `SELECT notify_email FROM outreach_templates WHERE project_id = $1`,
    [opts.projectId],
  )
  const to = tpl.rows[0]?.notify_email?.trim() || process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com'
  const baseUrl = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
  const link = `${baseUrl}/admin/outreach/shows/${opts.projectId}`
  const subject = `Reply on ${opts.projectName}: ${opts.prospectName}`
  const text =
    `${opts.prospectName} <${opts.prospectEmail}> replied to ${opts.projectName} outreach.\n\n` +
    `Subject: ${opts.subject}\n\n${opts.bodySnippet}\n\nOpen in Slate: ${link}`
  try {
    const r = await resend.emails.send({
      from: FROM,
      to,
      subject: `[Slate] ${subject}`,
      text,
      tags: [{ name: 'stage', value: 'internal' }, { name: 'category', value: 'outreach-reply' }],
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0b0d12">
          <p style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#7a8294;margin:0 0 8px">Straw Hut Media presents</p>
          <h1 style="font-family:Impact,sans-serif;font-size:32px;letter-spacing:0.02em;margin:0 0 20px;background:linear-gradient(90deg,#fbbf24,#f472b6,#a78bfa,#2dd4bf);-webkit-background-clip:text;background-clip:text;color:transparent">SLATE</h1>
          <h2 style="font-size:17px;margin:0 0 6px">${escapeHtml(opts.prospectName)} replied</h2>
          <p style="font-size:13px;color:#555;margin:0 0 14px">${escapeHtml(opts.prospectEmail)} · ${escapeHtml(opts.projectName)} outreach</p>
          <p style="font-size:13px;color:#333;margin:0 0 6px"><strong>${escapeHtml(opts.subject)}</strong></p>
          <p style="font-size:14.5px;line-height:1.6;white-space:pre-wrap;color:#333333;border-left:3px solid #ddd;padding-left:12px">${escapeHtml(opts.bodySnippet)}</p>
          <p style="margin:26px 0 0">
            <a href="${link}" style="display:inline-block;background:#a78bfa;color:white;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Open in Slate</a>
          </p>
        </div>
      `,
    })
    if (r.error) {
      logError('outreach reply notify: send failed', { projectId: opts.projectId, error: r.error })
    }
  } catch (err) {
    logError('outreach reply notify: send threw', {
      projectId: opts.projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleSesInboundReply(req: Request, res: Response): Promise<void> {
  let msg
  try {
    msg = parseSnsBody(req)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  let verified = false
  try {
    verified = await verifySnsSignature(msg)
  } catch (err) {
    logError('ses inbound-reply: signature check threw', { error: err instanceof Error ? err.message : String(err) })
  }
  if (!verified) {
    logError('ses inbound-reply: rejected a message with a missing/invalid signature', { type: msg.Type })
    res.status(401).json({ error: 'bad_signature' })
    return
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    try {
      await autoConfirmSubscription(msg)
      logInfo('ses inbound-reply: subscription confirmed', { topicArn: msg.TopicArn })
    } catch (err) {
      logError('ses inbound-reply: failed to confirm subscription', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    res.json({ ok: true })
    return
  }

  if (msg.Type !== 'Notification' || !msg.Message) {
    res.json({ ok: true })
    return
  }

  let payload: {
    notificationType?: string
    mail?: { destination?: string[]; commonHeaders?: { subject?: string } }
    content?: string
  }
  try {
    payload = JSON.parse(msg.Message)
  } catch {
    res.json({ ok: true })
    return
  }

  if (payload.notificationType !== 'Received') {
    res.json({ ok: true })
    return
  }

  const destinations = payload.mail?.destination ?? []
  const projectId = extractProjectId(destinations)
  if (!projectId) {
    logInfo('ses inbound-reply: no recognized capture address in destinations', { destinations })
    res.json({ ok: true })
    return
  }

  if (!payload.content) {
    // The receipt rule wasn't configured to include full content (or the
    // message exceeded SNS's ~150KB inline limit) — nothing to parse
    // without an S3 fetch, which this endpoint doesn't implement.
    logError('ses inbound-reply: notification had no inline content — check the SES receipt rule action', {
      projectId,
    })
    res.json({ ok: true })
    return
  }

  let parsed
  try {
    parsed = await simpleParser(Buffer.from(payload.content, 'base64'))
  } catch (err) {
    logError('ses inbound-reply: MIME parse failed', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.json({ ok: true })
    return
  }

  const fromAddress = Array.isArray(parsed.from)
    ? parsed.from[0]?.value?.[0]?.address
    : parsed.from?.value?.[0]?.address
  if (!fromAddress) {
    logInfo('ses inbound-reply: could not extract a from address', { projectId })
    res.json({ ok: true })
    return
  }

  const projectRes = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE id = $1`,
    [projectId],
  )
  const project = projectRes.rows[0]
  if (!project) {
    logInfo('ses inbound-reply: capture address named an unknown project', { projectId })
    res.json({ ok: true })
    return
  }

  const prospectRes = await pool.query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM outreach_prospects
      WHERE project_id = $1 AND lower(email) = lower($2)
      ORDER BY created_at DESC LIMIT 1`,
    [projectId, fromAddress],
  )
  const prospect = prospectRes.rows[0]
  if (!prospect) {
    logInfo('ses inbound-reply: reply from an address not in this show\'s prospects', {
      projectId,
      from: fromAddress,
    })
    res.json({ ok: true })
    return
  }

  await pool.query(
    `UPDATE outreach_prospects SET status = 'replied', replied_at = now(), updated_at = now() WHERE id = $1`,
    [prospect.id],
  )
  void fileProspectInRolodex(prospect.id).catch((err) =>
    logError('rolodex: auto-file on inbound reply failed', {
      prospectId: prospect.id,
      error: err instanceof Error ? err.message : String(err),
    }),
  )

  const bodySnippet = (parsed.text || parsed.html?.toString() || '(no readable body)').slice(0, 2000)
  await notifyOfReply({
    projectId,
    projectName: project.name,
    prospectName: prospect.name,
    prospectEmail: prospect.email,
    subject: parsed.subject || payload.mail?.commonHeaders?.subject || '(no subject)',
    bodySnippet,
  })

  logInfo('ses inbound-reply: matched reply and notified', {
    projectId,
    prospectId: prospect.id,
  })
  res.json({ ok: true })
}
