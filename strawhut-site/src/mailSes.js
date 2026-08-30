// Bulk newsletter delivery via Amazon SES (SESv2 SendEmail).
//
// WHY SES: the site owns its own list and its own sending. No third-party
// newsletter dashboard, no per-account contact quota to trip over — SES bills
// per email (~$0.10 / 1,000) and scales to any list size. This module is the
// bulk transport; transactional mail (contact-form, lead, magic-link) stays on
// Resend in mail.js. mail.js#sendAnnouncement picks SES automatically whenever
// this module reports configured().
//
// CONFIG (Railway env on the strawhut-site service):
//   SES_FROM              e.g. "Straw Hut Media <newsletter@strawhutmedia.com>"
//   AWS_REGION            e.g. "us-east-1" (region the SES identity lives in)
//   AWS_ACCESS_KEY_ID     IAM user with ses:SendEmail
//   AWS_SECRET_ACCESS_KEY  "
//   SES_REPLY_TO          optional, defaults to hello@strawhutmedia.com
//   SES_CONFIG_SET        optional SES configuration set name (bounce/complaint tracking)
//
// The sending domain (strawhutmedia.com) must be verified in SES and the
// account moved OUT of the SES sandbox (one-time AWS approval) before mail to
// unverified recipients is delivered. Until then SES only mails verified addrs.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const REPLY_TO = process.env.SES_REPLY_TO || 'hello@strawhutmedia.com';

let _client = null;
function client() {
  if (_client) return _client;
  _client = new SESv2Client({ region: process.env.AWS_REGION || 'us-east-1' });
  return _client;
}

/** True when SES is configured enough to send. Creds are read from the standard
 *  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env by the SDK. */
export function sesConfigured() {
  return !!(process.env.SES_FROM && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export function sesFrom() {
  return process.env.SES_FROM || 'Straw Hut Media <newsletter@strawhutmedia.com>';
}

/**
 * Send one email via SES. `headers` is an optional [{Name,Value}] list — used to
 * attach List-Unsubscribe / List-Unsubscribe-Post for one-click unsubscribe,
 * which materially improves inbox placement on a bulk send.
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
export async function sesSendOne({ to, subject, html, text, headers = [], replyTo = REPLY_TO }) {
  try {
    const cmd = new SendEmailCommand({
      FromEmailAddress: sesFrom(),
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      ConfigurationSetName: process.env.SES_CONFIG_SET || undefined,
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
          },
          ...(headers.length ? { Headers: headers } : {}),
        },
      },
    });
    const out = await client().send(cmd);
    return { ok: true, id: out.MessageId };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
