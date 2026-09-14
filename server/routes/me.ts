import { Router } from 'express'
import { getSessionUser, requireUser, type SessionUser } from '../auth'
import { pool } from '../db'

export const meRouter = Router()

meRouter.get('/', async (req, res) => {
  const user = await getSessionUser(req)
  res.json({ user })
})

meRouter.patch('/', requireUser, async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { name, displayName, timezone } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof name === 'string' && name.trim().length > 0) {
    updates.push(`name = $${i++}`)
    values.push(name.trim().slice(0, 80))
  }
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    updates.push(`display_name = $${i++}`)
    values.push(displayName.trim().slice(0, 40))
  }
  if (typeof timezone === 'string' && timezone.trim().length > 0) {
    updates.push(`timezone = $${i++}`)
    values.push(timezone.trim().slice(0, 60))
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'no_fields' })
    return
  }
  values.push(user.id)
  await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`,
    values,
  )
  const refreshed = await pool.query(
    `SELECT id, email, name, display_name, role, timezone, is_invoicing_owner FROM users WHERE id = $1`,
    [user.id],
  )
  res.json({ user: refreshed.rows[0] })
})
