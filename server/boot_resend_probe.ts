// Boot-time diagnostic: hits Resend's /domains endpoint with whatever
// RESEND_API_KEY is set on this Railway service and logs exactly what
// the key can see. Purpose: cut through the "Slate says verified but
// Resend rejects it" confusion — the answer is always one of:
//   - key belongs to a different Resend account
//   - key is scoped ("Sending access") to specific domains only
//   - key is invalid
// The list is written to logInfo so it lands in the status branch's
// recentLog block on next boot, viewable without any UI clicks.

import { Resend } from 'resend'
import { pool } from './db'
import { logError, logInfo } from './diag'

const resendKey = process.env.RESEND_API_KEY
const resend = resendKey ? new Resend(resendKey) : null

export function scheduleBootResendProbe(): void {
  // 12 seconds after boot — after the flagship seed (8s) and the RSS
  // cover sync (5s), so we don't compete for the request lane.
  setTimeout(() => {
    void probeResend()
  }, 12_000).unref()
}

async function probeResend(): Promise<void> {
  if (!resend) {
    logInfo('resend probe: skipped — RESEND_API_KEY not set')
    return
  }
  logInfo('resend probe: starting', {
    keyPrefix: resendKey ? `${resendKey.slice(0, 6)}…${resendKey.slice(-4)}` : null,
    mailFrom: process.env.MAIL_FROM || '(default: Slate <slate@strawhutmedia.com>)',
  })
  try {
    const list = await resend.domains.list()
    if (list.error) {
      logError('resend probe: domains.list returned error', {
        errorName: (list.error as { name?: string }).name,
        errorMessage: (list.error as { message?: string }).message,
      })
      return
    }
    // SDK returns either {data: [...]} or an array depending on version.
    const raw = list.data as unknown
    const domains = Array.isArray(raw)
      ? (raw as Array<{ name: string; status: string; region?: string }>)
      : ((raw as { data?: Array<{ name: string; status: string; region?: string }> })?.data ?? [])

    logInfo('resend probe: domains.list ok', {
      count: domains.length,
      domains: domains.map((d) => ({ name: d.name, status: d.status, region: d.region ?? null })),
    })

    // Cross-reference with Slate's DB — flag any Slate sending_domains
    // rows that don't appear in Resend so this shows up in the log.
    const { rows: slateDomains } = await pool.query<{ name: string; status: string }>(
      `SELECT name, status FROM sending_domains ORDER BY created_at ASC`,
    )
    const resendNames = new Set(domains.map((d) => d.name.toLowerCase()))
    const missing = slateDomains
      .filter((s) => !resendNames.has(s.name.toLowerCase()))
      .map((s) => s.name)
    if (missing.length > 0) {
      logError('resend probe: Slate domains missing from Resend key', {
        missing,
        diagnosis: 'This RESEND_API_KEY cannot see these domains. Either the key is scoped to a subset of your account, or it belongs to a different account/team than the one where these domains are verified.',
      })
    } else {
      logInfo('resend probe: all Slate domains visible to Resend key')
    }
  } catch (err) {
    logError('resend probe: threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
