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
//   SES_REGION            region the SES identity lives in (falls back to AWS_REGION)
//   SES_ACCESS_KEY_ID     dedicated SES IAM key (falls back to AWS_ACCESS_KEY_ID)
//   SES_SECRET_ACCESS_KEY  "         (falls back to AWS_SECRET_ACCESS_KEY)
//   SES_REPLY_TO          optional, defaults to hello@strawhutmedia.com
//   SES_CONFIG_SET        optional SES configuration set name (bounce/complaint tracking)
//
// SES creds are kept SEPARATE from the AWS_* keys the Megaphone S3 export uses,
// so a newsletter key can't affect (or be affected by) the analytics pipeline —
// but they fall back to AWS_* if the dedicated ones aren't set.
//
// The sending domain (strawhutmedia.com) must be verified in SES and the
// account moved OUT of the SES sandbox (one-time AWS approval) before mail to
// unverified recipients is delivered. Until then SES only mails verified addrs.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const REPLY_TO = process.env.SES_REPLY_TO || 'hello@strawhutmedia.com';

function sesKeyId() {
  return process.env.SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
}
function sesSecret() {
  return process.env.SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
}

let _client = null;
function client() {
  if (_client) return _client;
  const region = process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1';
  // Only pass explicit dedicated creds; if unset, let the SDK use the ambient
  // AWS_* env so nothing changes for existing single-key setups.
  const credentials =
    process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.SES_ACCESS_KEY_ID, secretAccessKey: process.env.SES_SECRET_ACCESS_KEY }
      : undefined;
  _client = new SESv2Client({ region, ...(credentials ? { credentials } : {}) });
  return _client;
}

/** True when SES is configured enough to send. */
export function sesConfigured() {
  return !!(process.env.SES_FROM && sesKeyId() && sesSecret());
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
  for (let attempt = 0; ; attempt++) {
    const r = await sesSendOnce({ to, subject, html, text, headers, replyTo });
    if (r.ok || !r.throttled || attempt >= 4) return r;
    // Exponential backoff on rate-limit: 0.5s, 1s, 2s, 4s.
    await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
  }
}

async function sesSendOnce({ to, subject, html, text, headers, replyTo }) {
  const THROTTLES = new Set(['ThrottlingException', 'TooManyRequestsException', 'Throttling', 'LimitExceededException']);
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
    return { ok: false, error: e.message || String(e), throttled: THROTTLES.has(e.name) };
  }
}
