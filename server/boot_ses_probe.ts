// Boot-time diagnostic: checks whatever SES credentials are set on this
// Railway service and logs the one fact that decides whether it's safe to
// rely on — sandbox vs production access. A sandboxed SES account only
// delivers to individually verified addresses; sending magic links, admin
// alerts, or contractor invoices while sandboxed silently fails for almost
// everyone. This makes that state visible in the status branch / /api/_diag
// on every boot, the same way boot_resend_probe.ts does for Resend.
import { pool } from './db'
import { logError, logInfo } from './diag'
import { sesAccountStatus, sesCheckIdentity, sesConfigured } from './mailTransport'

export function scheduleBootSesProbe(): void {
  // 13 seconds after boot — same lane as the Resend probe (12s), one
  // second apart so their log lines don't interleave.
  setTimeout(() => {
    void probeSes()
  }, 13_000).unref()
}

async function probeSes(): Promise<void> {
  if (!sesConfigured()) {
    logInfo('ses probe: skipped — SES not configured (SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY unset)')
    return
  }
  logInfo('ses probe: starting')
  const status = await sesAccountStatus()
  if (!status.ok) {
    logError('ses probe: GetAccount failed — credentials invalid or unreachable', { error: status.error })
    return
  }
  if (!status.productionAccessEnabled) {
    logError('ses probe: SES account is still SANDBOXED', {
      productionAccessEnabled: status.productionAccessEnabled,
      sendingEnabled: status.sendingEnabled,
      diagnosis:
        'This SES account can only deliver to individually verified email addresses. ' +
        'Magic links, admin alerts, and invoices to real recipients will silently fail to send. ' +
        'Request production access in the AWS SES console before relying on this for real traffic.',
    })
    return
  }
  if (!status.sendingEnabled) {
    logError('ses probe: SES sending is DISABLED on this account', status)
    return
  }
  logInfo('ses probe: production access confirmed, sending enabled', status)

  // Account-level access is necessary but NOT sufficient: every FROM
  // domain also has to be independently verified as its own SES identity
  // (DKIM). Slate's outreach rotation pool (sending_domains) tracks
  // RESEND verification, not SES — a domain can be 'verified' in Slate
  // and still be completely unverified in SES, in which case a real
  // outreach campaign would queue fine and then fail to actually send.
  // Check every domain Slate would actually route mail through.
  await probeSendingDomains()
}

async function probeSendingDomains(): Promise<void> {
  const { rows } = await pool.query<{ name: string; status: string; active: boolean }>(
    `SELECT name, status, active FROM sending_domains ORDER BY created_at ASC`,
  )
  // Also check the domain Slate's own transactional mail sends from
  // (magic links, admin alerts, invites) — MAIL_FROM, or its default.
  const systemFrom = (process.env.MAIL_FROM || 'slate@strawhutmedia.net').match(/@([^\s>]+)/)?.[1]
  const domains = Array.from(new Set([...rows.map((r) => r.name), ...(systemFrom ? [systemFrom] : [])]))
  if (domains.length === 0) {
    logInfo('ses probe: no sending_domains rows to check')
    return
  }

  const results = await Promise.all(domains.map((d) => sesCheckIdentity(d)))
  const notInSes = results.filter((r) => !r.ok)
  const unverifiedInSes = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok && !r.verifiedForSending)
  const verified = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok && r.verifiedForSending)

  if (notInSes.length === 0 && unverifiedInSes.length === 0) {
    logInfo('ses probe: all sending domains verified in SES', {
      domains: verified.map((r) => ({ domain: r.domain, dkimVerified: r.dkimVerified })),
    })
    return
  }

  logError('ses probe: sending domain(s) NOT ready in SES — sends from these will fail over SES even though Slate may show them as verified (that column tracks Resend, not SES)', {
    verifiedInSes: verified.map((r) => r.domain),
    notAddedToSes: notInSes.map((r) => r.domain),
    addedButNotVerifiedInSes: unverifiedInSes.map((r) => r.domain),
    diagnosis:
      'Add + verify each missing domain in the AWS SES console (or via CreateEmailIdentity) before relying on ' +
      'the outreach rotation pool over SES. Until then, either keep RESEND_API_KEY as the working fallback for ' +
      'these domains, or expect real campaign sends to fail for anyone routed to an unverified one.',
  })
}
