// Sync captured audience contacts into per-show Resend audiences, so
// the list is immediately usable for broadcasts from the Resend
// dashboard (unsubscribe handling included) without a CSV round-trip.
//
// Best-effort: capture NEVER fails because Resend is down — the contact
// row in audience_contacts is the source of truth, resend_synced_at
// records whether the mirror worked, and unsynced rows can be re-pushed
// later (they're visible in the UI as pending).

import { Resend } from 'resend'
import { pool } from './db'
import { logError, logInfo } from './diag'

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

// Get the show's Resend audience id, creating the audience on first
// use. Guarded against a double-create race: only the writer that wins
// the NULL→id UPDATE keeps its audience; a loser re-reads and uses the
// winner's id (the orphan audience stays empty and harmless in Resend).
async function ensureAudienceId(projectId: string): Promise<string | null> {
  if (!resend) return null
  const { rows } = await pool.query<{ name: string; resend_audience_id: string | null }>(
    `SELECT name, resend_audience_id FROM projects WHERE id = $1`,
    [projectId],
  )
  if (rows.length === 0) return null
  if (rows[0].resend_audience_id) return rows[0].resend_audience_id

  const created = await resend.audiences.create({ name: `Slate — ${rows[0].name}` })
  if (created.error || !created.data) {
    logError('audience: resend audience create failed', {
      projectId, error: created.error?.message ?? 'no data',
    })
    return null
  }
  const claimed = await pool.query(
    `UPDATE projects SET resend_audience_id = $2
      WHERE id = $1 AND resend_audience_id IS NULL`,
    [projectId, created.data.id],
  )
  if ((claimed.rowCount ?? 0) > 0) return created.data.id
  const reread = await pool.query<{ resend_audience_id: string | null }>(
    `SELECT resend_audience_id FROM projects WHERE id = $1`, [projectId],
  )
  return reread.rows[0]?.resend_audience_id ?? null
}

export async function syncContactToResend(args: {
  projectId: string
  contactId: string
  email: string
  name?: string | null
}): Promise<void> {
  if (!resend) return
  try {
    const audienceId = await ensureAudienceId(args.projectId)
    if (!audienceId) return
    const parts = (args.name ?? '').trim().split(/\s+/).filter(Boolean)
    const result = await resend.contacts.create({
      audienceId,
      email: args.email,
      firstName: parts[0] || undefined,
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
      unsubscribed: false,
    })
    // A duplicate-contact error still means the email is in the
    // audience — treat as synced.
    if (result.error && !/exists|duplicate/i.test(result.error.message ?? '')) {
      logError('audience: resend contact create failed', {
        projectId: args.projectId, error: result.error.message,
      })
      return
    }
    await pool.query(
      `UPDATE audience_contacts SET resend_synced_at = now() WHERE id = $1`,
      [args.contactId],
    )
  } catch (err) {
    logError('audience: resend sync failed', {
      projectId: args.projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Re-push every unsynced contact for a project (manual retry from UI).
export async function resyncProject(projectId: string): Promise<number> {
  const { rows } = await pool.query<{ id: string; email: string; name: string | null }>(
    `SELECT id, email, name FROM audience_contacts
      WHERE project_id = $1 AND resend_synced_at IS NULL AND unsubscribed_at IS NULL
      ORDER BY created_at LIMIT 200`,
    [projectId],
  )
  for (const r of rows) {
    await syncContactToResend({ projectId, contactId: r.id, email: r.email, name: r.name })
  }
  if (rows.length > 0) logInfo('audience: resync pushed', { projectId, count: rows.length })
  return rows.length
}
