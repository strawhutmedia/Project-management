// One-off boot seed: create Madeline (social media / copy intern) and
// invite her to every podcast project.
//
// Ryan asked for this invite to go out ASAP (Aug 2026) — shipping it as
// a boot seed follows the same pattern as the other seeds and means the
// invite email fires on the next Railway deploy without anyone having
// to click through the admin panel.
//
// Idempotent: if the user already exists we only top up her podcast
// memberships (covering shows created after she joined is NOT done here
// — admins add her to new shows like any other user) and never re-send
// the invite email. Safe to leave in place across deploys.

import { pool } from '../db'
import { sendInviteEmail } from '../email'
import { logError, logInfo } from '../diag'

const EMAIL = 'madeline@strawhutmedia.com'
const NAME = 'Madeline'

export async function seedMadelineInvite(): Promise<void> {
  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [EMAIL],
    )
    let userId: string
    const isNew = existing.rows.length === 0
    if (isNew) {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO users (email, name, display_name, role, timezone)
         VALUES ($1, $2, $2, 'user', 'America/Los_Angeles')
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [EMAIL, NAME],
      )
      userId = created.rows[0].id
    } else {
      userId = existing.rows[0].id
    }

    // She's helping with copy + social media across the podcast slate,
    // so membership on every podcast project.
    const { rowCount } = await pool.query(
      `INSERT INTO project_members (project_id, user_id)
       SELECT p.id, $1 FROM projects p WHERE p.kind = 'podcast'
       ON CONFLICT DO NOTHING`,
      [userId],
    )

    if (isNew) {
      await sendInviteEmail(EMAIL, NAME, 'Ryan')
      logInfo('seed: Madeline invited', { addedToProjects: rowCount ?? 0 })
    } else if ((rowCount ?? 0) > 0) {
      logInfo('seed: Madeline memberships topped up', { added: rowCount })
    }
  } catch (err) {
    // Seed failures must never block boot.
    logError('seed: Madeline invite failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
