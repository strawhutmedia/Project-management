// Amazon SES bounce/complaint receiver — the SNS-based equivalent of
// outreach_webhook.ts's Resend Svix webhook, feeding the exact same
// outreach_sends bookkeeping and domain auto-pause logic.
//
// SES publishes Bounce/Complaint events to an SNS topic (wired via
// ses_bounce_setup.ts's CreateConfigurationSetEventDestination call); SNS
// delivers them here as an HTTP POST. This is the one piece of Slate's
// email stack that still needed an AWS action outside code (creating the
// SNS topic + subscription) before it could exist at all — see
// SES_SNS_TOPIC_ARN in CLAUDE.md.
//
// Mounted PUBLICLY (SNS can't authenticate as an admin) at
//   POST /api/ses/notify
// so every message is verified against its own AWS-signed signature
// instead — never trust an unverified body, since this endpoint can pause
// a sending domain.
import crypto from 'crypto'
import type { Request, Response } from 'express'
import { logError, logInfo } from '../diag'
import { handleNegativeEvent } from './outreach_webhook'

type SnsMessage = {
  Type?: string
  MessageId?: string
  TopicArn?: string
  Subject?: string
  Message?: string
  Timestamp?: string
  SignatureVersion?: string
  Signature?: string
  SigningCertURL?: string
  SubscribeURL?: string
  Token?: string
}

// SNS signs a fixed, ordered subset of fields depending on message type —
// only the keys present for that type, each as "Key\nValue\n". Getting this
// wrong (wrong key set, wrong order) makes every signature fail to verify.
function stringToSign(msg: SnsMessage): string {
  const keys: Array<keyof SnsMessage> =
    msg.Type === 'SubscriptionConfirmation' || msg.Type === 'UnsubscribeConfirmation'
      ? ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
  const parts: string[] = []
  for (const k of keys) {
    const v = msg[k]
    if (v === undefined) continue
    parts.push(k, String(v))
  }
  return parts.join('\n') + '\n'
}

// The signing cert URL is attacker-controlled input inside the message
// body — restrict it to AWS's own SNS cert hosts before ever fetching it,
// or a forged message could point us at a cert of the attacker's choosing.
function certUrlIsTrusted(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(u.hostname)
  } catch {
    return false
  }
}

const certCache = new Map<string, string>()
async function fetchCert(url: string): Promise<string> {
  const cached = certCache.get(url)
  if (cached) return cached
  const res = await fetch(url)
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`)
  const pem = await res.text()
  certCache.set(url, pem)
  return pem
}

async function verifySnsSignature(msg: SnsMessage): Promise<boolean> {
  if (!msg.Signature || !msg.SigningCertURL || !msg.Type) return false
  if (!certUrlIsTrusted(msg.SigningCertURL)) return false
  const pem = await fetchCert(msg.SigningCertURL)
  const verifier = crypto.createVerify(msg.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
  verifier.update(stringToSign(msg), 'utf8')
  return verifier.verify(pem, msg.Signature, 'base64')
}

export async function handleSesNotify(req: Request, res: Response): Promise<void> {
  let msg: SnsMessage
  try {
    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {})
    msg = JSON.parse(raw)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  let verified = false
  try {
    verified = await verifySnsSignature(msg)
  } catch (err) {
    logError('ses notify: signature check threw', { error: err instanceof Error ? err.message : String(err) })
  }
  if (!verified) {
    logError('ses notify: rejected a message with a missing/invalid signature', { type: msg.Type })
    res.status(401).json({ error: 'bad_signature' })
    return
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    if (msg.SubscribeURL) {
      try {
        await fetch(msg.SubscribeURL)
        logInfo('ses notify: subscription confirmed', { topicArn: msg.TopicArn })
      } catch (err) {
        logError('ses notify: failed to confirm subscription', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    res.json({ ok: true })
    return
  }

  if (msg.Type !== 'Notification' || !msg.Message) {
    res.json({ ok: true })
    return
  }

  let payload: { notificationType?: string; mail?: { messageId?: string } }
  try {
    payload = JSON.parse(msg.Message)
  } catch {
    res.json({ ok: true })
    return
  }

  const sesMessageId = payload.mail?.messageId || null
  if (payload.notificationType === 'Bounce' && sesMessageId) {
    await handleNegativeEvent('email.bounced', sesMessageId)
  } else if (payload.notificationType === 'Complaint' && sesMessageId) {
    await handleNegativeEvent('email.complained', sesMessageId)
  }

  res.json({ ok: true })
}
