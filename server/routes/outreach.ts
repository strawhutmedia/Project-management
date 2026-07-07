// Per-show outreach API: template editor + prospect list.
//
//   GET   /api/outreach/projects/:projectId/template
//   PUT   /api/outreach/projects/:projectId/template
//
//   GET    /api/outreach/projects/:projectId/prospects
//   POST   /api/outreach/projects/:projectId/prospects
//   PATCH  /api/outreach/prospects/:id
//   DELETE /api/outreach/prospects/:id
//
// Admin-only for now (Ryan + Caroline). Non-admins get 403 even if
// they have project access — outreach is a keys-to-the-kingdom feature
// and shouldn't be exposed to producers/editors.

import { Router } from 'express'
import { pool } from '../db'
import { requireAdmin, type SessionUser } from '../auth'

export const outreachRouter = Router()
outreachRouter.use(requireAdmin)

// ─── Templates ──────────────────────────────────────────────────────
outreachRouter.get('/projects/:projectId/template', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT project_id, subject, body, from_name, reply_to, updated_at
       FROM outreach_templates WHERE project_id = $1`,
    [req.params.projectId],
  )
  res.json({ template: rows[0] ?? null })
})

outreachRouter.put('/projects/:projectId/template', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const subject = String(req.body?.subject ?? '')
  const body = String(req.body?.body ?? '')
  const fromName = typeof req.body?.fromName === 'string' && req.body.fromName.trim()
    ? req.body.fromName.trim() : null
  const replyTo = typeof req.body?.replyTo === 'string' && req.body.replyTo.trim()
    ? req.body.replyTo.trim() : null
  await pool.query(
    `INSERT INTO outreach_templates
       (project_id, subject, body, from_name, reply_to, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (project_id) DO UPDATE SET
       subject = EXCLUDED.subject,
       body = EXCLUDED.body,
       from_name = EXCLUDED.from_name,
       reply_to = EXCLUDED.reply_to,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [projectId, subject, body, fromName, replyTo, user.id],
  )
  res.json({ ok: true })
})

// ─── Prospects ──────────────────────────────────────────────────────

const RECIPIENT_TYPES = new Set(['person', 'agent', 'manager', 'other'])
const STATUSES = new Set([
  'needs_email','ready','queued','sent','replied','bounced','opted_out','failed',
])

outreachRouter.get('/projects/:projectId/prospects', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, full_name, email, recipient_type, client_name,
            context, unique_sentence, unique_sentence_generated_at, status,
            sent_at, replied_at, bounced_at, sending_domain_id, created_at, updated_at
       FROM outreach_prospects
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [req.params.projectId],
  )
  res.json({ prospects: rows })
})

outreachRouter.post('/projects/:projectId/prospects', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const name = String(req.body?.name ?? '').trim()
  if (!name) { res.status(400).json({ error: 'name_required' }); return }
  const fullName = typeof req.body?.fullName === 'string' && req.body.fullName.trim()
    ? req.body.fullName.trim() : null
  const email = typeof req.body?.email === 'string' && req.body.email.trim()
    ? req.body.email.trim().toLowerCase() : null
  const recipientType = typeof req.body?.recipientType === 'string' && RECIPIENT_TYPES.has(req.body.recipientType)
    ? req.body.recipientType : 'person'
  const clientName = typeof req.body?.clientName === 'string' && req.body.clientName.trim()
    ? req.body.clientName.trim() : null
  const context = typeof req.body?.context === 'string' && req.body.context.trim()
    ? req.body.context.trim() : null
  // Prospects with email start in `needs_email` if nothing set;
  // status transitions later once the unique sentence is generated.
  const initialStatus = email ? 'ready' : 'needs_email'
  const { rows } = await pool.query(
    `INSERT INTO outreach_prospects
       (project_id, name, full_name, email, recipient_type, client_name,
        context, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, full_name, email, recipient_type, client_name,
               context, unique_sentence, unique_sentence_generated_at, status,
               sent_at, replied_at, bounced_at, sending_domain_id, created_at, updated_at`,
    [projectId, name, fullName, email, recipientType, clientName, context, initialStatus, user.id],
  )
  res.json({ prospect: rows[0] })
})

outreachRouter.patch('/prospects/:id', async (req, res) => {
  const id = req.params.id
  const patch = req.body ?? {}
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1
  const addField = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`)
    values.push(val)
  }
  if (typeof patch.name === 'string') {
    const v = patch.name.trim()
    if (!v) { res.status(400).json({ error: 'name_required' }); return }
    addField('name', v)
  }
  if ('fullName' in patch) {
    addField('full_name', typeof patch.fullName === 'string' && patch.fullName.trim() ? patch.fullName.trim() : null)
  }
  if ('email' in patch) {
    addField('email', typeof patch.email === 'string' && patch.email.trim() ? patch.email.trim().toLowerCase() : null)
  }
  if (typeof patch.recipientType === 'string') {
    if (!RECIPIENT_TYPES.has(patch.recipientType)) { res.status(400).json({ error: 'bad_recipient_type' }); return }
    addField('recipient_type', patch.recipientType)
  }
  if ('clientName' in patch) {
    addField('client_name', typeof patch.clientName === 'string' && patch.clientName.trim() ? patch.clientName.trim() : null)
  }
  if ('context' in patch) {
    addField('context', typeof patch.context === 'string' && patch.context.trim() ? patch.context.trim() : null)
  }
  if ('uniqueSentence' in patch) {
    const v = typeof patch.uniqueSentence === 'string' && patch.uniqueSentence.trim() ? patch.uniqueSentence.trim() : null
    addField('unique_sentence', v)
    addField('unique_sentence_generated_at', v ? new Date() : null)
  }
  if (typeof patch.status === 'string') {
    if (!STATUSES.has(patch.status)) { res.status(400).json({ error: 'bad_status' }); return }
    addField('status', patch.status)
  }
  if (sets.length === 0) { res.status(400).json({ error: 'no_fields' }); return }
  sets.push(`updated_at = now()`)
  values.push(id)
  const { rowCount } = await pool.query(
    `UPDATE outreach_prospects SET ${sets.join(', ')} WHERE id = $${idx}`,
    values,
  )
  if (rowCount === 0) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ ok: true })
})

outreachRouter.delete('/prospects/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM outreach_prospects WHERE id = $1`,
    [req.params.id],
  )
  if (rowCount === 0) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ ok: true })
})
