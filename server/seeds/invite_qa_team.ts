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

// The 10 historical recordings seeded by migration 148 recorded their
// shooters as names in the old sheet, but shooter rows could only attach
// to users that existed when the migration ran. Re-attach on every boot
// (idempotent) so names land as soon as the matching account exists —
// Xavier now, Sullivan/Steven whenever they get accounts.
const SEEDED_SHOOTERS: Array<{ title: string; names: string[] }> = [
  { title: 'DBAWJK - Chris Collins & Griffin James', names: ['sullivan', 'xavier'] },
  { title: 'DBAWJK - Linwood Boomer', names: ['sullivan', 'xavier'] },
  { title: 'DBAWJK - INTRO FOR Barbara Heller', names: ['sullivan', 'xavier'] },
  { title: 'DBAWJK - Scott Thompson', names: ['sullivan'] },
  { title: 'Invest in Her - Tyne Daly and Eric Dyson', names: ['sullivan'] },
  { title: 'SHAPING FREEDOM - Tiffany Toney', names: ['xavier'] },
  { title: 'SHAPING FREEDOM - Paulette Brown Hinds, Kenneth B. Morris, Jr. & Teri', names: ['xavier'] },
  { title: 'SHAPING FREEDOM - Phill Branch', names: ['steven'] },
  { title: 'Invest in Her - Kathy', names: ['steven'] },
]

async function backfillSeededShooters(): Promise<void> {
  for (const row of SEEDED_SHOOTERS) {
    const likes = row.names.map((n) => `${n}%`)
    await pool.query(
      `INSERT INTO qa_recording_shooters (recording_id, user_id)
       SELECT r.id, u.id
         FROM qa_recordings r, users u
        WHERE r.title = $1
          AND COALESCE(u.display_name, u.name) ILIKE ANY ($2::text[])
       ON CONFLICT DO NOTHING`,
      [row.title, likes],
    )
  }
}

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
  try {
    await backfillSeededShooters()
  } catch (err) {
    logError('seed: QA shooter backfill failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
