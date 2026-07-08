import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { STUDIOBINDER_ACCOUNTS } from '../budget_template'
import { getSceneBudgetItems } from '../scene_budget'
import { clusterProjectWardrobe } from '../wardrobe_clustering'
import { markProjectDirty } from '../script_publisher'
import { emit } from '../events'
import { logInfo } from '../diag'

// After any budget mutation, fetch the canonical row state and emit it
// over SSE so connected clients can patch their local state without a
// full refetch. Returns the item shape used by the front-end.
async function emitItemUpdated(projectId: string, itemId: string, byUserId: string) {
  const { rows } = await pool.query(
    `SELECT li.id, li.account_id, li.scene_id, li.code, li.description, li.amt,
            li.units, li.x, li.rate, li.vendor, li.dated_at, li.notes, li.position,
            li.resource_type, li.resource_key,
            s.number AS scene_number
     FROM budget_line_items li
     LEFT JOIN scenes s ON s.id = li.scene_id
     WHERE li.id = $1`,
    [itemId],
  )
  if (rows.length === 0) return
  const it = rows[0]
  const total = Number(it.amt) * Number(it.x) * Number(it.rate)
  emit(projectId, 'budget.item.updated', {
    item: {
      id: it.id,
      accountId: it.account_id,
      code: it.code,
      description: it.description,
      amt: Number(it.amt),
      units: it.units,
      x: Number(it.x),
      rate: Number(it.rate),
      vendor: it.vendor,
      datedAt: it.dated_at,
      notes: it.notes,
      position: it.position,
      sceneId: it.scene_id,
      sceneNumber: it.scene_number,
      resourceType: it.resource_type,
      resourceKey: it.resource_key,
      total,
    },
  }, byUserId)
}

export const budgetsRouter = Router()
budgetsRouter.use(requireUser)

