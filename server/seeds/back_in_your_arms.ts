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

import type { PoolClient } from 'pg'
import { pool } from '../db'
import { STUDIOBINDER_ACCOUNTS } from '../budget_template'
import { applyWardrobeOutfitNumbers } from './wardrobe_outfits'
import { logInfo, logError } from '../diag'

// Ryan's StudioBinder schedule, scene-number → StudioBinder shoot-day
// ORDINAL (1..21). Used by applyBackInYourArmsSchedule() after the .fdx
// is uploaded.
//
// NOTE: Slate prepends a TRAVEL day as physical Day 1 (drive LA -> Solvang),
// so the physical shoot_days.number = ordinal + TRAVEL_DAY_OFFSET. Keep this
// map in StudioBinder ordinals (matching Ryan's call sheets); the offset is
// applied at the single lookup site below. StudioBinder "Day 1" == Slate
// "Day 2", and so on.
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

// Slate prepends a travel day as physical Day 1 (LA -> Solvang), so every
// StudioBinder ordinal maps to physical shoot_day number = ordinal + 1.
const TRAVEL_DAY_OFFSET = 1
const TRAVEL_DAY_NOTE = 'TRAVEL — LA → Solvang'

async function ensurePlaceholderUser(name: string, displayName: string): Promise<string | null> {
  // Look up by exact name match first (placeholder users may not have email)
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE name = $1 LIMIT 1`,
    [name],
  )
  if (existing.rows.length > 0) return existing.rows[0].id
  // Create as placeholder (no email, role=user, default timezone)
  const created = await pool.query<{ id: string }>(
    `INSERT INTO users (name, display_name, role, timezone)
     VALUES ($1, $2, 'user', 'America/Los_Angeles')
     RETURNING id`,
    [name, displayName],
  )
  return created.rows[0]?.id ?? null
}

// Alex was seeded as an emailless placeholder so his editor role could be
// assigned before he had an account. Once he signed up (ALEX_EMAIL), that
// left a DUPLICATE "Alex" in the user list. Collapse the placeholder into
// his real account: move memberships + role references, then delete it.
// Returns the real Alex id if he exists, else null (still pre-signup).
const ALEX_EMAIL = 'alex.clayton.wall@gmail.com'
async function resolveAlexMergingDuplicate(): Promise<string | null> {
  const real = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [ALEX_EMAIL],
  )
  if (real.rows.length === 0) return null
  const realId = real.rows[0].id
  const dupes = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE name = 'Alex' AND (email IS NULL OR email = '') AND id <> $1`, [realId],
  )
  for (const d of dupes.rows) {
    const dupId = d.id
    try {
      await pool.query(
        `INSERT INTO project_members (project_id, user_id)
         SELECT project_id, $2 FROM project_members WHERE user_id = $1
         ON CONFLICT DO NOTHING`, [dupId, realId])
      await pool.query(
        `UPDATE projects SET default_owners = replace(default_owners::text, $1, $2)::jsonb
          WHERE default_owners IS NOT NULL AND default_owners::text LIKE '%' || $1 || '%'`, [dupId, realId])
      const reassign: Array<[string, string]> = [
        ['comments', 'author_id'], ['links', 'created_by'],
        ['tasks', 'assignee_id'], ['tasks', 'created_by'],
        ['budgets', 'created_by'], ['budget_line_items', 'created_by'],
        ['songs', 'producer_id'], ['songs', 'mixer_id'], ['songs', 'writer_id'],
        ['songs', 'tracker_id'], ['songs', 'overdub_id'], ['songs', 'stems_id'], ['songs', 'master_id'],
      ]
      for (const [t, c] of reassign) {
        await pool.query(`UPDATE ${t} SET ${c} = $2 WHERE ${c} = $1`, [dupId, realId]).catch(() => {})
      }
      await pool.query(`DELETE FROM users WHERE id = $1`, [dupId])
      logInfo('BIYA seed: merged placeholder Alex into real account', { dupId, realId })
    } catch (err) {
      logError('BIYA seed: merge duplicate Alex failed', { dupId, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return realId
}

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

    // Placeholder users for Stephen Markley and Alex (creative team
    // unpaid in cash, but listed here so roles can be assigned)
    const stephenId = await ensurePlaceholderUser('Stephen Markley', 'Stephen')
    // Prefer Alex's real account (by email) and clean up the old placeholder;
    // fall back to a placeholder only if he hasn't signed up yet.
    const alexId = (await resolveAlexMergingDuplicate()) ?? await ensurePlaceholderUser('Alex', 'Alex')

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM projects WHERE name = $1`,
      ['Back in Your Arms'],
    )
    if (existing.rows.length > 0) {
      // Project exists. Make sure budget targets are up to date in case
      // we tweaked them in code, make sure all 21 shoot days exist, and
      // populate budget amounts if they haven't been populated yet.
      const projId = existing.rows[0].id
      await ensureShootDays(projId)
      await ensureFilmTeam(projId, ryanId, stephenId, alexId)

      // If the .fdx has been imported but scenes are still unscheduled,
      // apply Ryan's StudioBinder schedule automatically so we don't
      // make him drag-drop manually after each .fdx revision.
      const unscheduled = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM scenes
         WHERE project_id = $1 AND shoot_day_id IS NULL`,
        [projId],
      )
      if (Number(unscheduled.rows[0].count) > 0) {
        const result = await applyBackInYourArmsSchedule(projId)
        logInfo('BIYA seed: auto-applied schedule to unscheduled scenes', {
          projectId: projId,
          ...result,
        })
      }
      // Re-set budget targets in case they were updated in code
      await pool.query(
        `UPDATE budgets SET production_target = 500000, post_target = 150000,
                            marketing_target = 50000, total_target = 700000,
                            shoot_days = 18, bond_pct = 3, contingency_pct = 10,
                            home_location_tag = COALESCE(home_location_tag, 'LA')
         WHERE project_id = $1`,
        [projId],
      )
      // Ryan works entirely in the per-day budget, not the top-sheet lump
      // sums. An earlier attempt auto-loaded the code's detailed budget
      // amounts onto the live project's blank lines — numbers Ryan never
      // typed. Undo that ONCE, precisely (only zeroing lines that still
      // hold exactly the loaded amount), then never auto-apply again. His
      // own per-day entries and any hand-typed prices are untouched.
      const budgetRow = await pool.query<{ id: string; detailed_budget_applied: boolean; detailed_budget_reverted: boolean; post_sound_restored: boolean }>(
        `SELECT id, detailed_budget_applied, detailed_budget_reverted, post_sound_restored FROM budgets WHERE project_id = $1`,
        [projId],
      )
      if (budgetRow.rows[0] && budgetRow.rows[0].detailed_budget_applied && !budgetRow.rows[0].detailed_budget_reverted) {
        await revertBiyaDetailedBudget(pool, budgetRow.rows[0].id)
        await pool.query(
          `UPDATE budgets SET detailed_budget_reverted = true WHERE id = $1`,
          [budgetRow.rows[0].id],
        )
        logInfo('BIYA seed: reverted mistakenly-loaded detailed budget amounts (one-time)', {
          projectId: projId, budgetId: budgetRow.rows[0].id,
        })
      }
      // Corrective: the value-matching revert above collided with Ryan's real
      // Post Sound line ($20,000 in 48-00 "sound designer" — same figure as a
      // loaded amount) and zeroed it. Restore that one item exactly once, and
      // only if it's still sitting at 0 (never overwrite a fresh edit).
      if (budgetRow.rows[0] && budgetRow.rows[0].detailed_budget_reverted && !budgetRow.rows[0].post_sound_restored) {
        await pool.query(
          `UPDATE budget_line_items li
             SET amt = 1, x = 1, rate = 20000
           FROM budget_accounts a
           WHERE li.account_id = a.id
             AND a.budget_id = $1
             AND a.code = '48-00'
             AND lower(li.description) LIKE '%sound designer%'
             AND (li.amt * li.x * li.rate) = 0`,
          [budgetRow.rows[0].id],
        )
        await pool.query(
          `UPDATE budgets SET post_sound_restored = true WHERE id = $1`,
          [budgetRow.rows[0].id],
        )
        logInfo('BIYA seed: restored Post Sound $20k zeroed by revert collision (one-time)', {
          projectId: projId, budgetId: budgetRow.rows[0].id,
        })
      }
      // Pre-fill wardrobe outfit numbers on blank WARDROBE items (never
      // overwrites a number the costume team set). Fills any items that
      // exist now; new ones from a re-analyze get numbered next boot.
      await applyWardrobeOutfitNumbers(projId)
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

      // Day 1 = TRAVEL (LA → Solvang). Days 2..22 = the 21 shoot/break
      // days, each StudioBinder ordinal shifted +1 by TRAVEL_DAY_OFFSET.
      await client.query(
        `INSERT INTO shoot_days (project_id, number, is_travel, is_break, notes)
         VALUES ($1, 1, true, false, $2)`,
        [projId, TRAVEL_DAY_NOTE],
      )
      for (let ord = 1; ord <= 21; ord++) {
        await client.query(
          `INSERT INTO shoot_days (project_id, number, is_break) VALUES ($1, $2, $3)`,
          [projId, ord + TRAVEL_DAY_OFFSET, BREAK_DAYS.includes(ord)],
        )
      }

      // Populate budget line items with the amounts from the budget plan
      await populateBiyaBudgetAmounts(client, budgetId)

      // Assign default film roles. Producer and Director have multiple
      // people in real life (Ryan, Stephen, Alex on producer side; Ryan
      // and Stephen on directing); we set the primary contact here and
      // add all three as project members below.
      const defaultOwners: Record<string, string> = {
        writer: stephenId ?? ryanId,
        producer: ryanId,
        director: ryanId,
        editor: alexId ?? ryanId,
      }
      await client.query(
        `UPDATE projects SET default_owners = $1 WHERE id = $2`,
        [JSON.stringify(defaultOwners), projId],
      )

      // Add Stephen + Alex as project members so they show up in role dropdowns
      for (const id of [stephenId, alexId].filter((x): x is string => Boolean(x))) {
        await client.query(
          `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [projId, id],
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

// Set a specific line item's amount. Identified by account code +
// description match (case-insensitive contains). Sets amt=1, x=1, rate=$total
// so the row reads cleanly as a flat fee.
async function setLine(
  client: PoolClient | typeof pool,
  budgetId: string,
  accountCode: string,
  descMatch: string,
  rate: number,
): Promise<void> {
  await client.query(
    // Only fill BLANK items (current total = 0) so we never clobber a price
    // Ryan already entered by hand. Combined with the one-time
    // detailed_budget_applied guard, this also means a "Reset all prices"
    // is respected — the reset stays reset on the next boot.
    `UPDATE budget_line_items li
       SET amt = 1, x = 1, rate = $4
     FROM budget_accounts a
     WHERE li.account_id = a.id
       AND a.budget_id = $1
       AND a.code = $2
       AND lower(li.description) LIKE lower($3)
       AND (li.amt * li.x * li.rate) = 0`,
    [budgetId, accountCode, `%${descMatch}%`, rate],
  )
}

// Add a new line item to an account. Used when the StudioBinder template
// doesn't have a matching default line.
async function addLine(
  client: PoolClient | typeof pool,
  budgetId: string,
  accountCode: string,
  description: string,
  rate: number,
  code?: string,
): Promise<void> {
  const acc = await client.query(
    `SELECT id FROM budget_accounts WHERE budget_id = $1 AND code = $2`,
    [budgetId, accountCode],
  )
  if (acc.rows.length === 0) return
  const accId = (acc.rows[0] as { id: string }).id
  // Idempotent: if a line with this exact description already exists in the
  // account, don't add a duplicate on a re-run.
  const dupe = await client.query(
    `SELECT 1 FROM budget_line_items WHERE account_id = $1 AND lower(description) = lower($2) LIMIT 1`,
    [accId, description],
  )
  if (dupe.rows.length > 0) return
  const posRes = await client.query(
    `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
    [accId],
  )
  const next = (posRes.rows[0] as { next: number }).next
  await client.query(
    `INSERT INTO budget_line_items (account_id, code, description, amt, x, rate, position)
     VALUES ($1, $2, $3, 1, 1, $4, $5)`,
    [accId, code ?? null, description, rate, next],
  )
}

// The full detailed BIYA budget as a shared data table so apply and revert
// use the SAME definitions (a hand-maintained revert list is how you wipe
// the wrong number). `set` lines match an existing StudioBinder default
// line by description; `add` lines are extra itemized lines inserted into
// an account. NOTE: this data is retained only so the one-time REVERT can
// precisely undo the amounts that were mistakenly loaded onto the live
// project. It is no longer auto-applied.
type SetLine = { kind: 'set'; account: string; descMatch: string; rate: number }
type AddLine = { kind: 'add'; account: string; description: string; rate: number; code: string }
const BIYA_BUDGET_LINES: Array<SetLine | AddLine> = [
  { kind: 'set', account: '14-00', descMatch: 'lead cast', rate: 50000 },
  { kind: 'set', account: '14-00', descMatch: 'supporting cast', rate: 39000 },
  { kind: 'set', account: '14-00', descMatch: 'day players', rate: 14000 },
  { kind: 'set', account: '14-00', descMatch: 'stunt coordinators', rate: 5000 },
  { kind: 'set', account: '14-00', descMatch: 'stunts & adjustments', rate: 3000 },
  { kind: 'set', account: '14-00', descMatch: 'casting director', rate: 4000 },
  { kind: 'set', account: '21-00', descMatch: 'background extras', rate: 8000 },
  { kind: 'set', account: '20-00', descMatch: 'unit production manager', rate: 40000 },
  { kind: 'set', account: '20-00', descMatch: 'production coordinator', rate: 18000 },
  { kind: 'set', account: '20-00', descMatch: '1st asst director', rate: 20000 },
  { kind: 'set', account: '20-00', descMatch: '2nd asst director', rate: 11000 },
  { kind: 'set', account: '20-00', descMatch: 'script supervisor', rate: 8000 },
  { kind: 'set', account: '20-00', descMatch: 'production asst (set)', rate: 12000 },
  { kind: 'set', account: '22-00', descMatch: 'production designer', rate: 22000 },
  { kind: 'set', account: '25-00', descMatch: 'key grip', rate: 13000 },
  { kind: 'set', account: '25-00', descMatch: 'best boy grip', rate: 9000 },
  { kind: 'set', account: '25-00', descMatch: 'grip package rental', rate: 9000 },
  { kind: 'set', account: '26-00', descMatch: 'set decorator', rate: 11000 },
  { kind: 'set', account: '28-00', descMatch: 'costume designer', rate: 15000 },
  { kind: 'set', account: '29-00', descMatch: 'gaffer', rate: 13000 },
  { kind: 'set', account: '29-00', descMatch: 'best boy electric', rate: 9000 },
  { kind: 'set', account: '29-00', descMatch: 'lighting package rental', rate: 11000 },
  { kind: 'set', account: '29-00', descMatch: 'generator', rate: 5000 },
  { kind: 'set', account: '30-00', descMatch: 'director of photography', rate: 33000 },
  { kind: 'set', account: '30-00', descMatch: '1st asst camera', rate: 11000 },
  { kind: 'set', account: '30-00', descMatch: 'dit', rate: 9000 },
  { kind: 'set', account: '30-00', descMatch: 'camera package rental', rate: 14000 },
  { kind: 'set', account: '30-00', descMatch: 'expendables', rate: 4000 },
  { kind: 'set', account: '31-00', descMatch: 'sound mixer', rate: 11000 },
  { kind: 'set', account: '31-00', descMatch: 'sound package rental', rate: 4000 },
  { kind: 'set', account: '32-00', descMatch: 'key make-up', rate: 11000 },
  { kind: 'set', account: '33-00', descMatch: 'vehicle rentals', rate: 8000 },
  { kind: 'set', account: '33-00', descMatch: 'fuel', rate: 2000 },
  { kind: 'set', account: '34-00', descMatch: 'location manager', rate: 14000 },
  { kind: 'set', account: '34-00', descMatch: 'permits', rate: 3000 },
  { kind: 'set', account: '34-00', descMatch: 'parking', rate: 1000 },
  { kind: 'add', account: '34-00', description: "Jason Kendrick's house (cleaning)", rate: 3000, code: '34-09' },
  { kind: 'add', account: '34-00', description: 'ADU / Sawyer Solvang house (cleaning)', rate: 2000, code: '34-10' },
  { kind: 'add', account: '34-00', description: 'Mall (4 scenes — Day 14)', rate: 12000, code: '34-11' },
  { kind: 'add', account: '34-00', description: 'Hospital (5 scenes — Day 20)', rate: 5000, code: '34-12' },
  { kind: 'add', account: '34-00', description: 'Coffee shop (4 scenes — Day 12)', rate: 3000, code: '34-13' },
  { kind: 'add', account: '34-00', description: 'Bar Solvang + Bar Minneapolis', rate: 4000, code: '34-14' },
  { kind: 'add', account: '34-00', description: 'Liquor store', rate: 1000, code: '34-15' },
  { kind: 'add', account: '34-00', description: 'Boutique clothing store', rate: 1000, code: '34-16' },
  { kind: 'add', account: '34-00', description: 'Goodwill exterior', rate: 500, code: '34-17' },
  { kind: 'add', account: '34-00', description: 'Hotel conference (Dayanet) + YMCA', rate: 2500, code: '34-18' },
  { kind: 'add', account: '34-00', description: "Justine & Tom's house + Sawyer's Minneapolis apt", rate: 4000, code: '34-19' },
  { kind: 'set', account: '35-00', descMatch: 'picture vehicles', rate: 8000 },
  { kind: 'set', account: '36-00', descMatch: 'sfx materials', rate: 3000 },
  { kind: 'set', account: '36-00', descMatch: 'sfx tech', rate: 2000 },
  { kind: 'add', account: '57-00', description: 'Catering / craft service (18 days)', rate: 24000, code: '57-07' },
  { kind: 'set', account: '45-00', descMatch: 'asst editor', rate: 2000 },
  { kind: 'set', account: '45-00', descMatch: 'edit suite rental', rate: 2000 },
  { kind: 'set', account: '45-00', descMatch: 'edit hardware', rate: 1000 },
  { kind: 'set', account: '46-00', descMatch: 'composer', rate: 20000 },
  { kind: 'set', account: '46-00', descMatch: 'music licensing', rate: 10000 },
  { kind: 'set', account: '47-00', descMatch: 'vfx shots', rate: 5000 },
  { kind: 'set', account: '48-00', descMatch: 'sound designer', rate: 20000 },
  { kind: 'set', account: '48-00', descMatch: 'mix stage rental', rate: 2000 },
  { kind: 'set', account: '49-00', descMatch: 'color correction', rate: 20000 },
  { kind: 'set', account: '49-00', descMatch: 'deliverables', rate: 4000 },
  { kind: 'set', account: '55-00', descMatch: 'unit publicist', rate: 30000 },
  { kind: 'set', account: '55-00', descMatch: 'stills photographer', rate: 5000 },
  { kind: 'set', account: '55-00', descMatch: 'press materials', rate: 4000 },
  { kind: 'set', account: '55-00', descMatch: 'premiere', rate: 3000 },
  { kind: 'add', account: '55-00', description: 'Festival submissions', rate: 3000, code: '55-06' },
  { kind: 'set', account: '56-00', descMatch: 'legal fees', rate: 5000 },
  { kind: 'set', account: '56-00', descMatch: 'production accountant', rate: 5000 },
  { kind: 'set', account: '56-00', descMatch: 'payroll service', rate: 1000 },
  { kind: 'set', account: '57-00', descMatch: 'office rent', rate: 1000 },
  { kind: 'set', account: '57-00', descMatch: 'office supplies', rate: 1000 },
  { kind: 'set', account: '57-00', descMatch: 'petty cash', rate: 1000 },
  { kind: 'set', account: '58-00', descMatch: 'production package', rate: 12000 },
  { kind: 'set', account: '58-00', descMatch: 'e&o insurance', rate: 4000 },
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function populateBiyaBudgetAmounts(
  client: PoolClient | typeof pool,
  budgetId: string,
): Promise<void> {
  for (const line of BIYA_BUDGET_LINES) {
    if (line.kind === 'set') await setLine(client, budgetId, line.account, line.descMatch, line.rate)
    else await addLine(client, budgetId, line.account, line.description, line.rate, line.code)
  }
}

// Precisely UNDO the amounts loaded by populateBiyaBudgetAmounts, WITHOUT
// touching anything the user entered themselves. For `set` lines: zero the
// matching item ONLY IF it still holds exactly the loaded rate (so a value
// the user changed since is preserved). For `add` lines: delete the inserted
// row ONLY IF it still holds the loaded rate.
async function revertBiyaDetailedBudget(
  client: PoolClient | typeof pool,
  budgetId: string,
): Promise<void> {
  for (const line of BIYA_BUDGET_LINES) {
    if (line.kind === 'set') {
      await client.query(
        `UPDATE budget_line_items li
           SET amt = 0, x = 1, rate = 0
         FROM budget_accounts a
         WHERE li.account_id = a.id
           AND a.budget_id = $1
           AND a.code = $2
           AND lower(li.description) LIKE lower($3)
           AND (li.amt * li.x * li.rate) = $4`,
        [budgetId, line.account, `%${line.descMatch}%`, line.rate],
      )
    } else {
      await client.query(
        `DELETE FROM budget_line_items li
          USING budget_accounts a
          WHERE li.account_id = a.id
            AND a.budget_id = $1
            AND a.code = $2
            AND lower(li.description) = lower($3)
            AND (li.amt * li.x * li.rate) = $4`,
        [budgetId, line.account, line.description, line.rate],
      )
    }
  }
}

async function ensureFilmTeam(
  projectId: string,
  ryanId: string,
  stephenId: string | null,
  alexId: string | null,
): Promise<void> {
  // Add Stephen + Alex as project members
  for (const id of [stephenId, alexId].filter((x): x is string => Boolean(x))) {
    await pool.query(
      `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [projectId, id],
    )
  }
  // Set default film roles if not already set
  const proj = await pool.query<{ default_owners: Record<string, unknown> | null }>(
    `SELECT default_owners FROM projects WHERE id = $1`,
    [projectId],
  )
  const current = (proj.rows[0]?.default_owners ?? {}) as Record<string, unknown>
  const filmRoleKeys = ['writer', 'producer', 'director', 'editor']
  const hasFilmRoles = filmRoleKeys.some((k) => current[k])
  if (!hasFilmRoles) {
    const defaultOwners: Record<string, string> = {
      writer: stephenId ?? ryanId,
      producer: ryanId,
      director: ryanId,
      editor: alexId ?? ryanId,
    }
    await pool.query(
      `UPDATE projects SET default_owners = $1 WHERE id = $2`,
      [JSON.stringify(defaultOwners), projectId],
    )
  }
}

async function ensureShootDays(projectId: string): Promise<void> {
  // One-time migration to the travel-day layout. If this project has no
  // travel day yet, it's still on the legacy 1..21 numbering — shift every
  // existing day +1 to free up Day 1, then insert Day 1 = TRAVEL. Scenes
  // ride along on their shoot_day_id (unchanged), and the reschedule below
  // uses TRAVEL_DAY_OFFSET so they still land on the right (now +1) day.
  // Idempotent: once a travel day exists, we never shift again.
  const hasTravel = await pool.query(
    `SELECT 1 FROM shoot_days WHERE project_id = $1 AND is_travel = true LIMIT 1`,
    [projectId],
  )
  if (hasTravel.rows.length === 0) {
    // Two-step +1 via a high offset so the UNIQUE(project_id, number)
    // constraint never trips on a transient collision mid-update.
    await pool.query(`UPDATE shoot_days SET number = number + 1000 WHERE project_id = $1`, [projectId])
    await pool.query(`UPDATE shoot_days SET number = number - 999 WHERE project_id = $1`, [projectId])
    await pool.query(
      `INSERT INTO shoot_days (project_id, number, is_travel, is_break, notes)
       VALUES ($1, 1, true, false, $2)
       ON CONFLICT (project_id, number)
         DO UPDATE SET is_travel = true, is_break = false, notes = EXCLUDED.notes`,
      [projectId, TRAVEL_DAY_NOTE],
    )
  }
  // Ensure the full layout exists: travel Day 1 (above) + shoot Days 2..22.
  for (let ord = 1; ord <= 21; ord++) {
    await pool.query(
      `INSERT INTO shoot_days (project_id, number, is_break)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, number) DO NOTHING`,
      [projectId, ord + TRAVEL_DAY_OFFSET, BREAK_DAYS.includes(ord)],
    )
  }
  // Backfill the travel day's leg: drive LA → Solvang, 260 mi round trip.
  // Destination (Solvang) also becomes the location_tag so that night's
  // hotel + per diem compute. COALESCE respects any manual edits.
  await pool.query(
    `UPDATE shoot_days
        SET travel_from  = COALESCE(travel_from, 'LA'),
            travel_to    = COALESCE(travel_to, 'Solvang'),
            travel_miles = COALESCE(travel_miles, 130),
            travel_hours = COALESCE(travel_hours, 2.5),
            location_tag = COALESCE(location_tag, 'Solvang')
      WHERE project_id = $1 AND is_travel = true`,
    [projectId],
  )
  // One-time correction: the first seed stored 260 as a round trip, but a
  // travel day is one way (the return is its own travel day). LA→Solvang is
  // 130 mi one way. Fix any travel day still carrying the old 260 default.
  await pool.query(
    `UPDATE shoot_days SET travel_miles = 130
      WHERE project_id = $1 AND is_travel = true AND travel_miles = 260`,
    [projectId],
  )
  // Off days mid-Solvang: cast/crew are held on location, so hotel + per
  // diem still apply (no day rate). Tag the break days Solvang so those
  // held-day costs show. COALESCE respects manual edits.
  await pool.query(
    `UPDATE shoot_days
        SET location_tag = COALESCE(location_tag, 'Solvang')
      WHERE project_id = $1 AND is_break = true AND number = ANY($2::int[])`,
    [projectId, BREAK_DAYS.map((o) => o + TRAVEL_DAY_OFFSET)],
  )
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

  // Include shoot_day_id in the SELECT so we can SKIP scenes that are
  // already on the correct day. Previously the seed would re-write
  // day_position for EVERY scene in BIYA_SCHEDULE on every boot,
  // appending them to the day's tail in dictionary-iteration order —
  // silently randomizing whatever manual ordering the producer had
  // set. Now we only touch scenes whose current shoot_day_id doesn't
  // match the target.
  const scenes = await pool.query<{ id: string; number: string; shoot_day_id: string | null }>(
    `SELECT id, number, shoot_day_id FROM scenes WHERE project_id = $1`,
    [projectId],
  )
  const sceneRowByNumber = new Map<string, { id: string; shootDayId: string | null }>()
  for (const s of scenes.rows) {
    sceneRowByNumber.set(s.number, { id: s.id, shootDayId: s.shoot_day_id })
  }

  let assigned = 0
  let skipped = 0
  const missing: string[] = []
  for (const [sceneNum, dayNum] of Object.entries(BIYA_SCHEDULE)) {
    const scene = sceneRowByNumber.get(sceneNum)
    // BIYA_SCHEDULE is in StudioBinder ordinals; physical day = ordinal + 1
    // because Day 1 is the LA → Solvang travel day.
    const dayId = dayByNumber.get(dayNum + TRAVEL_DAY_OFFSET)
    if (!scene) {
      missing.push(sceneNum)
      continue
    }
    if (!dayId) continue
    if (scene.shootDayId === dayId) {
      // Already on the right day — leave day_position alone so we don't
      // clobber the producer's manual ordering.
      skipped += 1
      continue
    }
    await pool.query(
      `UPDATE scenes SET shoot_day_id = $1, day_position = (
         SELECT COALESCE(MAX(day_position), 0) + 1 FROM scenes WHERE shoot_day_id = $1
       ) WHERE id = $2`,
      [dayId, scene.id],
    )
    assigned += 1
  }
  logInfo('BIYA schedule apply', { assigned, skipped, missing: missing.length })
  return { assigned, missing }
}
