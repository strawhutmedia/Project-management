// Resend-compatible Amazon SES transport for Slate's transactional email.
//
// Drop-in for `import { Resend } from 'resend'` on the `.emails.send(...)` path
// (magic-link sign-ins, invites, admin alerts, invoices, outreach follow-ups).
// Routes to Amazon SES when SES credentials are present; otherwise delegates to
// the real `resend` package. Reversible: with no SES env vars set, behavior is
// exactly as before. Sends carry SES message tags (app=slate + any caller tags)
// so email stays categorized after the move off Resend.
//
// Only the transactional send path is handled here. Resend's Audiences /
// Contacts APIs (server/audience_resend.ts) have no SES equivalent and keep
// importing the real `resend` package; they already no-op when the key is unset.
import { Resend as RealResend } from 'resend'
import { SESv2Client, SendEmailCommand, GetAccountCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2'

export function sesConfigured(): boolean {
  return Boolean(
    (process.env.SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) &&
      (process.env.SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY),
  )
}

// A brand-new (or not-yet-approved) SES account is SANDBOXED — it can only
// deliver to individually verified addresses, so magic links, admin
// alerts, and invoices to real people would silently fail to send while
// this app quietly believes it's on SES. See boot_ses_probe.ts, which
// logs this on every boot so that state is visible without hitting the
// AWS console.
export type SesAccountStatus =
  | { ok: true; productionAccessEnabled: boolean; sendingEnabled: boolean }
  | { ok: false; error: string }

export async function sesAccountStatus(): Promise<SesAccountStatus> {
  try {
    const a = await ses().send(new GetAccountCommand({}))
    return {
      ok: true,
      productionAccessEnabled: Boolean(a.ProductionAccessEnabled),
      sendingEnabled: Boolean(a.SendingEnabled),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// SES requires the FROM domain of every send to be independently verified
// as its own SES identity (DKIM records) — completely separate from
// account-level production access above, AND separate from Resend's own
// domain verification that Slate's sending_domains.status actually tracks.
// A domain can show status='verified' in Slate (verified in Resend) while
// being unverified in SES, in which case a send FROM it over this SES
// transport fails outright. See boot_ses_probe.ts, which checks every
// domain in Slate's outreach rotation pool against this.
export type SesIdentityCheck =
  | { domain: string; ok: true; verifiedForSending: boolean; dkimVerified: boolean }
  | { domain: string; ok: false; error: string }

export async function sesCheckIdentity(domain: string): Promise<SesIdentityCheck> {
  try {
    const out = await ses().send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
    return {
      domain,
      ok: true,
      verifiedForSending: Boolean(out.VerifiedForSendingStatus),
      dkimVerified: out.DkimAttributes?.Status === 'SUCCESS',
    }
  } catch (err) {
    // NotFoundException means the domain was never added as an SES identity at all —
    // the expected/common case for a rotation domain that only exists in Resend.
    return { domain, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

let sesClient: SESv2Client | null = null
function ses(): SESv2Client {
  if (sesClient) return sesClient
  sesClient = new SESv2Client({
    region: process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: (process.env.SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) as string,
      secretAccessKey: (process.env.SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY) as string,
    },
  })
  return sesClient
}

const cleanTag = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'na'

type SendPayload = {
  from: string
  to: string | string[]
  subject?: string
  html?: string
  text?: string
  replyTo?: string | string[]
  reply_to?: string | string[]
  tags?: Array<{ name: string; value: string }>
  // Extra message headers (e.g. List-Unsubscribe for a bulk/fan send).
  // Object form {Name: Value} — real Resend accepts this shape too.
  headers?: Record<string, string>
  [k: string]: unknown
}

type SendResult = {
  data: { id: string } | null
  error: { name?: string; message: string } | null
}

export class Resend {
  private real: RealResend | null
  constructor(apiKey?: string) {
    this.real = apiKey ? new RealResend(apiKey) : null
  }

  emails = {
    send: async (payload: SendPayload): Promise<SendResult> => {
      if (sesConfigured()) {
        try {
          const to = (Array.isArray(payload.to) ? payload.to : [payload.to]).filter(Boolean) as string[]
          const replyRaw = payload.replyTo ?? payload.reply_to
          const reply = replyRaw ? (Array.isArray(replyRaw) ? replyRaw : [replyRaw]) : undefined
          const tags: Array<{ Name: string; Value: string }> = [{ Name: 'app', Value: 'slate' }]
          for (const t of Array.isArray(payload.tags) ? payload.tags : []) {
            if (t && t.name) tags.push({ Name: cleanTag(t.name), Value: cleanTag(t.value) })
          }
          const headers = payload.headers
            ? Object.entries(payload.headers).map(([Name, Value]) => ({ Name, Value }))
            : undefined
          const out = await ses().send(
            new SendEmailCommand({
              FromEmailAddress: payload.from,
              Destination: { ToAddresses: to },
              ...(reply ? { ReplyToAddresses: reply } : {}),
              ...(process.env.SES_CONFIG_SET ? { ConfigurationSetName: process.env.SES_CONFIG_SET } : {}),
              EmailTags: tags,
              Content: {
                Simple: {
                  Subject: { Data: payload.subject || '', Charset: 'UTF-8' },
                  Body: {
                    ...(payload.html ? { Html: { Data: payload.html, Charset: 'UTF-8' } } : {}),
                    ...(payload.text ? { Text: { Data: payload.text, Charset: 'UTF-8' } } : {}),
                  },
                  ...(headers ? { Headers: headers } : {}),
                },
              },
            }),
          )
          return { data: { id: out.MessageId || '' }, error: null }
        } catch (err: unknown) {
          const e = err as { name?: string; message?: string }
          return { data: null, error: { name: e?.name || 'ses_error', message: e?.message || String(err) } }
        }
      }
      if (!this.real) return { data: null, error: { message: 'no email transport configured' } }
      const r = await this.real.emails.send(payload as Parameters<RealResend['emails']['send']>[0])
      return r as unknown as SendResult
    },
  }

  // Domain / audience / contact management have no Amazon SES equivalent, so they
  // delegate to the real Resend when a key is present, and no-op safely when it is
  // not (removing RESEND_API_KEY degrades these features instead of throwing).
  private stub(): unknown {
    const noop = async () => ({
      data: null,
      error: { message: 'feature unavailable: RESEND_API_KEY not set (Amazon SES has no equivalent)' },
    })
    return new Proxy({}, { get: () => noop })
  }
  get domains(): RealResend['domains'] {
    return (this.real ? this.real.domains : this.stub()) as RealResend['domains']
  }
  get audiences(): RealResend['audiences'] {
    return (this.real ? this.real.audiences : this.stub()) as RealResend['audiences']
  }
  get contacts(): RealResend['contacts'] {
    return (this.real ? this.real.contacts : this.stub()) as RealResend['contacts']
  }
}