async function userCanAccessProject(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

// GET budget for a project (or 404 if not yet created)
budgetsRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const budgetRes = await pool.query(
    `SELECT id, currency, shoot_days, bond_pct, contingency_pct,
            cast_payroll_pct, crew_payroll_pct,
            cast_per_diem_daily, crew_per_diem_daily,
            cast_per_diem_headcount, crew_per_diem_headcount,
            home_location_tag, hotel_cast_nightly, hotel_crew_nightly,
            travel_days,
            production_target, post_target, marketing_target, admin_target, total_target
       FROM budgets WHERE project_id = $1`,
    [projectId],
  )
  if (budgetRes.rows.length === 0) {
    res.status(404).json({ error: 'no_budget' }); return
  }
  const budget = budgetRes.rows[0]
  const accounts = await pool.query(
    `SELECT id, code, name, category, position FROM budget_accounts
     WHERE budget_id = $1 ORDER BY position ASC, code ASC`,
    [budget.id],
  )
  const items = await pool.query(
    `SELECT li.id, li.account_id, li.scene_id, li.code, li.description, li.amt, li.units,
            li.x, li.rate, li.vendor, li.dated_at, li.notes, li.position,
            s.number AS scene_number
     FROM budget_line_items li
     LEFT JOIN scenes s ON s.id = li.scene_id
     WHERE li.account_id = ANY($1) ORDER BY li.position ASC, li.created_at ASC`,
    [accounts.rows.map((a: { id: string }) => a.id)],
  )
  const itemsByAccount: Record<string, unknown[]> = {}
  for (const a of accounts.rows) itemsByAccount[a.id] = []
  for (const it of items.rows) {
    const total = Number(it.amt) * Number(it.x) * Number(it.rate)
    itemsByAccount[it.account_id].push({
      id: it.id,
      code: it.code,
      description: it.description,
      amt: Number(it.amt),
      units: it.units,
      x: Number(it.x),
      rate: Number(it.rate),
      vendor: it.vendor,
      datedAt: it.dated_at,
      notes: it.notes,
      position: it.position,
      sceneId: it.scene_id,
      sceneNumber: it.scene_number,
      total,
    })
  }
  const numOrNull = (v: unknown) => (v == null ? null : Number(v))
  // Away days count — shoot days whose location tag differs from
  // the budget's home_location_tag. Drives per diem + hotels totals.
  const homeTagLower = (budget.home_location_tag ?? '').trim().toLowerCase()
  const awayRes = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM shoot_days
      WHERE project_id = $1 AND is_break = FALSE
        AND location_tag IS NOT NULL
        AND LOWER(TRIM(location_tag)) <> $2`,
    [projectId, homeTagLower],
  )
  const awayDaysCount = Number(awayRes.rows[0]?.n ?? 0)
  res.json({
    budget: {
      id: budget.id,
      currency: budget.currency,
      shootDays: budget.shoot_days,
      bondPct: Number(budget.bond_pct),
      contingencyPct: Number(budget.contingency_pct),
      castPayrollPct: Number(budget.cast_payroll_pct ?? 33),
      crewPayrollPct: Number(budget.crew_payroll_pct ?? 15),
      castPerDiemDaily: Number(budget.cast_per_diem_daily ?? 0),
      crewPerDiemDaily: Number(budget.crew_per_diem_daily ?? 0),
      castPerDiemHeadcount: Number(budget.cast_per_diem_headcount ?? 0),
      crewPerDiemHeadcount: Number(budget.crew_per_diem_headcount ?? 0),
      homeLocationTag: budget.home_location_tag ?? null,
      hotelCastNightly: Number(budget.hotel_cast_nightly ?? 0),
      hotelCrewNightly: Number(budget.hotel_crew_nightly ?? 0),
      travelDays: Number(budget.travel_days ?? 0),
      awayDaysCount,
      productionTarget: numOrNull(budget.production_target),
      postTarget: numOrNull(budget.post_target),
      marketingTarget: numOrNull(budget.marketing_target),
      adminTarget: numOrNull(budget.admin_target),
      totalTarget: numOrNull(budget.total_target),
      accounts: accounts.rows.map((a: { id: string; code: string; name: string; category: string; position: number }) => ({
        ...a,
        lineItems: itemsByAccount[a.id] || [],
      })),
    },
  })
})

// Create a budget for a project (idempotent if one already exists, returns existing)
budgetsRouter.post('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const existing = await pool.query(`SELECT id FROM budgets WHERE project_id = $1`, [projectId])
  if (existing.rows.length > 0) {
    res.json({ budget: { id: existing.rows[0].id }, created: false }); return
  }
  const shootDays = Number(req.body?.shootDays) || 0
  const currency = String(req.body?.currency || 'USD')
  const useTemplate = req.body?.template !== 'blank'
  const numOrNull = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const productionTarget = numOrNull(req.body?.productionTarget)
  const postTarget = numOrNull(req.body?.postTarget)
  const marketingTarget = numOrNull(req.body?.marketingTarget)
  const adminTarget = numOrNull(req.body?.adminTarget)
  const totalTarget = numOrNull(req.body?.totalTarget)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const b = await client.query(
      `INSERT INTO budgets (project_id, currency, shoot_days, created_by,
         production_target, post_target, marketing_target, admin_target, total_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [projectId, currency, shootDays, user.id, productionTarget, postTarget, marketingTarget, adminTarget, totalTarget],
    )
    const budgetId = b.rows[0].id
    if (useTemplate) {
      let pos = 0
      for (const acc of STUDIOBINDER_ACCOUNTS) {
        pos += 10
        const accRes = await client.query(
          `INSERT INTO budget_accounts (budget_id, code, name, category, position)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [budgetId, acc.code, acc.name, acc.category, pos],
        )
        const accId = accRes.rows[0].id
        let liPos = 0
        for (const li of acc.lineItems ?? []) {
          liPos += 10
          await client.query(
            `INSERT INTO budget_line_items (account_id, code, description, amt, x, rate, position, created_by)
             VALUES ($1, $2, $3, 0, 1, 0, $4, $5)`,
            [accId, li.code, li.description, liPos, user.id],
          )
        }
      }
    }
    await client.query('COMMIT')
    logInfo('budget created', { projectId, budgetId, withTemplate: useTemplate })
    res.json({ budget: { id: budgetId }, created: true })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    client.release()
  }
})

// PATCH budget settings
budgetsRouter.patch('/:budgetId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const budgetId = req.params.budgetId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM budgets WHERE id = $1`, [budgetId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return
  const { currency, shootDays, bondPct, contingencyPct, castPayrollPct, crewPayrollPct, castPerDiemDaily, crewPerDiemDaily, castPerDiemHeadcount, crewPerDiemHeadcount, homeLocationTag, hotelCastNightly, hotelCrewNightly, travelDays, productionTarget, postTarget, marketingTarget, adminTarget, totalTarget } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof currency === 'string') { updates.push(`currency = $${i++}`); values.push(currency) }
  if (typeof shootDays === 'number') { updates.push(`shoot_days = $${i++}`); values.push(shootDays) }
  if (typeof bondPct === 'number') { updates.push(`bond_pct = $${i++}`); values.push(bondPct) }
  if (typeof contingencyPct === 'number') { updates.push(`contingency_pct = $${i++}`); values.push(contingencyPct) }
  if (typeof castPayrollPct === 'number') { updates.push(`cast_payroll_pct = $${i++}`); values.push(castPayrollPct) }
  if (typeof crewPayrollPct === 'number') { updates.push(`crew_payroll_pct = $${i++}`); values.push(crewPayrollPct) }
  if (typeof castPerDiemDaily === 'number') { updates.push(`cast_per_diem_daily = $${i++}`); values.push(castPerDiemDaily) }
  if (typeof crewPerDiemDaily === 'number') { updates.push(`crew_per_diem_daily = $${i++}`); values.push(crewPerDiemDaily) }
  if (typeof castPerDiemHeadcount === 'number') { updates.push(`cast_per_diem_headcount = $${i++}`); values.push(castPerDiemHeadcount) }
  if (typeof crewPerDiemHeadcount === 'number') { updates.push(`crew_per_diem_headcount = $${i++}`); values.push(crewPerDiemHeadcount) }
  if (typeof travelDays === 'number') { updates.push(`travel_days = $${i++}`); values.push(travelDays) }
  if ('homeLocationTag' in (req.body ?? {})) {
    updates.push(`home_location_tag = $${i++}`)
    values.push(typeof homeLocationTag === 'string' && homeLocationTag.trim() ? homeLocationTag.trim().slice(0, 50) : null)
  }
  if (typeof hotelCastNightly === 'number') { updates.push(`hotel_cast_nightly = $${i++}`); values.push(hotelCastNightly) }
  if (typeof hotelCrewNightly === 'number') { updates.push(`hotel_crew_nightly = $${i++}`); values.push(hotelCrewNightly) }
  const targetField = (key: string, val: unknown, col: string) => {
    if (!(key in (req.body ?? {}))) return
    if (val === null || val === '') {
      updates.push(`${col} = NULL`)
      return
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      updates.push(`${col} = $${i++}`)
      values.push(val)
    }
  }
  targetField('productionTarget', productionTarget, 'production_target')
  targetField('postTarget', postTarget, 'post_target')
  targetField('marketingTarget', marketingTarget, 'marketing_target')
  targetField('adminTarget', adminTarget, 'admin_target')
  targetField('totalTarget', totalTarget, 'total_target')
  if (updates.length === 0) { res.status(400).json({ error: 'no_fields' }); return }
  values.push(budgetId)
  await pool.query(`UPDATE budgets SET ${updates.join(', ')} WHERE id = $${i}`, values)
  res.json({ ok: true })
})

// Add a line item to an account
budgetsRouter.post('/accounts/:accountId/items', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const accountId = req.params.accountId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT b.project_id FROM budget_accounts a
       JOIN budgets b ON b.id = a.budget_id WHERE a.id = $1`, [accountId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return
  const { code, description, amt, units, x, rate, vendor, datedAt, notes, sceneId, shootDayId, resourceType, resourceKey } = req.body ?? {}
  if (typeof description !== 'string' || description.trim().length === 0) {
    res.status(400).json({ error: 'description_required' }); return
  }
  // Verify sceneId + shootDayId (if provided) belong to the same
  // project as the account. Without this, a writer on Project A could
  // attach a line item to a scene in Project B — accidentally OR
  // maliciously — silently corrupting the other project's cost view.
  if (typeof sceneId === 'string' && sceneId) {
    const check = await pool.query(
      `SELECT 1 FROM scenes WHERE id = $1 AND project_id = $2 LIMIT 1`,
      [sceneId, lookup.rows[0].project_id],
    )
    if (check.rows.length === 0) { res.status(400).json({ error: 'scene_not_in_project' }); return }
  }
  if (typeof shootDayId === 'string' && shootDayId) {
    const check = await pool.query(
      `SELECT 1 FROM shoot_days WHERE id = $1 AND project_id = $2 LIMIT 1`,
      [shootDayId, lookup.rows[0].project_id],
    )
    if (check.rows.length === 0) { res.status(400).json({ error: 'shoot_day_not_in_project' }); return }
  }
  const posRes = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
    [accountId],
  )
  const { rows } = await pool.query(
    `INSERT INTO budget_line_items
       (account_id, scene_id, shoot_day_id, code, description, amt, units, x, rate, vendor, dated_at, notes,
        resource_type, resource_key, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      accountId,
      typeof sceneId === 'string' ? sceneId : null,
      typeof shootDayId === 'string' ? shootDayId : null,
      typeof code === 'string' ? code : null,
      description.trim().slice(0, 200),
      Number(amt) || 0,
      typeof units === 'string' ? units : null,
      Number(x) || 1,
      Number(rate) || 0,
      typeof vendor === 'string' ? vendor : null,
      datedAt || null,
      typeof notes === 'string' ? notes : null,
      typeof resourceType === 'string' ? resourceType.slice(0, 40) : null,
      typeof resourceKey === 'string' ? resourceKey.slice(0, 80) : null,
      posRes.rows[0].next,
      user.id,
    ],
  )
  markProjectDirty(lookup.rows[0].project_id)
  void emitItemUpdated(lookup.rows[0].project_id, rows[0].id, user.id)
  res.json({ id: rows[0].id })
})

