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
import { Resend } from 'resend'
import { pool } from '../db'
import { requireAdmin } from '../auth'
import { logError, logInfo } from '../diag'

export const outreachDomainsRouter = Router()
outreachDomainsRouter.use(requireAdmin)

const resendKey = process.env.RESEND_API_KEY
const resend = resendKey ? new Resend(resendKey) : null

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

// Cross-check every Slate sending_domains row against what the
// RESEND_API_KEY on this Railway service can actually see. Fixes the
// "Slate thinks verified, Resend says nope" mismatch by making Slate
// mirror Resend's truth. Returns a per-domain diff so the operator can
// see exactly what changed.
outreachDomainsRouter.post('/sync-with-resend', async (_req, res) => {
  if (!resend) {
    res.status(503).json({ error: 'resend_not_configured' })
    return
  }
  let resendDomains: Array<{ id: string; name: string; status: string; region?: string }>
  try {
    const list = await resend.domains.list()
    if (list.error) {
      logError('outreach: resend.domains.list error', { error: list.error })
      res.status(502).json({
        error: 'resend_api_error',
        detail: list.error.message ?? String(list.error),
      })
      return
    }
    // Resend SDK returns either an array or { data: [...] } depending on version.
    // Normalize both shapes.
    const raw = list.data as unknown
    resendDomains = Array.isArray(raw)
      ? (raw as Array<{ id: string; name: string; status: string; region?: string }>)
      : ((raw as { data?: Array<{ id: string; name: string; status: string; region?: string }> })?.data ?? [])
  } catch (err) {
    logError('outreach: resend.domains.list threw', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(502).json({
      error: 'resend_api_threw',
      detail: err instanceof Error ? err.message : String(err),
    })
    return
  }

  const byName = new Map<string, { id: string; status: string; region?: string }>()
  for (const d of resendDomains) {
    byName.set(d.name.toLowerCase(), { id: d.id, status: d.status, region: d.region })
  }

  const { rows: slateDomains } = await pool.query<{
    id: string; name: string; status: string; resend_id: string | null;
  }>(`SELECT id, name, status, resend_id FROM sending_domains ORDER BY created_at ASC`)

  const changes: Array<{
    name: string;
    before: { status: string; resend_id: string | null };
    after: { status: string; resend_id: string | null };
    resendVisibility: 'visible' | 'missing';
    resendStatus: string | null;
    action: 'updated' | 'unchanged' | 'missing_in_resend';
  }> = []

  for (const s of slateDomains) {
    const resendMatch = byName.get(s.name.toLowerCase())
    if (!resendMatch) {
      // Domain in Slate but Resend doesn't see it. That's the smoking
      // gun — either wrong API key/team, or the domain was never
      // registered in Resend. Flip Slate status to 'pending' so the
      // sender skips it and it's obvious in the UI.
      const nextStatus = 'pending'
      if (s.status !== nextStatus) {
        await pool.query(
          `UPDATE sending_domains SET status = $1, updated_at = now() WHERE id = $2`,
          [nextStatus, s.id],
        )
        changes.push({
          name: s.name,
          before: { status: s.status, resend_id: s.resend_id },
          after: { status: nextStatus, resend_id: s.resend_id },
          resendVisibility: 'missing',
          resendStatus: null,
          action: 'updated',
        })
      } else {
        changes.push({
          name: s.name,
          before: { status: s.status, resend_id: s.resend_id },
          after: { status: nextStatus, resend_id: s.resend_id },
          resendVisibility: 'missing',
          resendStatus: null,
          action: 'missing_in_resend',
        })
      }
      continue
    }
    // Resend statuses: not_started, pending, verified, failure, temporary_failure.
    // Map them onto Slate's status vocabulary.
    let mapped: 'pending' | 'verifying' | 'verified' | 'failed'
    switch (resendMatch.status) {
      case 'verified':          mapped = 'verified'; break
      case 'pending':           mapped = 'verifying'; break
      case 'not_started':       mapped = 'pending'; break
      case 'failure':
      case 'temporary_failure': mapped = 'failed'; break
      default:                  mapped = 'pending'; break
    }
    if (s.status !== mapped || s.resend_id !== resendMatch.id) {
      await pool.query(
        `UPDATE sending_domains SET status = $1, resend_id = $2, updated_at = now() WHERE id = $3`,
        [mapped, resendMatch.id, s.id],
      )
      changes.push({
        name: s.name,
        before: { status: s.status, resend_id: s.resend_id },
        after: { status: mapped, resend_id: resendMatch.id },
        resendVisibility: 'visible',
        resendStatus: resendMatch.status,
        action: 'updated',
      })
    } else {
      changes.push({
        name: s.name,
        before: { status: s.status, resend_id: s.resend_id },
        after: { status: mapped, resend_id: resendMatch.id },
        resendVisibility: 'visible',
        resendStatus: resendMatch.status,
        action: 'unchanged',
      })
    }
  }

  logInfo('outreach: resend sync complete', {
    resendDomainCount: resendDomains.length,
    slateDomainCount: slateDomains.length,
    updated: changes.filter((c) => c.action === 'updated').length,
    missing: changes.filter((c) => c.action === 'missing_in_resend').length,
  })
  res.json({
    ok: true,
    resendDomainsSeen: resendDomains.map((d) => ({ name: d.name, status: d.status, region: d.region ?? null })),
    changes,
  })
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
