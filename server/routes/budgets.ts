import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { STUDIOBINDER_ACCOUNTS } from '../budget_template'
import { logInfo } from '../diag'

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
    `SELECT id, account_id, code, description, amt, units, x, rate, vendor, dated_at, notes, position
     FROM budget_line_items
     WHERE account_id = ANY($1) ORDER BY position ASC, created_at ASC`,
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
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
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
  const access = await pool.query(
    `SELECT b.id FROM budgets b JOIN projects p ON p.id = b.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE b.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, budgetId, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
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
  const access = await pool.query(
    `SELECT a.id FROM budget_accounts a
     JOIN budgets b ON b.id = a.budget_id
     JOIN projects p ON p.id = b.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE a.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, accountId, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
  const { code, description, amt, units, x, rate, vendor, datedAt, notes } = req.body ?? {}
  if (typeof description !== 'string' || description.trim().length === 0) {
    res.status(400).json({ error: 'description_required' }); return
  }
  const posRes = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
    [accountId],
  )
  const { rows } = await pool.query(
    `INSERT INTO budget_line_items
       (account_id, code, description, amt, units, x, rate, vendor, dated_at, notes, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      accountId,
      typeof code === 'string' ? code : null,
      description.trim().slice(0, 200),
      Number(amt) || 0,
      typeof units === 'string' ? units : null,
      Number(x) || 1,
      Number(rate) || 0,
      typeof vendor === 'string' ? vendor : null,
      datedAt || null,
      typeof notes === 'string' ? notes : null,
      posRes.rows[0].next,
      user.id,
    ],
  )
  res.json({ id: rows[0].id })
})

// Update / delete a line item
budgetsRouter.patch('/items/:itemId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const itemId = req.params.itemId
  const access = await pool.query(
    `SELECT li.id FROM budget_line_items li
     JOIN budget_accounts a ON a.id = li.account_id
     JOIN budgets b ON b.id = a.budget_id
     JOIN projects p ON p.id = b.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE li.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, itemId, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
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
  res.json({ ok: true })
})

budgetsRouter.delete('/items/:itemId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const itemId = req.params.itemId
  const access = await pool.query(
    `SELECT li.id FROM budget_line_items li
     JOIN budget_accounts a ON a.id = li.account_id
     JOIN budgets b ON b.id = a.budget_id
     JOIN projects p ON p.id = b.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE li.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, itemId, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
  await pool.query(`DELETE FROM budget_line_items WHERE id = $1`, [itemId])
  res.json({ ok: true })
})