// Update / delete a line item
budgetsRouter.patch('/items/:itemId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const itemId = req.params.itemId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT b.project_id FROM budget_line_items li
       JOIN budget_accounts a ON a.id = li.account_id
       JOIN budgets b ON b.id = a.budget_id WHERE li.id = $1`, [itemId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return
  const map: Array<[string, string, (v: unknown) => unknown]> = [
    ['code', 'code', (v) => (typeof v === 'string' ? v : null)],
    ['description', 'description', (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : null)],
    ['amt', 'amt', (v) => (typeof v === 'number' ? v : Number(v) || 0)],
    ['units', 'units', (v) => (typeof v === 'string' ? v : null)],
    ['x', 'x', (v) => (typeof v === 'number' ? v : Number(v) || 1)],
    ['rate', 'rate', (v) => (typeof v === 'number' ? v : Number(v) || 0)],
    ['vendor', 'vendor', (v) => (typeof v === 'string' ? v : null)],
    ['datedAt', 'dated_at', (v) => v || null],
    ['notes', 'notes', (v) => (typeof v === 'string' ? v : null)],
    ['sceneId', 'scene_id', (v) => (typeof v === 'string' ? v : null)],
    ['shootDayId', 'shoot_day_id', (v) => (typeof v === 'string' ? v : null)],
    ['spansAllShootDays', 'spans_all_shoot_days', (v) => Boolean(v)],
    ['resourceType', 'resource_type', (v) => (typeof v === 'string' ? v.slice(0, 40) : null)],
    ['resourceKey', 'resource_key', (v) => (typeof v === 'string' ? v.slice(0, 80) : null)],
  ]
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  for (const [reqKey, col, transform] of map) {
    if (reqKey in (req.body ?? {})) {
      updates.push(`${col} = $${i++}`)
      values.push(transform(req.body[reqKey]))
    }
  }
  if (updates.length === 0) { res.status(400).json({ error: 'no_fields' }); return }
  values.push(itemId)
  await pool.query(`UPDATE budget_line_items SET ${updates.join(', ')} WHERE id = $${i}`, values)
  markProjectDirty(lookup.rows[0].project_id)
  void emitItemUpdated(lookup.rows[0].project_id, itemId, user.id)
  res.json({ ok: true })
})

budgetsRouter.delete('/items/:itemId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const itemId = req.params.itemId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT b.project_id FROM budget_line_items li
       JOIN budget_accounts a ON a.id = li.account_id
       JOIN budgets b ON b.id = a.budget_id WHERE li.id = $1`, [itemId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return
  await pool.query(`DELETE FROM budget_line_items WHERE id = $1`, [itemId])
  markProjectDirty(lookup.rows[0].project_id)
  emit(lookup.rows[0].project_id, 'budget.item.deleted', { itemId }, user.id)
  res.json({ ok: true })
})

