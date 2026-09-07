// Resend-compatible transactional email transport.
//
// This is a drop-in replacement for `import { Resend } from 'resend'` on the
// TRANSACTIONAL `.emails.send(...)` path only (magic links, invites, admin
// alerts, invoices, lead follow-ups). Call sites are unchanged:
//
//     const resend = new Resend(apiKey)
//     const { data, error } = await resend.emails.send({ from, to, subject, html })
//
// Behavior:
//   - If Amazon SES credentials are present in the environment, send via
//     @aws-sdk/client-sesv2 and return a Resend-shaped { data, error } result.
//   - Otherwise, delegate to the real `resend` package, so behavior is
//     IDENTICAL to before until SES env vars are set on the server. This keeps
//     the migration reversible: unset the SES vars and every send goes back
//     through Resend.
//
// SES has no equivalent for Resend's Audiences / Contacts / Broadcasts /
// Domains APIs, so those are intentionally NOT implemented here. Files that use
// those APIs must keep importing the real `resend` package directly.

import { Resend as RealResend } from 'resend'
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2'

type Address = string | string[]

interface Attachment {
  filename: string
  content: Buffer | string
  contentType?: string
  content_type?: string
}

// Superset of the fields Slate's transactional callers pass. Both `replyTo`
// (Resend v4 SDK style) and `reply_to` (legacy) are accepted.
export interface SendEmailPayload {
  from: string
  to: Address
  subject: string
  html?: string
  text?: string
  replyTo?: Address
  reply_to?: Address
  cc?: Address
  bcc?: Address
  attachments?: Attachment[]
  [key: string]: unknown
}

// Mirrors Resend's `{ data, error }` return contract that callers destructure.
export interface SendEmailResponse {
  data: { id: string } | null
  error: { name?: string; message?: string } | null
}

interface EmailsApi {
  send(payload: SendEmailPayload): Promise<SendEmailResponse>
}

function toArray(addr: Address | undefined): string[] | undefined {
  if (addr == null) return undefined
  const arr = (Array.isArray(addr) ? addr : [addr]).filter(Boolean)
  return arr.length ? arr : undefined
}

function sesCredentials():
  | { accessKeyId: string; secretAccessKey: string }
  | null {
  const sesId = process.env.SES_ACCESS_KEY_ID
  const sesSecret = process.env.SES_SECRET_ACCESS_KEY
  if (sesId && sesSecret) {
    return { accessKeyId: sesId, secretAccessKey: sesSecret }
  }
  const awsId = process.env.AWS_ACCESS_KEY_ID
  const awsSecret = process.env.AWS_SECRET_ACCESS_KEY
  if (awsId && awsSecret) {
    return { accessKeyId: awsId, secretAccessKey: awsSecret }
  }
  return null
}

// RFC 2047 "encoded-word" for headers that may contain non-ASCII (subject,
// display names). ASCII values pass through untouched.
function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// Build a raw RFC 5322 / MIME message. Used only when attachments are present,
// because SESv2 "Simple" content cannot carry attachments portably.
function buildRawMime(payload: SendEmailPayload): Buffer {
  const boundaryMixed = `mixed_${Math.random().toString(36).slice(2)}`
  const boundaryAlt = `alt_${Math.random().toString(36).slice(2)}`
  const to = toArray(payload.to) ?? []
  const cc = toArray(payload.cc)
  const replyTo = toArray(payload.replyTo ?? payload.reply_to)

  const headers: string[] = [
    `From: ${payload.from}`,
    `To: ${to.join(', ')}`,
  ]
  if (cc) headers.push(`Cc: ${cc.join(', ')}`)
  if (replyTo) headers.push(`Reply-To: ${replyTo.join(', ')}`)
  headers.push(`Subject: ${encodeHeader(payload.subject)}`)
  headers.push(`MIME-Version: 1.0`)
  headers.push(`Date: ${new Date().toUTCString()}`)
  headers.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`)

  const lines: string[] = [...headers, '', `--${boundaryMixed}`]

  // Body part: multipart/alternative when both text and html exist.
  if (payload.html && payload.text) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`, '')
    lines.push(`--${boundaryAlt}`)
    lines.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '')
    lines.push(Buffer.from(payload.text, 'utf8').toString('base64'))
    lines.push(`--${boundaryAlt}`)
    lines.push('Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '')
    lines.push(Buffer.from(payload.html, 'utf8').toString('base64'))
    lines.push(`--${boundaryAlt}--`)
  } else {
    const isHtml = !!payload.html
    const body = payload.html ?? payload.text ?? ''
    lines.push(
      `Content-Type: text/${isHtml ? 'html' : 'plain'}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body, 'utf8').toString('base64'),
    )
  }

  // Attachment parts.
  for (const att of payload.attachments ?? []) {
    const content = Buffer.isBuffer(att.content)
      ? att.content
      : Buffer.from(String(att.content), 'utf8')
    const ctype = att.contentType || att.content_type || 'application/octet-stream'
    lines.push(`--${boundaryMixed}`)
    lines.push(
      `Content-Type: ${ctype}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      content.toString('base64'),
    )
  }

  lines.push(`--${boundaryMixed}--`, '')
  return Buffer.from(lines.join('\r\n'), 'utf8')
}

class SesEmails implements EmailsApi {
  constructor(private readonly client: SESv2Client) {}

  async send(payload: SendEmailPayload): Promise<SendEmailResponse> {
    try {
      const to = toArray(payload.to)
      const cc = toArray(payload.cc)
      const bcc = toArray(payload.bcc)
      const replyTo = toArray(payload.replyTo ?? payload.reply_to)
      const configSet = process.env.SES_CONFIG_SET || undefined

      const input: SendEmailCommandInput = {
        FromEmailAddress: payload.from,
        Destination: {
          ToAddresses: to,
          CcAddresses: cc,
          BccAddresses: bcc,
        },
        ReplyToAddresses: replyTo,
        ConfigurationSetName: configSet,
        Content: {},
      }

      if (payload.attachments && payload.attachments.length > 0) {
        input.Content = { Raw: { Data: buildRawMime(payload) } }
      } else {
        input.Content = {
          Simple: {
            Subject: { Data: payload.subject, Charset: 'UTF-8' },
            Body: {
              ...(payload.html ? { Html: { Data: payload.html, Charset: 'UTF-8' } } : {}),
              ...(payload.text ? { Text: { Data: payload.text, Charset: 'UTF-8' } } : {}),
            },
          },
        }
      }

      const out = await this.client.send(new SendEmailCommand(input))
      return { data: { id: out.MessageId ?? '' }, error: null }
    } catch (err) {
      // Mirror Resend's contract: return the error in `error` rather than
      // throwing, so callers that check `result.error` behave identically.
      const e = err as { name?: string; message?: string }
      return { data: null, error: { name: e?.name || 'ses_send_failed', message: e?.message || String(err) } }
    }
  }
}

/**
 * Resend-compatible client. Constructed exactly like the real one:
 *   `new Resend(apiKey)`
 * Exposes `.emails.send(...)`. Routes to SES when SES credentials exist,
 * otherwise delegates to the real Resend package.
 */
export class Resend {
  readonly emails: EmailsApi

  constructor(apiKey?: string) {
    const creds = sesCredentials()
    if (creds) {
      const client = new SESv2Client({
        region: process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1',
        credentials: creds,
      })
      this.emails = new SesEmails(client)
    } else {
      const real = new RealResend(apiKey)
      this.emails = {
        send: (payload) =>
          real.emails.send(
            payload as unknown as Parameters<typeof real.emails.send>[0],
          ) as Promise<SendEmailResponse>,
      }
    }
  }
}
