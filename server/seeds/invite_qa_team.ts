// Boot seed (Sept 2026): create the studio/QA crew accounts Ryan asked
// for — Xavier (studio manager), Riley Freedman and Blake Beeler (interns)
// — and add them to every podcast project so the Production QA tab (and
// its shooter/approver pickers) can carry their names.
//
// Same shape as invite_madeline: idempotent, invite email fires only the
// first time each user is created, membership top-ups are safe to re-run
// on every deploy, and a failure never blocks boot.

import { pool } from '../db'
import { sendInviteEmail } from '../email'
import { logError, logInfo } from '../diag'

const PEOPLE: Array<{ email: string; name: string; display: string }> = [
  { email: 'xavier@strawhutmedia.com', name: 'Xavier', display: 'Xavier' },
  { email: 'riley@strawhutmedia.com', name: 'Riley Freedman', display: 'Riley' },
  { email: 'blake@strawhutmedia.com', name: 'Blake Beeler', display: 'Blake' },
]

export async function seedQaTeamInvites(): Promise<void> {
  for (const person of PEOPLE) {
    try {
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
        [person.email],
      )
      let userId: string
      const isNew = existing.rows.length === 0
      if (isNew) {
        const created = await pool.query<{ id: string }>(
          `INSERT INTO users (email, name, display_name, role, timezone)
           VALUES ($1, $2, $3, 'user', 'America/Los_Angeles')
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [person.email, person.name, person.display],
        )
        userId = created.rows[0].id
      } else {
        userId = existing.rows[0].id
      }

      // Studio crew shoot across the whole slate, so membership on every
      // podcast project (which is also what unlocks the QA tab).
      const { rowCount } = await pool.query(
        `INSERT INTO project_members (project_id, user_id)
         SELECT p.id, $1 FROM projects p WHERE p.kind = 'podcast'
         ON CONFLICT DO NOTHING`,
        [userId],
      )

      if (isNew) {
        await sendInviteEmail(person.email, person.display, 'Ryan')
        logInfo('seed: QA team member invited', {
          email: person.email,
          addedToProjects: rowCount ?? 0,
        })
      } else if ((rowCount ?? 0) > 0) {
        logInfo('seed: QA team memberships topped up', {
          email: person.email,
          added: rowCount,
        })
      }
    } catch (err) {
      logError('seed: QA team invite failed', {
        email: person.email,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