// All budget items relevant to a scene — scene-specific + shared
// resources matched by location_tag / character / explicit junction.
// Used by the SceneDetailModal. Returns sceneUsageCount so the UI
// can show "Used in 17 scenes" badges on shared rows.
budgetsRouter.get('/scenes/:sceneId/items', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const sceneId = req.params.sceneId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM scenes WHERE id = $1`, [sceneId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await pool.query(
    `SELECT 1 FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [user.id, lookup.rows[0].project_id, user.role],
  )).rows.length) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const items = await getSceneBudgetItems(sceneId)
  res.json({ items })
})

// Items attached to a specific shoot day (equipment, crew, catering,
// vehicles for that day). Lighter than the scene-budget query — no
// shared-resource matching, just direct shoot_day_id = X.
budgetsRouter.get('/shoot-days/:shootDayId/items', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const shootDayId = req.params.shootDayId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM shoot_days WHERE id = $1`, [shootDayId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const access = await pool.query(
    `SELECT 1 FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [user.id, lookup.rows[0].project_id, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
  // Return items physically attached to this shoot day PLUS any
  // "run of shoot" items attached to ANY other shoot day in the
  // same project — those show up on every day's view as read-only
  // info (counts once in total but visible everywhere).
  const { rows } = await pool.query<{
    id: string; account_id: string; code: string | null; description: string;
    amt: string; units: string | null; x: string; rate: string;
    vendor: string | null; dated_at: string | null; notes: string | null;
    position: number; spans_all_shoot_days: boolean;
    is_source: boolean; source_shoot_day_id: string | null;
  }>(
    `SELECT li.id, li.account_id, li.code, li.description, li.amt, li.units,
            li.x, li.rate, li.vendor, li.dated_at, li.notes, li.position,
            li.spans_all_shoot_days,
            (li.shoot_day_id = $1) AS is_source,
            li.shoot_day_id AS source_shoot_day_id
     FROM budget_line_items li
     JOIN budget_accounts a ON a.id = li.account_id
     JOIN budgets b ON b.id = a.budget_id
     WHERE b.project_id = $2
       AND (
         li.shoot_day_id = $1
         OR (li.spans_all_shoot_days = TRUE AND li.shoot_day_id IS NOT NULL)
       )
     ORDER BY li.spans_all_shoot_days DESC, li.position ASC, li.created_at ASC`,
    [shootDayId, lookup.rows[0].project_id],
  )
  // Company-wide fringes + per-diem rates. Read-only in the day view
  // — surfaced so the producer sees the full "if this day happens"
  // cost, not just the direct items. Editing lives in the budget
  // Settings (top-level card), not per-day.
  const summaryRes = await pool.query<{
    cast_payroll_pct: string | null; crew_payroll_pct: string | null;
    cast_per_diem_daily: string | null; crew_per_diem_daily: string | null;
    cast_per_diem_headcount: string | null; crew_per_diem_headcount: string | null;
    home_location_tag: string | null;
    hotel_cast_nightly: string | null; hotel_crew_nightly: string | null;
  }>(
    `SELECT cast_payroll_pct, crew_payroll_pct,
            cast_per_diem_daily, crew_per_diem_daily,
            cast_per_diem_headcount, crew_per_diem_headcount,
            home_location_tag, hotel_cast_nightly, hotel_crew_nightly
       FROM budgets WHERE project_id = $1`,
    [lookup.rows[0].project_id],
  )
  const s = summaryRes.rows[0]
  const castPayrollPct = Number(s?.cast_payroll_pct ?? 33)
  const crewPayrollPct = Number(s?.crew_payroll_pct ?? 15)
  const castPerDiemDaily = Number(s?.cast_per_diem_daily ?? 0)
  const crewPerDiemDaily = Number(s?.crew_per_diem_daily ?? 0)
  const castPerDiemHeadcount = Number(s?.cast_per_diem_headcount ?? 0)
  const crewPerDiemHeadcount = Number(s?.crew_per_diem_headcount ?? 0)
  // Per diem for THIS day is only paid if the day is away from home.
  // Same rule as hotels — if the day's location tag differs from
  // home_location_tag, cast/crew get per diem.
  const castPerDiemPerDayIfAway = castPerDiemDaily * castPerDiemHeadcount
  const crewPerDiemPerDayIfAway = crewPerDiemDaily * crewPerDiemHeadcount

  // Hotel cost for THIS day. Compare the day's location_tag to the
  // budget's home_location_tag — if they don't match (and the day is
  // tagged), hotels are required.
  const dayRes = await pool.query<{ location_tag: string | null; is_break: boolean }>(
    `SELECT location_tag, is_break FROM shoot_days WHERE id = $1`, [shootDayId],
  )
  const dayRow = dayRes.rows[0]
  const homeTag = s?.home_location_tag?.trim().toLowerCase() ?? null
  const dayTag = dayRow?.location_tag?.trim().toLowerCase() ?? null
  const needsHotels = !dayRow?.is_break && dayTag !== null && dayTag !== homeTag
  const hotelCastNightly = Number(s?.hotel_cast_nightly ?? 0)
  const hotelCrewNightly = Number(s?.hotel_crew_nightly ?? 0)
  const dayHotelCost = needsHotels
    ? (hotelCastNightly * castPerDiemHeadcount) + (hotelCrewNightly * crewPerDiemHeadcount)
    : 0

  // Scene-attached rollup for this day. Each scene owns its own
  // priced line items (wardrobe, props, VFX, etc.); when a scene is
  // scheduled here, its budgeted total should be visible + editable
  // from the day view too. Producer clicks a scene chip → scene modal
  // opens → edits items → returns here.
  const scenesRes = await pool.query<{
    id: string; number: string; slug: string | null; item_count: string; total: string;
  }>(
    `SELECT s.id, s.number, s.slug,
            COUNT(li.id)::int AS item_count,
            COALESCE(SUM(li.amt * li.x * li.rate), 0)::numeric AS total
       FROM scenes s
       LEFT JOIN budget_line_items li ON li.scene_id = s.id
      WHERE s.shoot_day_id = $1
   GROUP BY s.id, s.number, s.slug, s.day_position, s.script_position
   ORDER BY s.day_position ASC, s.script_position ASC`,
    [shootDayId],
  )
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      code: r.code,
      description: r.description,
      amt: Number(r.amt),
      units: r.units,
      x: Number(r.x),
      rate: Number(r.rate),
      vendor: r.vendor,
      datedAt: r.dated_at,
      notes: r.notes,
      position: r.position,
      total: Number(r.amt) * Number(r.x) * Number(r.rate),
      spansAllShootDays: r.spans_all_shoot_days,
      isSource: r.is_source,
      sourceShootDayId: r.source_shoot_day_id,
    })),
    scenes: scenesRes.rows.map((r) => ({
      id: r.id,
      number: r.number,
      slug: r.slug,
      itemCount: Number(r.item_count),
      total: Number(r.total),
    })),
    fringes: {
      castPayrollPct,
      crewPayrollPct,
      castPerDiemPerDay: needsHotels ? castPerDiemPerDayIfAway : 0,
      crewPerDiemPerDay: needsHotels ? crewPerDiemPerDayIfAway : 0,
      dayHotelCost,
      needsHotels,
      dayLocationTag: dayRow?.location_tag ?? null,
      homeLocationTag: s?.home_location_tag ?? null,
    },
  })
})

