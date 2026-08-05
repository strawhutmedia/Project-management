// Operations snapshot — a READ-ONLY mirror of the app's live operational state,
// published to the `status` branch as ops.json so Claude (and anyone reading the
// repo) can answer "what's actually going on in the app right now?" without a
// database connection or a signed-in session.
//
// This exists because the app runs on Railway with a private Postgres that
// build/agent environments can't reach. The `status` branch is the one channel
// that IS always readable, so we push the operational read-model there — the
// same pattern latest.json already uses for health.
//
// PRIVACY: full contact emails are NEVER written here. Emails are masked
// (a***@gmail.com) so someone can be recognized without the raw list leaking
// into git history. Everything here is derived, read-only, and non-reversible.

import { pool } from './db'
import { writeStatusFile, statusReportingEnabled } from './github'
import { logInfo } from './diag'

// Follow-up default must match the UI/endpoint default (FOLLOWUP_MIN_DAYS_DEFAULT
// in routes/outreach.ts): only nudge people whose first email is this old.
const FOLLOWUP_MIN_DAYS = 4
// Cap the per-show eligible list so ops.json stays small; note truncation.
const MAX_ELIGIBLE_PER_SHOW = 100

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const first = email[0]
  const domain = email.slice(at) // includes '@'
  return `${first}***${domain}`
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

type ShowOps = {
  projectId: string
  name: string
  outreach: {
    total: number
    needsEmail: number
    ready: number
    queued: number
    sent: number
    replied: number
    bounced: number
    optedOut: number
    failed: number
  }
  followup: {
    minDaysUsed: number
    eligibleNow: number
    queued: number
    alreadySent: number
    truncated: boolean
    // The actual people who'd get a follow-up right now — first name, when they
    // were first emailed, and whether they opened it. Masked email for ID.
    people: Array<{ name: string; emailMasked: string; daysSinceFirstEmail: number | null; opened: boolean; openCount: number }>
  }
  // Can Caroline actually send from this show right now? The three send gates,
  // reported so we can confirm "ready" instead of guessing.
  readiness: {
    canSend: boolean
    followupTemplateSaved: boolean
    oneSheetApproved: boolean
    hasVerifiedDomain: boolean
    verifiedDomains: string[]
    blockers: string[]
  }
  dataQuality: {
    duplicatedAddresses: number
    duplicateExtraRows: number
  }
  // Deliverability signal from the send log. attempts/accepted/bounced/etc are
  // what Resend reported. opensEver counts opens across ALL sends (real + test):
  // if that's 0 while accepted > 0, open-tracking is almost certainly OFF (so
  // "0 opens" is a blind spot, not proof nothing was seen), not a delivery
  // failure. bounced/failed > 0 is a real delivery problem.
  delivery: {
    attempts: number
    accepted: number
    bounced: number
    complained: number
    failed: number
    opensEver: number
    likelyOpenTrackingOff: boolean
  }
}

