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
import type { Request, Response } from 'express'
import { logError, logInfo } from '../diag'
import { autoConfirmSubscription, parseSnsBody, verifySnsSignature } from '../sns_verify'
import { handleNegativeEvent } from './outreach_webhook'

export async function handleSesNotify(req: Request, res: Response): Promise<void> {
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
    logError('ses notify: signature check threw', { error: err instanceof Error ? err.message : String(err) })
  }
  if (!verified) {
    logError('ses notify: rejected a message with a missing/invalid signature', { type: msg.Type })
    res.status(401).json({ error: 'bad_signature' })
    return
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    try {
      await autoConfirmSubscription(msg)
      logInfo('ses notify: subscription confirmed', { topicArn: msg.TopicArn })
    } catch (err) {
      logError('ses notify: failed to confirm subscription', {
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
