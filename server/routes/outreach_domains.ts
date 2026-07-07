// Admin API for the guest-outreach sending-domain pool.
//
//   GET    /api/admin/outreach/domains        → list every domain in the pool
//   POST   /api/admin/outreach/domains        → add a domain (name, notes, primary_show_id?)
//   PATCH  /api/admin/outreach/domains/:id    → toggle active, edit notes/status/pin
//   DELETE /api/admin/outreach/domains/:id    → drop from the pool
//
// All admin-only. Resend API integration for automatic verification +
// health scoring lands with the sender migration. For MVP the operator
// adds domains in the Resend dashboard, then pastes the name here.

import { Router } from 'express'
import { pool } from '../db'
import { requireAdmin } from '../auth'

export const outreachDomainsRouter = Router()
outreachDomainsRouter.use(requireAdmin)

const VALID_STATUS = new Set(['pending', 'verifying', 'verified', 'failed', 'paused'])
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

outreachDomainsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.status, d.active, d.resend_id,
            d.primary_show_id, p.name AS primary_show_name,
            d.warmup_start_date, d.health_score, d.bounce_rate,
            d.complaint_rate, d.reply_rate, d.last_computed_at,
            d.notes, d.created_at, d.updated_at
       FROM sending_domains d
       LEFT JOIN projects p ON p.id = d.primary_show_id
      ORDER BY d.created_at ASC`,
  )
  res.json({ domains: rows })
})

outreachDomainsRouter.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim().toLowerCase()
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null
  const primaryShowId = typeof req.body?.primaryShowId === 'string' && req.body.primaryShowId
    ? req.body.primaryShowId : null

  if (!NAME_RE.test(name)) {
    res.status(400).json({ error: 'invalid_domain_name' })
    return
  }
  if (primaryShowId) {
    // Verify the show exists and is a podcast — we're only exposing
    // outreach on podcast projects.
    const check = await pool.query(
      `SELECT 1 FROM projects WHERE id = $1 AND kind = 'podcast' LIMIT 1`,
      [primaryShowId],
    )
    if (check.rows.length === 0) {
      res.status(400).json({ error: 'primary_show_not_a_podcast' })
      return
    }
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO sending_domains (name, notes, primary_show_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, status, active, primary_show_id, notes, created_at`,
      [name, notes, primaryShowId],
    )
    res.json({ domain: rows[0] })
  } catch (err) {
    // Unique-violation on name → 409, cleaner than a 500.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('sending_domains_name_key') || msg.includes('duplicate key')) {
      res.status(409).json({ error: 'domain_already_exists' })
      return
    }
    throw err
  }
})

outreachDomainsRouter.patch('/:id', async (req, res) => {
  const id = req.params.id
  const patch = req.body ?? {}
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1
  if (typeof patch.active === 'boolean') {
    sets.push(`active = $${idx++}`)
    values.push(patch.active)
  }
  if (typeof patch.status === 'string') {
    if (!VALID_STATUS.has(patch.status)) {
      res.status(400).json({ error: 'invalid_status' })
      return
    }
    sets.push(`status = $${idx++}`)
    values.push(patch.status)
  }
  if (typeof patch.notes === 'string' || patch.notes === null) {
    sets.push(`notes = $${idx++}`)
    values.push(patch.notes ? String(patch.notes).trim() : null)
  }
  if ('primaryShowId' in patch) {
    const showId = typeof patch.primaryShowId === 'string' && patch.primaryShowId ? patch.primaryShowId : null
    if (showId) {
      const check = await pool.query(
        `SELECT 1 FROM projects WHERE id = $1 AND kind = 'podcast' LIMIT 1`,
        [showId],
      )
      if (check.rows.length === 0) {
        res.status(400).json({ error: 'primary_show_not_a_podcast' })
        return
      }
    }
    sets.push(`primary_show_id = $${idx++}`)
    values.push(showId)
  }
  if (typeof patch.resendId === 'string' || patch.resendId === null) {
    sets.push(`resend_id = $${idx++}`)
    values.push(patch.resendId ? String(patch.resendId).trim() : null)
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'no_fields_to_update' })
    return
  }
  sets.push(`updated_at = now()`)
  values.push(id)
  const { rowCount } = await pool.query(
    `UPDATE sending_domains SET ${sets.join(', ')} WHERE id = $${idx}`,
    values,
  )
  if (rowCount === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ ok: true })
})

outreachDomainsRouter.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM sending_domains WHERE id = $1`,
    [req.params.id],
  )
  if (rowCount === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ ok: true })
})
