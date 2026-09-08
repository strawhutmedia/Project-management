// Boot-time diagnostic: checks whatever SES credentials are set on this
// Railway service and logs the one fact that decides whether it's safe to
// rely on — sandbox vs production access. A sandboxed SES account only
// delivers to individually verified addresses; sending magic links, admin
// alerts, or contractor invoices while sandboxed silently fails for almost
// everyone. This makes that state visible in the status branch / /api/_diag
// on every boot, the same way boot_resend_probe.ts does for Resend.
import { logError, logInfo } from './diag'
import { sesAccountStatus, sesConfigured } from './mailTransport'

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
}