// Quick-add a day-level item. Bucketed by code:
//   CAST       — cast on call that day (actor day rates)
//   CREW       — crew on call (positions like DP, AD, mixer)
//   EQUIPMENT  — camera/grip/electric/sound rentals
//   LOCATION   — location fees for this specific shoot day
//   CATERING   — meals
//   OTHER      — transport, parking, base camp, etc.
// All routed into the lazy "Day Costs" account so they roll up into
// Production target.
budgetsRouter.post('/shoot-days/:shootDayId/quick-add', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const shootDayId = req.params.shootDayId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM shoot_days WHERE id = $1`, [shootDayId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return
  const description = String(req.body?.description ?? '').trim().slice(0, 200)
  const vendor = req.body?.vendor != null ? String(req.body.vendor).trim().slice(0, 200) : null
  const cost = Number(req.body?.cost) || 0
  const codeRaw = String(req.body?.code ?? 'OTHER').toUpperCase()
  const code = ['CAST', 'CREW', 'EQUIPMENT', 'LOCATION', 'CATERING', 'OTHER'].includes(codeRaw) ? codeRaw : 'OTHER'
  if (!description) { res.status(400).json({ error: 'description_required' }); return }

  // Find or lazily create the budget + "Day Costs" account
  const budget = await pool.query<{ id: string }>(
    `SELECT id FROM budgets WHERE project_id = $1`, [lookup.rows[0].project_id],
  )
  if (budget.rows.length === 0) { res.status(400).json({ error: 'no_budget', message: 'Create a budget first.' }); return }
  const budgetId = budget.rows[0].id
  let dayAcct = await pool.query<{ id: string }>(
    `SELECT id FROM budget_accounts WHERE budget_id = $1 AND code = '__day_costs__' LIMIT 1`,
    [budgetId],
  )
  let accountId: string
  if (dayAcct.rows.length === 0) {
    const posRes = await pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_accounts WHERE budget_id = $1`,
      [budgetId],
    )
    const created = await pool.query<{ id: string }>(
      `INSERT INTO budget_accounts (budget_id, code, name, category, position)
       VALUES ($1, '__day_costs__', 'Day Costs', 'production', $2) RETURNING id`,
      [budgetId, posRes.rows[0].next],
    )
    accountId = created.rows[0].id
  } else {
    accountId = dayAcct.rows[0].id
  }

  const posRes = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
    [accountId],
  )
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO budget_line_items
       (account_id, shoot_day_id, code, description, vendor, amt, x, rate, units, position, created_by)
     VALUES ($1, $2, $3, $4, $5, 1, 1, $6, 'Flat', $7, $8) RETURNING id`,
    [accountId, shootDayId, code, description, vendor || null, cost, posRes.rows[0].next, user.id],
  )
  markProjectDirty(lookup.rows[0].project_id)
  void emitItemUpdated(lookup.rows[0].project_id, rows[0].id, user.id)
  res.json({ ok: true, id: rows[0].id })
})

// Auto-add one CAST row per character appearing in the scenes
// scheduled for this shoot day. Each row gets the character name as
// description, code='CAST', amount=0 — producer fills in the day
// rate. Skips characters already represented as a day cost row to
// keep idempotent.
budgetsRouter.post('/shoot-days/:shootDayId/auto-add-cast', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const shootDayId = req.params.shootDayId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM shoot_days WHERE id = $1`, [shootDayId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return

  const characters = await pool.query<{ name: string }>(
    `SELECT DISTINCT jsonb_array_elements_text(characters) AS name
     FROM scenes WHERE shoot_day_id = $1`,
    [shootDayId],
  )
  const names = characters.rows.map((r) => r.name).filter(Boolean)
  if (names.length === 0) {
    res.json({ ok: true, added: 0, message: 'No scenes scheduled on this day yet.' }); return
  }

  const existing = await pool.query<{ description: string }>(
    `SELECT description FROM budget_line_items
     WHERE shoot_day_id = $1 AND code = 'CAST'`,
    [shootDayId],
  )
  const existingNames = new Set(existing.rows.map((r) => r.description.toUpperCase()))
  const newNames = names.filter((n) => !existingNames.has(n.toUpperCase()))

  if (newNames.length === 0) {
    res.json({ ok: true, added: 0, message: 'All characters on call already have cast rows.' }); return
  }

  // Find / create Day Costs account
  const budget = await pool.query<{ id: string }>(
    `SELECT id FROM budgets WHERE project_id = $1`, [lookup.rows[0].project_id],
  )
  if (budget.rows.length === 0) { res.status(400).json({ error: 'no_budget' }); return }
  let acct = await pool.query<{ id: string }>(
    `SELECT id FROM budget_accounts WHERE budget_id = $1 AND code = '__day_costs__' LIMIT 1`,
    [budget.rows[0].id],
  )
  let accountId: string
  if (acct.rows.length === 0) {
    const posRes = await pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_accounts WHERE budget_id = $1`,
      [budget.rows[0].id],
    )
    const created = await pool.query<{ id: string }>(
      `INSERT INTO budget_accounts (budget_id, code, name, category, position)
       VALUES ($1, '__day_costs__', 'Day Costs', 'production', $2) RETURNING id`,
      [budget.rows[0].id, posRes.rows[0].next],
    )
    accountId = created.rows[0].id
  } else {
    accountId = acct.rows[0].id
  }

  let position = 0
  for (const name of newNames) {
    position += 10
    await pool.query(
      `INSERT INTO budget_line_items
        (account_id, shoot_day_id, code, description, amt, x, rate, units, position, created_by)
       VALUES ($1, $2, 'CAST', $3, 1, 1, 0, 'Day rate', $4, $5)`,
      [accountId, shootDayId, name, position, user.id],
    )
  }
  markProjectDirty(lookup.rows[0].project_id)
  emit(lookup.rows[0].project_id, 'budget.bulk.changed', { reason: 'auto_cast' }, user.id)
  res.json({ ok: true, added: newNames.length, characters: newNames })
})

// "Make this item shared across every scene with the same
// location/character/etc." A convenience for the SceneDetailModal:
// the producer clicks "📍 Make shared with all scenes at this
// location" and we set resource_type + resource_key based on the
// scene context.
budgetsRouter.post('/items/:itemId/promote-to-shared', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const itemId = req.params.itemId
  const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null
  const kind = typeof req.body?.kind === 'string' ? req.body.kind : null
  if (!sceneId || !kind) { res.status(400).json({ error: 'sceneId_and_kind_required' }); return }
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT b.project_id FROM budget_line_items li
       JOIN budget_accounts a ON a.id = li.account_id
       JOIN budgets b ON b.id = a.budget_id WHERE li.id = $1`, [itemId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, lookup.rows[0].project_id, res)) return

  if (kind === 'LOCATION') {
    const scn = await pool.query<{ location_tag: string | null }>(
      `SELECT location_tag FROM scenes WHERE id = $1`, [sceneId],
    )
    const tag = scn.rows[0]?.location_tag
    if (!tag) { res.status(400).json({ error: 'no_location_tag' }); return }
    await pool.query(
      `UPDATE budget_line_items
         SET resource_type = 'LOCATION', resource_key = $1, scene_id = NULL
       WHERE id = $2`,
      [tag, itemId],
    )
    markProjectDirty(lookup.rows[0].project_id)
    res.json({ ok: true, resourceType: 'LOCATION', resourceKey: tag })
    return
  }
  res.status(400).json({ error: 'unsupported_kind', message: 'Only LOCATION promote supported for now.' })
})

