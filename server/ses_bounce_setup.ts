// Wires Slate's SES configuration set to publish Bounce/Complaint events to
// an SNS topic, so server/routes/ses_notify.ts can auto-pause a rotation
// domain the same way outreach_webhook.ts does for Resend.
//
// This is the one piece of the SES migration that needs an AWS action
// outside code first: someone with AWS console access creates the SNS
// topic, subscribes it to https://<APP_BASE_URL>/api/ses/notify (SNS will
// hit that endpoint once with a SubscriptionConfirmation, which
// ses_notify.ts auto-confirms), and sets SES_SNS_TOPIC_ARN to the topic's
// ARN. Once that ARN exists, everything else here is ordinary SES API
// calls using the same SES_ACCESS_KEY_ID/SES_SECRET_ACCESS_KEY already
// live on Railway — no new credentials, no new AWS SDK client needed.
import {
  CreateConfigurationSetEventDestinationCommand,
  GetConfigurationSetEventDestinationsCommand,
  UpdateConfigurationSetEventDestinationCommand,
} from '@aws-sdk/client-sesv2'
import { logError, logInfo } from './diag'
import { ses, sesConfigured } from './mailTransport'

const EVENT_DESTINATION_NAME = 'slate-bounce-complaint'

export type BounceWebhookStatus =
  | { configured: false; reason: string }
  | { configured: true; topicArn: string; eventDestinationName: string; action: 'created' | 'updated' | 'already_current' }

export async function ensureSesBounceEventDestination(): Promise<BounceWebhookStatus> {
  if (!sesConfigured()) return { configured: false, reason: 'ses_not_configured' }
  const configSet = process.env.SES_CONFIG_SET
  if (!configSet) return { configured: false, reason: 'ses_config_set_not_set' }
  const topicArn = process.env.SES_SNS_TOPIC_ARN
  if (!topicArn) return { configured: false, reason: 'ses_sns_topic_arn_not_set' }

  const existing = await ses().send(
    new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: configSet }),
  )
  const current = existing.EventDestinations?.find((d) => d.Name === EVENT_DESTINATION_NAME)
  const wantsTypes = ['BOUNCE', 'COMPLAINT'] as const
  const matches =
    current?.Enabled &&
    current.SnsDestination?.TopicArn === topicArn &&
    wantsTypes.every((t) => current.MatchingEventTypes?.includes(t))

  if (matches) {
    return { configured: true, topicArn, eventDestinationName: EVENT_DESTINATION_NAME, action: 'already_current' }
  }

  const EventDestination = {
    Enabled: true,
    MatchingEventTypes: [...wantsTypes],
    SnsDestination: { TopicArn: topicArn },
  }

  if (current) {
    await ses().send(
      new UpdateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: configSet,
        EventDestinationName: EVENT_DESTINATION_NAME,
        EventDestination,
      }),
    )
    logInfo('ses bounce setup: updated event destination', { configSet, topicArn })
    return { configured: true, topicArn, eventDestinationName: EVENT_DESTINATION_NAME, action: 'updated' }
  }

  await ses().send(
    new CreateConfigurationSetEventDestinationCommand({
      ConfigurationSetName: configSet,
      EventDestinationName: EVENT_DESTINATION_NAME,
      EventDestination,
    }),
  )
  logInfo('ses bounce setup: created event destination', { configSet, topicArn })
  return { configured: true, topicArn, eventDestinationName: EVENT_DESTINATION_NAME, action: 'created' }
}

// Runs once, 15s after boot (after the SES probe) — idempotent, so a
// redeploy just confirms it's still wired rather than fighting the config
// set. Silent until SES_SNS_TOPIC_ARN exists; once it does, this is what
// actually turns the wiring on without anyone needing to hit the admin
// button.
export function scheduleBoot(): void {
  setTimeout(() => {
    void ensureSesBounceEventDestination()
      .then((status) => {
        if (!status.configured) {
          logInfo('ses bounce setup: not wired yet', { reason: status.reason })
          return
        }
        logInfo('ses bounce setup: event destination confirmed', status)
      })
      .catch((err) => {
        logError('ses bounce setup: failed', { error: err instanceof Error ? err.message : String(err) })
      })
  }, 16_000).unref()
}