export async function collectOpsSnapshot() {
  // 1) Outreach funnel per show (only shows that actually have prospects).
  const funnel = await pool.query<{
    id: string; name: string; one_sheet_approved_at: string | null; total: number; needs_email: number; ready: number;
    queued: number; sent: number; replied: number; bounced: number; opted_out: number; failed: number;
  }>(
    `SELECT p.id, p.name, p.one_sheet_approved_at,
            COUNT(op.*)::int AS total,
            COUNT(*) FILTER (WHERE op.status = 'needs_email')::int AS needs_email,
            COUNT(*) FILTER (WHERE op.status = 'ready')::int      AS ready,
            COUNT(*) FILTER (WHERE op.status = 'queued')::int     AS queued,
            COUNT(*) FILTER (WHERE op.status = 'sent')::int       AS sent,
            COUNT(*) FILTER (WHERE op.status = 'replied')::int    AS replied,
            COUNT(*) FILTER (WHERE op.status = 'bounced')::int    AS bounced,
            COUNT(*) FILTER (WHERE op.status = 'opted_out')::int  AS opted_out,
            COUNT(*) FILTER (WHERE op.status = 'failed')::int     AS failed
       FROM projects p
       JOIN outreach_prospects op ON op.project_id = p.id
      GROUP BY p.id, p.name, p.one_sheet_approved_at
      ORDER BY p.name`,
  )

  // Follow-up template readiness per show.
  const tpls = await pool.query<{ project_id: string; followup_subject: string | null; followup_body: string | null }>(
    `SELECT project_id, followup_subject, followup_body FROM outreach_templates`,
  )
  const tplReady = new Map(tpls.rows.map((r) => [r.project_id, Boolean(r.followup_subject?.trim() && r.followup_body?.trim())]))

  // Verified + active sending domains (a global pool; any one can send, and the
  // send prefers a domain pinned to the show). Report names + any per-show pin.
  const doms = await pool.query<{ name: string; primary_show_id: string | null }>(
    `SELECT name, primary_show_id FROM sending_domains WHERE status = 'verified' AND active = TRUE ORDER BY created_at ASC`,
  )
  const allVerifiedDomains = doms.rows.map((r) => r.name)

  // Duplicate email addresses per show (same address on more than one prospect
  // row). Aggregate only — no addresses stored. duplicatedAddresses = how many
  // addresses repeat; extraRows = how many rows beyond the first (i.e. how many
  // duplicate sends a blast would cause).
  const dupes = await pool.query<{ project_id: string; duplicated_addresses: number; extra_rows: number }>(
    `SELECT project_id,
            COUNT(*)::int AS duplicated_addresses,
            COALESCE(SUM(n - 1), 0)::int AS extra_rows
       FROM (
         SELECT project_id, lower(email) AS email, COUNT(*) AS n
           FROM outreach_prospects
          WHERE email IS NOT NULL
          GROUP BY project_id, lower(email)
         HAVING COUNT(*) > 1
       ) g
      GROUP BY project_id`,
  )
  const dupeBy = new Map(dupes.rows.map((r) => [r.project_id, r]))

  // Deliverability from the send log (outreach_sends). Counts what Resend
  // reported per real send, plus total opens across ALL sends (incl. tests) so
  // we can tell "tracking is off" from "genuinely nobody opened".
  const deliv = await pool.query<{
    project_id: string; attempts: number; accepted: number; bounced: number;
    complained: number; failed: number; opens_ever: number;
  }>(
    `SELECT op.project_id,
            COUNT(*) FILTER (WHERE s.is_test = false)::int AS attempts,
            COUNT(*) FILTER (WHERE s.is_test = false AND s.status = 'sent')::int AS accepted,
            COUNT(*) FILTER (WHERE s.is_test = false AND s.status = 'bounced')::int AS bounced,
            COUNT(*) FILTER (WHERE s.is_test = false AND s.status = 'complained')::int AS complained,
            COUNT(*) FILTER (WHERE s.is_test = false AND s.status = 'failed')::int AS failed,
            COALESCE(SUM(s.open_count), 0)::int AS opens_ever
       FROM outreach_sends s
       JOIN outreach_prospects op ON op.id = s.prospect_id
      GROUP BY op.project_id`,
  )
  const delivBy = new Map(deliv.rows.map((r) => [r.project_id, r]))

  // 2) Follow-up status counts per show.
  const fCounts = await pool.query<{ project_id: string; followup_queued: number; followup_sent: number }>(
    `SELECT project_id,
            COUNT(*) FILTER (WHERE followup_scheduled_at IS NOT NULL AND followup_sent_at IS NULL)::int AS followup_queued,
            COUNT(*) FILTER (WHERE followup_sent_at IS NOT NULL)::int AS followup_sent
       FROM outreach_prospects
      GROUP BY project_id`,
  )
  const fCountBy = new Map(fCounts.rows.map((r) => [r.project_id, r]))

  // 3) The eligible-for-follow-up people, per show. Same predicate the sender
  //    uses: status='sent', never replied, has an email, not already followed
  //    up or queued, first email older than the default window.
  const elig = await pool.query<{
    project_id: string; name: string; email: string; sent_at: string; open_count: number; first_opened_at: string | null;
  }>(
    `SELECT project_id, name, email, sent_at, open_count, first_opened_at
       FROM outreach_prospects
      WHERE status = 'sent'
        AND replied_at IS NULL
        AND email IS NOT NULL
        AND followup_sent_at IS NULL
        AND followup_scheduled_at IS NULL
        AND sent_at IS NOT NULL
        AND sent_at <= now() - ($1 || ' days')::interval
      ORDER BY project_id, sent_at ASC`,
    [String(FOLLOWUP_MIN_DAYS)],
  )
  const eligBy = new Map<string, typeof elig.rows>()
  for (const r of elig.rows) {
    const arr = eligBy.get(r.project_id) ?? []
    arr.push(r)
    eligBy.set(r.project_id, arr)
  }

  const shows: ShowOps[] = funnel.rows.map((r) => {
    const fc = fCountBy.get(r.id)
    const people = eligBy.get(r.id) ?? []
    const capped = people.slice(0, MAX_ELIGIBLE_PER_SHOW)

    // Send readiness — the three gates the follow-up send endpoint enforces.
    // Domains that pin to this show come first in the list, then the rest of
    // the pool (any verified domain can send).
    const pinned = doms.rows.filter((d) => d.primary_show_id === r.id).map((d) => d.name)
    const showDomains = [...pinned, ...allVerifiedDomains.filter((n) => !pinned.includes(n))]
    const followupTemplateSaved = tplReady.get(r.id) ?? false
    const oneSheetApproved = Boolean(r.one_sheet_approved_at)
    const hasVerifiedDomain = allVerifiedDomains.length > 0
    const blockers: string[] = []
    if (!followupTemplateSaved) blockers.push('follow-up message not written/saved yet')
    if (!oneSheetApproved) blockers.push('one-sheet not approved')
    if (!hasVerifiedDomain) blockers.push('no verified sending domain')

    return {
      projectId: r.id,
      name: r.name,
      outreach: {
        total: r.total, needsEmail: r.needs_email, ready: r.ready, queued: r.queued,
        sent: r.sent, replied: r.replied, bounced: r.bounced, optedOut: r.opted_out, failed: r.failed,
      },
      followup: {
        minDaysUsed: FOLLOWUP_MIN_DAYS,
        eligibleNow: people.length,
        queued: fc?.followup_queued ?? 0,
        alreadySent: fc?.followup_sent ?? 0,
        truncated: people.length > capped.length,
        people: capped.map((p) => ({
          name: p.name,
          emailMasked: maskEmail(p.email),
          daysSinceFirstEmail: daysSince(p.sent_at),
          opened: Boolean(p.first_opened_at),
          openCount: p.open_count,
        })),
      },
      readiness: {
        canSend: blockers.length === 0,
        followupTemplateSaved,
        oneSheetApproved,
        hasVerifiedDomain,
        verifiedDomains: showDomains,
        blockers,
      },
      dataQuality: {
        duplicatedAddresses: dupeBy.get(r.id)?.duplicated_addresses ?? 0,
        duplicateExtraRows: dupeBy.get(r.id)?.extra_rows ?? 0,
      },
      delivery: {
        attempts: delivBy.get(r.id)?.attempts ?? 0,
        accepted: delivBy.get(r.id)?.accepted ?? 0,
        bounced: delivBy.get(r.id)?.bounced ?? 0,
        complained: delivBy.get(r.id)?.complained ?? 0,
        failed: delivBy.get(r.id)?.failed ?? 0,
        opensEver: delivBy.get(r.id)?.opens_ever ?? 0,
        likelyOpenTrackingOff: (delivBy.get(r.id)?.accepted ?? 0) > 0 && (delivBy.get(r.id)?.opens_ever ?? 0) === 0,
      },
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    note: 'Read-only operational snapshot. Emails are masked; no full contact list is stored here.',
    summary: {
      showsWithOutreach: shows.length,
      totalEligibleForFollowup: shows.reduce((n, s) => n + s.followup.eligibleNow, 0),
      totalFollowupQueued: shows.reduce((n, s) => n + s.followup.queued, 0),
      totalFollowupSent: shows.reduce((n, s) => n + s.followup.alreadySent, 0),
    },
    shows,
  }
}

// Publish ops.json to the status branch. Best-effort: never throws, never
// blocks boot. Called on boot and on the 5-minute scheduler tick.
export async function reportOps(): Promise<void> {
  if (!statusReportingEnabled()) return
  try {
    const snapshot = await collectOpsSnapshot()
    const result = await writeStatusFile('ops.json', JSON.stringify(snapshot, null, 2), 'ops: update ops.json')
    if (result.ok) {
      logInfo('ops snapshot reported', { shows: snapshot.summary.showsWithOutreach, eligible: snapshot.summary.totalEligibleForFollowup })
    } else {
      logInfo('ops snapshot write failed (non-fatal)', { error: result.error })
    }
  } catch (err) {
    logInfo('ops snapshot collect failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) })
  }
}