// Zero out prices on every budget item in a project — gives the
// producer a clean plate to start from. Optionally preserves prices
// on items in specific categories (e.g. keepCategories=['above_line']
// to keep cast/director fees the team already negotiated).
// Descriptions, scene attachments, and resource links stay intact.
budgetsRouter.post('/projects/:projectId/reset-prices', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const keepRaw = req.body?.keepCategories
  const keepCategories = Array.isArray(keepRaw)
    ? keepRaw.filter((c): c is string => typeof c === 'string')
    : []
  const validCats = keepCategories.filter((c) => ['above_line', 'production', 'post', 'other'].includes(c))
  const result = await pool.query<{ count: string }>(
    `WITH updated AS (
       UPDATE budget_line_items li
         SET amt = 0, x = 1, rate = 0
       FROM budget_accounts a, budgets b
       WHERE li.account_id = a.id
         AND a.budget_id = b.id
         AND b.project_id = $1
         AND a.category <> ALL($2::text[])
       RETURNING li.id
     )
     SELECT COUNT(*)::text AS count FROM updated`,
    [projectId, validCats],
  )
  markProjectDirty(projectId)
  emit(projectId, 'budget.bulk.changed', { reason: 'reset_prices' }, user.id)
  logInfo('budget prices reset', { projectId, by: user.id, kept: validCats, zeroed: Number(result.rows[0].count) })
  res.json({ ok: true, zeroed: Number(result.rows[0].count), keptCategories: validCats })
})

