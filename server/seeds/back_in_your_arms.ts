// Auto-seeds the "Back in Your Arms" film project on boot.
// Idempotent: skipped if the project already exists.
//
// Includes:
//   - Project (kind=film, owner=Ryan)
//   - Budget with caps ($700k total, $500k production, $150k post, $50k marketing)
//   - StudioBinder budget accounts + line items (via STUDIOBINDER_ACCOUNTS)
//   - 21 shoot days (with breaks at 5, 10, 15 per the 6-on-1-off cadence)
//   - Scene-to-day assignments (applied after .fdx import via separate
//     applyBackInYourArmsSchedule helper)
//
// The .fdx itself is uploaded by the admin via the Stripboard UI; we don't
// embed the script content in the codebase.

import { pool } from '../db'
import { STUDIOBINDER_ACCOUNTS } from '../budget_template'
import { logInfo, logError } from '../diag'

// Ryan's StudioBinder schedule, scene-number → shoot-day-number.
// Used by applyBackInYourArmsSchedule() after the .fdx is uploaded.
export const BIYA_SCHEDULE: Record<string, number> = {
  // Day 1 — Kendrick's house break-in sequence
  '69': 1, '70': 1, '71': 1, '72': 1, '73': 1, '74': 1, '75': 1, '76': 1, '77': 1, '78': 1, '79': 1,
  // Day 2 — Stakeout/spy day at Kendrick's house
  '43': 2, '45': 2, '47': 2, '51': 2, '57': 2, '63': 2, '64': 2, '66': 2,
  '80': 2, '81': 2, '82': 2, '117': 2, '118': 2, '122': 2, '127': 2,
  // Day 3 — Opening seq + dinner with Lilly + Alex
  '1': 3, '119': 3, '120': 3,
  // Day 4 — Stab night
  '128': 4, '130': 4, '129': 4, '131': 4, '132': 4, '133': 4, '134': 4, '135': 4, '136': 4,
  // Day 5 — BREAK
  // Day 6 — Solvang house interior batch
  '110': 6, '111': 6, '112': 6, '37': 6, '38': 6, '40': 6, '53': 6, '67': 6, '83': 6,
  '86': 6, '87': 6, '95': 6, '97': 6, '107': 6, '89': 6, '101': 6, '108': 6,
  // Day 7 — Solvang house pickup + Sawyer's move-in
  '126': 7, '113': 7, '121': 7, '123': 7, '149': 7, '150': 7, '151': 7, '152': 7, '36': 7,
  // Day 8 — Solvang night corkboard scenes
  '42': 8, '44': 8, '46': 8, '49': 8, '50': 8, '65': 8, '92': 8, '91': 8,
  // Day 9 — Solvang night batch (Aaron dinner, post-vibrator)
  '93': 9, '96': 9, '94': 9, '98': 9, '100': 9, '105': 9, '106': 9, '114': 9, '115': 9,
  // Day 10 — BREAK
  // Day 11 — Trail + Anna car arrival
  '144': 11, '146': 11, '147': 11, '54': 11, '88': 11, '90': 11, '109': 11, '145': 11,
  // Day 12 — Coffee shop + Solvang downtown
  '84': 12, '55': 12, '85': 12, '99': 12, '58': 12, '56': 12,
  // Day 13 — Liquor store + Sawyer driving + Boutique
  '39': 13, '52': 13, '34': 13, '35': 13, '41': 13, '153': 13, '102': 13, '116': 13, '48': 13,
  // Day 14 — Mall + parking lot
  '59': 14, '60': 14, '61': 14, '62': 14, '104': 14,
  // Day 15 — BREAK / pickup
  '124A': 15,
  // Day 16 — Justine intercut + Dayanet + YMCA + Bar Solvang
  '124B': 16, '2': 16, '3': 16, '14': 16, '103': 16,
  // Day 17 — Sawyer's Minneapolis apartment day block
  '32A': 17, '26': 17, '33': 17, '8': 17, '9': 17, '10': 17, '11': 17, '12': 17,
  '25': 17, '31': 17, '17': 17, '30': 17, '32': 17,
  // Day 18 — Sawyer's Minneapolis apartment night block
  '7': 18, '13': 18, '16': 18, '20': 18, '24': 18, '15': 18, '150A': 18, '23': 18,
  // Day 19 — Justine & Tom's house family scenes + intercut
  '149A': 19, '155': 19, '4': 19, '5': 19, '6': 19, '153A': 19, '18': 19, '19': 19, '68': 19, '124': 19,
  // Day 20 — Hospital block + Bar Minneapolis + Goodwill + driving
  '21': 20, '159': 20, '158': 20, '142': 20, '137': 20, '138': 20, '139': 20,
  '140': 20, '141': 20, '143': 20, '27': 20, '28': 20,
  // Day 21 — Wrap on the Anna reunion
  '29': 21, '156': 21, '157': 21, '160': 21, '161': 21,
}

