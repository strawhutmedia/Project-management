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
    const alexId = await ensurePlaceholderUser('Alex', 'Alex')

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
                            shoot_days = 18, bond_pct = 3, contingency_pct = 10
         WHERE project_id = $1`,
        [projId],
      )
      // Used to auto-populate the budget if total spend was $0 — but
      // that fought with the "Reset all prices" button: every Railway
      // redeploy after a reset would silently re-stamp the
      // StudioBinder defaults back on top of Ryan's clean plate. The
      // populate path is intentionally NOT re-run here on existing
      // projects; first-time creation in the INSERT branch below
      // still seeds defaults once.
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
    `UPDATE budget_line_items li
       SET amt = 1, x = 1, rate = $4
     FROM budget_accounts a
     WHERE li.account_id = a.id
       AND a.budget_id = $1
       AND a.code = $2
       AND lower(li.description) LIKE lower($3)`,
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

async function populateBiyaBudgetAmounts(
  client: PoolClient | typeof pool,
  budgetId: string,
): Promise<void> {
  // CAST (14-00) — Ryan's actual cast budget
  await setLine(client, budgetId, '14-00', 'lead cast', 50000)         // Sawyer + Kendrick combined
  await setLine(client, budgetId, '14-00', 'supporting cast', 39000)   // Anna $10k + Aaron $7k + Margo $7k + Justine $4k + Tom $2k + Nadia $2k + Lilly $3k + Alex $2k + Bernard $2k
  await setLine(client, budgetId, '14-00', 'day players', 14000)
  await setLine(client, budgetId, '14-00', 'stunt coordinators', 5000)
  await setLine(client, budgetId, '14-00', 'stunts & adjustments', 3000)
  await setLine(client, budgetId, '14-00', 'casting director', 4000)

  // EXTRAS (21-00)
  await setLine(client, budgetId, '21-00', 'background extras', 8000)

  // PRODUCTION STAFF (20-00) — line producer is the only paid ATL role
  await setLine(client, budgetId, '20-00', 'unit production manager', 40000)  // Line Producer
  await setLine(client, budgetId, '20-00', 'production coordinator', 18000)
  await setLine(client, budgetId, '20-00', '1st asst director', 20000)
  await setLine(client, budgetId, '20-00', '2nd asst director', 11000)
  await setLine(client, budgetId, '20-00', 'script supervisor', 8000)
  await setLine(client, budgetId, '20-00', 'production asst (set)', 12000)  // 3 PAs combined

  // SET DESIGN (22-00)
  await setLine(client, budgetId, '22-00', 'production designer', 22000)

  // SET OPERATIONS / GRIP (25-00)
  await setLine(client, budgetId, '25-00', 'key grip', 13000)
  await setLine(client, budgetId, '25-00', 'best boy grip', 9000)
  await setLine(client, budgetId, '25-00', 'grip package rental', 9000)

  // SET DRESSING (26-00)
  await setLine(client, budgetId, '26-00', 'set decorator', 11000)  // combined w/ props

  // WARDROBE (28-00)
  await setLine(client, budgetId, '28-00', 'costume designer', 15000)

  // ELECTRIC (29-00)
  await setLine(client, budgetId, '29-00', 'gaffer', 13000)
  await setLine(client, budgetId, '29-00', 'best boy electric', 9000)
  await setLine(client, budgetId, '29-00', 'lighting package rental', 11000)
  await setLine(client, budgetId, '29-00', 'generator', 5000)

  // CAMERA (30-00)
  await setLine(client, budgetId, '30-00', 'director of photography', 33000)
  await setLine(client, budgetId, '30-00', '1st asst camera', 11000)
  await setLine(client, budgetId, '30-00', 'dit', 9000)
  await setLine(client, budgetId, '30-00', 'camera package rental', 14000)
  await setLine(client, budgetId, '30-00', 'expendables', 4000)

  // PRODUCTION SOUND (31-00)
  await setLine(client, budgetId, '31-00', 'sound mixer', 11000)
  await setLine(client, budgetId, '31-00', 'sound package rental', 4000)

  // MAKE-UP & HAIR (32-00)
  await setLine(client, budgetId, '32-00', 'key make-up', 11000)  // combined MU + Hair

  // TRANSPORTATION (33-00)
  await setLine(client, budgetId, '33-00', 'vehicle rentals', 8000)
  await setLine(client, budgetId, '33-00', 'fuel', 2000)

  // LOCATIONS (34-00)
  await setLine(client, budgetId, '34-00', 'location manager', 14000)
  await setLine(client, budgetId, '34-00', 'permits', 3000)
  await setLine(client, budgetId, '34-00', 'parking', 1000)
  // Specific location fees as added lines so they're itemized
  await addLine(client, budgetId, '34-00', "Jason Kendrick's house (cleaning)", 3000, '34-09')
  await addLine(client, budgetId, '34-00', 'ADU / Sawyer Solvang house (cleaning)', 2000, '34-10')
  await addLine(client, budgetId, '34-00', 'Mall (4 scenes — Day 14)', 12000, '34-11')
  await addLine(client, budgetId, '34-00', 'Hospital (5 scenes — Day 20)', 5000, '34-12')
  await addLine(client, budgetId, '34-00', 'Coffee shop (4 scenes — Day 12)', 3000, '34-13')
  await addLine(client, budgetId, '34-00', 'Bar Solvang + Bar Minneapolis', 4000, '34-14')
  await addLine(client, budgetId, '34-00', 'Liquor store', 1000, '34-15')
  await addLine(client, budgetId, '34-00', 'Boutique clothing store', 1000, '34-16')
  await addLine(client, budgetId, '34-00', 'Goodwill exterior', 500, '34-17')
  await addLine(client, budgetId, '34-00', 'Hotel conference (Dayanet) + YMCA', 2500, '34-18')
  await addLine(client, budgetId, '34-00', "Justine & Tom's house + Sawyer's Minneapolis apt", 4000, '34-19')

  // PICTURE VEHICLES (35-00)
  await setLine(client, budgetId, '35-00', 'picture vehicles', 8000)  // Defender + Sawyer car + others

  // SPECIAL EFFECTS (36-00) — knife rig
  await setLine(client, budgetId, '36-00', 'sfx materials', 3000)
  await setLine(client, budgetId, '36-00', 'sfx tech', 2000)

  // BTL TRAVEL & CATERING — catering bucketed under General Expense for now
  await addLine(client, budgetId, '57-00', 'Catering / craft service (18 days)', 24000, '57-07')

  // POST PRODUCTION
  await setLine(client, budgetId, '45-00', 'asst editor', 2000)
  await setLine(client, budgetId, '45-00', 'edit suite rental', 2000)
  await setLine(client, budgetId, '45-00', 'edit hardware', 1000)

  await setLine(client, budgetId, '46-00', 'composer', 20000)
  await setLine(client, budgetId, '46-00', 'music licensing', 10000)  // Sync only — Maggie owns the master

  await setLine(client, budgetId, '47-00', 'vfx shots', 5000)  // XenoSouls touch-ups + blood comp

  await setLine(client, budgetId, '48-00', 'sound designer', 20000)  // Foley + Sound Design combined
  await setLine(client, budgetId, '48-00', 'mix stage rental', 2000)

  await setLine(client, budgetId, '49-00', 'color correction', 20000)  // Cam
  await setLine(client, budgetId, '49-00', 'deliverables', 4000)

  // PUBLICITY (Marketing — $50k)
  await setLine(client, budgetId, '55-00', 'unit publicist', 30000)
  await setLine(client, budgetId, '55-00', 'stills photographer', 5000)
  await setLine(client, budgetId, '55-00', 'press materials', 4000)
  await setLine(client, budgetId, '55-00', 'premiere', 3000)
  await addLine(client, budgetId, '55-00', 'Festival submissions', 3000, '55-06')

  // LEGAL & ACCOUNTING (Admin)
  await setLine(client, budgetId, '56-00', 'legal fees', 5000)
  await setLine(client, budgetId, '56-00', 'production accountant', 5000)
  await setLine(client, budgetId, '56-00', 'payroll service', 1000)

  // GENERAL EXPENSE (Admin)
  await setLine(client, budgetId, '57-00', 'office rent', 1000)
  await setLine(client, budgetId, '57-00', 'office supplies', 1000)
  await setLine(client, budgetId, '57-00', 'petty cash', 1000)

  // INSURANCE (Admin)
  await setLine(client, budgetId, '58-00', 'production package', 12000)
  await setLine(client, budgetId, '58-00', 'e&o insurance', 4000)
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
