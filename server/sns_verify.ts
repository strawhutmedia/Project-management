// Shared AWS SNS message verification, used by every public SES/SNS
// receiver (bounce/complaint notifications, inbound-reply notifications,
// and anything else SNS delivers here in the future). Extracted so the
// crypto/signature logic exists exactly once.
import crypto from 'crypto'
import type { Request } from 'express'

export type SnsMessage = {
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

export async function verifySnsSignature(msg: SnsMessage): Promise<boolean> {
  if (!msg.Signature || !msg.SigningCertURL || !msg.Type) return false
  if (!certUrlIsTrusted(msg.SigningCertURL)) return false
  const pem = await fetchCert(msg.SigningCertURL)
  const verifier = crypto.createVerify(msg.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
  verifier.update(stringToSign(msg), 'utf8')
  return verifier.verify(pem, msg.Signature, 'base64')
}

export function parseSnsBody(req: Request): SnsMessage {
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body ?? {})
  return JSON.parse(raw)
}

// Shared handling for the SubscriptionConfirmation handshake — every SNS
// receiver needs this exact behavior, so it lives here once.
export async function autoConfirmSubscription(msg: SnsMessage): Promise<void> {
  if (msg.Type !== 'SubscriptionConfirmation' || !msg.SubscribeURL) return
  await fetch(msg.SubscribeURL)
}