const BREAK_DAYS = [5, 10, 15]

export async function seedBackInYourArms(): Promise<void> {
  try {
    const ryan = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      ['ryan@strawhutmedia.com'],
    )
    if (ryan.rows.length === 0) {
      logInfo('BIYA seed: ryan@strawhutmedia.com not found, skipping')
      return
    }
    const ryanId = ryan.rows[0].id

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM projects WHERE name = $1`,
      ['Back in Your Arms'],
    )
    if (existing.rows.length > 0) {
      // Project exists. Make sure budget targets are up to date in case
      // we tweaked them in code, and make sure all 21 shoot days exist.
      const projId = existing.rows[0].id
      await ensureShootDays(projId)
      logInfo('BIYA seed: project already exists, ensured shoot days', { projectId: projId })
      return
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Project
      const proj = await client.query<{ id: string }>(
        `INSERT INTO projects (name, kind, created_by, subtitle)
         VALUES ($1, 'film', $2, $3) RETURNING id`,
        [
          'Back in Your Arms',
          ryanId,
          'Indie psychological drama feature · Written by Stephen Markley · 18-day shoot',
        ],
      )
      const projId = proj.rows[0].id
      await client.query(
        `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [projId, ryanId],
      )

      // Budget with caps
      const budget = await client.query<{ id: string }>(
        `INSERT INTO budgets (
           project_id, currency, shoot_days, bond_pct, contingency_pct, created_by,
           production_target, post_target, marketing_target, total_target
         )
         VALUES ($1, 'USD', 18, 3, 10, $2, 500000, 150000, 50000, 700000)
         RETURNING id`,
        [projId, ryanId],
      )
      const budgetId = budget.rows[0].id

      // StudioBinder accounts + line items
      let accountPos = 0
      for (const acc of STUDIOBINDER_ACCOUNTS) {
        accountPos += 10
        const accRes = await client.query<{ id: string }>(
          `INSERT INTO budget_accounts (budget_id, code, name, category, position)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [budgetId, acc.code, acc.name, acc.category, accountPos],
        )
        const accId = accRes.rows[0].id
        let liPos = 0
        for (const li of acc.lineItems ?? []) {
          liPos += 10
          await client.query(
            `INSERT INTO budget_line_items (account_id, code, description, amt, x, rate, position, created_by)
             VALUES ($1, $2, $3, 0, 1, 0, $4, $5)`,
            [accId, li.code, li.description, liPos, ryanId],
          )
        }
      }

      // 21 shoot days
      for (let i = 1; i <= 21; i++) {
        await client.query(
          `INSERT INTO shoot_days (project_id, number, is_break) VALUES ($1, $2, $3)`,
          [projId, i, BREAK_DAYS.includes(i)],
        )
      }

      await client.query('COMMIT')
      logInfo('BIYA seed: created project + budget + 21 shoot days', {
        projectId: projId,
        budgetId,
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    logError('BIYA seed failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

async function ensureShootDays(projectId: string): Promise<void> {
  for (let i = 1; i <= 21; i++) {
    await pool.query(
      `INSERT INTO shoot_days (project_id, number, is_break)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, number) DO NOTHING`,
      [projectId, i, BREAK_DAYS.includes(i)],
    )
  }
}

// Apply Ryan's StudioBinder schedule to scenes after .fdx upload.
// Maps each scene number to its scheduled shoot day. Returns count of
// scenes successfully assigned.
export async function applyBackInYourArmsSchedule(projectId: string): Promise<{ assigned: number; missing: string[] }> {
  const days = await pool.query<{ id: string; number: number }>(
    `SELECT id, number FROM shoot_days WHERE project_id = $1`,
    [projectId],
  )
  const dayByNumber = new Map<number, string>()
  for (const d of days.rows) dayByNumber.set(d.number, d.id)

  const scenes = await pool.query<{ id: string; number: string }>(
    `SELECT id, number FROM scenes WHERE project_id = $1`,
    [projectId],
  )
  const sceneByNumber = new Map<string, string>()
  for (const s of scenes.rows) sceneByNumber.set(s.number, s.id)

  let assigned = 0
  const missing: string[] = []
  for (const [sceneNum, dayNum] of Object.entries(BIYA_SCHEDULE)) {
    const sceneId = sceneByNumber.get(sceneNum)
    const dayId = dayByNumber.get(dayNum)
    if (!sceneId) {
      missing.push(sceneNum)
      continue
    }
    if (!dayId) continue
    await pool.query(
      `UPDATE scenes SET shoot_day_id = $1, day_position = (
         SELECT COALESCE(MAX(day_position), 0) + 1 FROM scenes WHERE shoot_day_id = $1
       ) WHERE id = $2`,
      [dayId, sceneId],
    )
    assigned += 1
  }
  return { assigned, missing }
}
