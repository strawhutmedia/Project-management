import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { STUDIOBINDER_ACCOUNTS } from '../budget_template'
import { getSceneBudgetItems } from '../scene_budget'
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
  res.json({
    budget: {
      id: budget.id,
      currency: budget.currency,
      shootDays: budget.shoot_days,
      bondPct: Number(budget.bond_pct),
      contingencyPct: Number(budget.contingency_pct),
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
  const { currency, shootDays, bondPct, contingencyPct, productionTarget, postTarget, marketingTarget, adminTarget, totalTarget } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof currency === 'string') { updates.push(`currency = $${i++}`); values.push(currency) }
  if (typeof shootDays === 'number') { updates.push(`shoot_days = $${i++}`); values.push(shootDays) }
  if (typeof bondPct === 'number') { updates.push(`bond_pct = $${i++}`); values.push(bondPct) }
  if (typeof contingencyPct === 'number') { updates.push(`contingency_pct = $${i++}`); values.push(contingencyPct) }
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
  const { code, description, amt, units, x, rate, vendor, datedAt, notes, sceneId, resourceType, resourceKey } = req.body ?? {}
  if (typeof description !== 'string' || description.trim().length === 0) {
    res.status(400).json({ error: 'description_required' }); return
  }
  const posRes = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
    [accountId],
  )
  const { rows } = await pool.query(
    `INSERT INTO budget_line_items
       (account_id, scene_id, code, description, amt, units, x, rate, vendor, dated_at, notes,
        resource_type, resource_key, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      accountId,
      typeof sceneId === 'string' ? sceneId : null,
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