// Replace the generic Lead/Supporting/Day Player template rows in
// the CAST account with one row per character from the script.
// Buckets:
//   Lead Cast (14-01)        top 2 by scene count
//   Supporting Cast (14-02)  3+ scene appearances, not in Lead
//   Day Players (14-03)      1–2 scene appearances
// Sub-codes append the character index (14-01-a, -b, ...). Producer
// can edit, delete, or merge after — same as Claude's breakdown.
budgetsRouter.post('/projects/:projectId/populate-cast-from-script', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return

  // Aggregate characters across all scenes
  const scenes = await pool.query<{ characters: string[] }>(
    `SELECT characters FROM scenes WHERE project_id = $1`,
    [projectId],
  )
  const counts = new Map<string, number>()
  for (const s of scenes.rows) {
    for (const c of s.characters ?? []) {
      const name = String(c).trim()
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  if (counts.size === 0) {
    res.status(400).json({ error: 'no_characters', message: 'No characters found. Upload a .fdx first.' })
    return
  }
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, scenes]) => ({ name, scenes }))

  // Find the CAST account (14-00) on this project's budget
  const acct = await pool.query<{ id: string }>(
    `SELECT a.id FROM budget_accounts a
     JOIN budgets b ON b.id = a.budget_id
     WHERE b.project_id = $1 AND a.code = '14-00'
     LIMIT 1`,
    [projectId],
  )
  if (acct.rows.length === 0) {
    res.status(400).json({ error: 'no_cast_account', message: 'CAST account (14-00) not found on this budget.' })
    return
  }
  const accountId = acct.rows[0].id

  // Wipe existing CAST line items only if they are still zero-cost
  // (template placeholders or breakdown defaults). Priced rows the
  // producer already entered stay put.
  await pool.query(
    `DELETE FROM budget_line_items
     WHERE account_id = $1 AND amt = 0 AND x = 1 AND rate = 0`,
    [accountId],
  )

  let position = 0
  const LEAD = 2
  for (const { name, scenes } of ranked) {
    position += 10
    const bucket = position <= LEAD * 10 ? 'Lead' : scenes >= 3 ? 'Supporting' : 'Day Player'
    const code = bucket === 'Lead' ? '14-01' : bucket === 'Supporting' ? '14-02' : '14-03'
    await pool.query(
      `INSERT INTO budget_line_items
        (account_id, code, description, amt, x, rate, units, notes, position, created_by)
       VALUES ($1, $2, $3, 0, 1, 0, $4, $5, $6, $7)`,
      [
        accountId,
        code,
        name,
        bucket === 'Lead' ? 'Flat' : 'Days',
        `${scenes} scene${scenes === 1 ? '' : 's'} in script`,
        position,
        user.id,
      ],
    )
  }
  markProjectDirty(projectId)
  emit(projectId, 'budget.bulk.changed', { reason: 'populate_cast' }, user.id)
  logInfo('cast populated from script', { projectId, by: user.id, count: ranked.length })
  res.json({ ok: true, count: ranked.length })
})

