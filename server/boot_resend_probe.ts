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
      ? (raw as Array<{ id: string; name: string; status: string; region?: string }>)
      : ((raw as { data?: Array<{ id: string; name: string; status: string; region?: string }> })?.data ?? [])

    logInfo('resend probe: domains.list ok', {
      count: domains.length,
      domains: domains.map((d) => ({ name: d.name, status: d.status, region: d.region ?? null })),
    })

    // Cross-reference with Slate's DB — flag any Slate sending_domains
    // rows that don't appear in Resend so this shows up in the log.
    // AUTO-FIX: Update domain statuses to match Resend's reality.
    const { rows: slateDomains } = await pool.query<{ id: string; name: string; status: string; resend_id: string | null }>(
      `SELECT id, name, status, resend_id FROM sending_domains ORDER BY created_at ASC`,
    )
    const resendByName = new Map(domains.map((d) => [d.name.toLowerCase(), d]))
    const missing: string[] = []
    let autoFixed = 0
    
    for (const slate of slateDomains) {
      const resendMatch = resendByName.get(slate.name.toLowerCase())
      
      if (!resendMatch) {
        // Domain in Slate but not visible in Resend — mark as pending
        missing.push(slate.name)
        if (slate.status !== 'pending') {
          await pool.query(
            `UPDATE sending_domains SET status = 'pending', updated_at = now() WHERE id = $1`,
            [slate.id],
          )
          autoFixed++
          logInfo('resend probe: auto-fixed domain status (not in Resend)', {
            domain: slate.name,
            oldStatus: slate.status,
            newStatus: 'pending',
          })
        }
      } else {
        // Map Resend status to Slate status
        let mapped: 'pending' | 'verifying' | 'verified' | 'failed'
        switch (resendMatch.status) {
          case 'verified':          mapped = 'verified'; break
          case 'pending':           mapped = 'verifying'; break
          case 'not_started':       mapped = 'pending'; break
          case 'failure':
          case 'temporary_failure': mapped = 'failed'; break
          default:                  mapped = 'pending'; break
        }
        
        // Auto-update if status or resend_id differs
        if (slate.status !== mapped || slate.resend_id !== resendMatch.id) {
          await pool.query(
            `UPDATE sending_domains SET status = $1, resend_id = $2, updated_at = now() WHERE id = $3`,
            [mapped, resendMatch.id, slate.id],
          )
          autoFixed++
          logInfo('resend probe: auto-fixed domain status', {
            domain: slate.name,
            oldStatus: slate.status,
            newStatus: mapped,
            resendStatus: resendMatch.status,
          })
        }
      }
    }
    
    if (missing.length > 0) {
      // Include what the key CAN see + the key fingerprint so this alert
      // is self-diagnosing: if `visibleToKey` lists other domains (e.g.
      // the Pod Booster domain) but not the missing ones, the missing
      // domains are verified under a DIFFERENT Resend team than this key
      // belongs to (an API key is bound to exactly one team). If
      // `visibleToKey` is empty, the key is invalid or has no domain
      // access. Fix: verify the missing domains in the SAME Resend team
      // the key lives in, or set RESEND_API_KEY to a full-access key from
      // the team where they're already verified.
      logError('resend probe: Slate domains missing from Resend key', {
        missing,
        visibleToKey: domains.map((d) => ({ name: d.name, status: d.status })),
        visibleCount: domains.length,
        keyFingerprint: resendKey ? `${resendKey.slice(0, 6)}…${resendKey.slice(-4)}` : null,
        diagnosis:
          domains.length === 0
            ? 'This RESEND_API_KEY sees ZERO domains — it is invalid, or has no domain access. Set RESEND_API_KEY to a Full-access key from the Resend team where these domains are verified.'
            : 'This RESEND_API_KEY can see the domains listed in visibleToKey but NOT the missing ones — so the missing domains are verified under a DIFFERENT Resend team/account than this key belongs to (a key is bound to one team). Fix: verify the missing domains in the same team this key lives in, OR set RESEND_API_KEY to a full-access key from the team where they are already verified.',
      })
    }
    
    if (autoFixed > 0) {
      logInfo('resend probe: auto-fixed domain statuses', { count: autoFixed })
    } else {
      logInfo('resend probe: all Slate domains in sync with Resend')
    }
  } catch (err) {
    logError('resend probe: threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