// Smart wardrobe clustering: for each character, send all their
// per-scene wardrobe descriptions to Claude, get back distinct
// outfit clusters, create one shared row per outfit attached to
// every scene where that outfit appears. Producer prices once,
// covers every scene that uses the same look.
budgetsRouter.post('/projects/:projectId/cluster-wardrobe', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  try {
    const result = await clusterProjectWardrobe(projectId, user.id)
    markProjectDirty(projectId)
    emit(projectId, 'budget.bulk.changed', { reason: 'cluster_wardrobe' }, user.id)
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: msg.slice(0, 400) })
  }
})

// Legacy dumb "consolidate everything per character" — kept for now
// appears — Claude generates a per-scene wardrobe row for each, with
// slightly different descriptions. This consolidates them: one row
// per character, marked as a shared WARDROBE resource keyed on the
// character's name. Any scene the character is in will see it.
//
// Logic:
//   - Find every line item where code = 'WARDROBE' and the item isn't
//     already a shared resource
//   - Parse the character name from the description (the part before
//     the first colon — Claude formats them as "JANE: white sundress")
//   - Group by normalized character name
//   - Pick the highest non-zero price as the rolled-up cost (so any
//     pricing already entered survives)
//   - Delete the per-scene rows in the group
//   - Insert one new shared row per character with
//     resource_type='WARDROBE', resource_key=<normalized name>
//   - Characters without a colon prefix get bucketed as "Misc wardrobe"
//
// Returns counts so the producer knows what happened.
budgetsRouter.post('/projects/:projectId/consolidate-wardrobe', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return

  const { rows } = await pool.query<{
    id: string; description: string; amt: string; x: string; rate: string;
    account_id: string;
  }>(
    `SELECT li.id, li.description, li.amt, li.x, li.rate, li.account_id
     FROM budget_line_items li
     JOIN budget_accounts a ON a.id = li.account_id
     JOIN budgets b ON b.id = a.budget_id
     WHERE b.project_id = $1 AND li.code = 'WARDROBE' AND li.resource_type IS NULL`,
    [projectId],
  )
  if (rows.length === 0) {
    res.json({ ok: true, consolidated: 0, charactersFound: 0 })
    return
  }

  // Normalize the character name the same way scenes.characters
  // entries get normalized in scene_budget.ts (lowercase, non-word
  // chars to underscores).
  function normalizeKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  }
  function characterFromDescription(d: string): { display: string; key: string } {
    const colonIdx = d.indexOf(':')
    if (colonIdx > 0 && colonIdx < 60) {
      const name = d.slice(0, colonIdx).trim()
      return { display: name.toUpperCase(), key: normalizeKey(name) }
    }
    return { display: 'MISC', key: 'misc_wardrobe' }
  }

  type Group = { display: string; key: string; ids: string[]; maxCost: number; accountId: string }
  const groups = new Map<string, Group>()
  for (const r of rows) {
    const { display, key } = characterFromDescription(r.description)
    if (!key) continue
    const cost = Number(r.amt) * Number(r.x) * Number(r.rate)
    const existing = groups.get(key)
    if (existing) {
      existing.ids.push(r.id)
      if (cost > existing.maxCost) existing.maxCost = cost
    } else {
      groups.set(key, { display, key, ids: [r.id], maxCost: cost, accountId: r.account_id })
    }
  }

  let consolidated = 0
  for (const g of groups.values()) {
    if (g.ids.length < 2 && g.maxCost === 0) continue // skip singletons with no value
    await pool.query(
      `DELETE FROM budget_line_items WHERE id = ANY($1::uuid[])`,
      [g.ids],
    )
    const posRes = await pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
      [g.accountId],
    )
    await pool.query(
      `INSERT INTO budget_line_items
        (account_id, code, description, amt, x, rate, units, notes, resource_type, resource_key, position, created_by)
       VALUES ($1, 'WARDROBE', $2, 1, 1, $3, 'Flat', $4, 'WARDROBE', $5, $6, $7)`,
      [
        g.accountId,
        `${g.display} — full wardrobe (all scenes)`,
        g.maxCost,
        `Consolidated from ${g.ids.length} scene-level wardrobe item${g.ids.length === 1 ? '' : 's'}.`,
        g.key,
        posRes.rows[0].next,
        user.id,
      ],
    )
    consolidated += g.ids.length
  }

  markProjectDirty(projectId)
  emit(projectId, 'budget.bulk.changed', { reason: 'consolidate_wardrobe' }, user.id)
  logInfo('wardrobe consolidated', { projectId, by: user.id, characters: groups.size, deletedRows: consolidated })
  res.json({ ok: true, charactersFound: groups.size, consolidated })
})
