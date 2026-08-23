// Per-show audience (email list) API.
//
// PUBLIC (no session — secured by the per-show capture token in the URL):
//   POST /api/audience/hooks/:token
//     Capture endpoint. ManyChat's "External Request" action POSTs here
//     when a DM flow collects an email; any future landing page can use
//     the same endpoint. Body: { email, name?, handle?, trigger_word?, source? }
//
// AUTHED (session required):
//   GET  /api/audience/projects/:projectId              → stats + recent contacts
//                                                         (+ capture URL for writers)
//   GET  /api/audience/projects/:projectId/export.csv   → full list CSV (writer)
//   POST /api/audience/projects/:projectId/contacts     → manual add (writer)
//   POST /api/audience/projects/:projectId/resync       → re-push unsynced to Resend (writer)
//   POST /api/audience/projects/:projectId/rotate-token → new capture token (admin)

import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { logError, logInfo } from '../diag'
import { syncContactToResend, resyncProject } from '../audience_resend'

export const audienceRouter = Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function cleanStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

// ── PUBLIC capture hook (registered BEFORE requireUser) ──────────────
audienceRouter.post('/hooks/:token', async (req, res) => {
  const token = req.params.token
  if (!token || token.length < 16) { res.status(404).json({ error: 'not_found' }); return }
  const proj = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE audience_capture_token = $1`,
    [token],
  )
  if (proj.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const projectId = proj.rows[0].id

  const email = cleanStr(req.body?.email, 320)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'valid_email_required' })
    return
  }
  const name = cleanStr(req.body?.name, 120)
  const handle = cleanStr(req.body?.handle, 120)
  const triggerWord = cleanStr(req.body?.trigger_word, 60)
  const sourceRaw = cleanStr(req.body?.source, 30)
  const source = sourceRaw && ['manychat', 'landing', 'manual', 'import'].includes(sourceRaw)
    ? sourceRaw : 'manychat'

  try {
    // Re-capture of an existing contact refreshes details and clears an
    // unsubscribe (they opted back in by going through the flow again).
    const { rows } = await pool.query<{ id: string; created: boolean }>(
      `INSERT INTO audience_contacts (project_id, email, name, handle, source, trigger_word)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, email) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, audience_contacts.name),
         handle = COALESCE(EXCLUDED.handle, audience_contacts.handle),
         trigger_word = COALESCE(EXCLUDED.trigger_word, audience_contacts.trigger_word),
         unsubscribed_at = NULL
       RETURNING id, (xmax = 0) AS created`,
      [projectId, email, name, handle, source, triggerWord],
    )
    const contact = rows[0]
    // Resend mirror is fire-and-forget — capture must stay fast for
    // ManyChat's request timeout.
    void syncContactToResend({ projectId, contactId: contact.id, email, name })
    logInfo('audience: contact captured', { projectId, source, new: contact.created })
    res.json({ ok: true, new: contact.created })
  } catch (err) {
    logError('audience: capture failed', {
      projectId, error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: 'capture_failed' })
  }
})

// ── Everything below requires a session ──────────────────────────────
audienceRouter.use(requireUser)

async function assertProjectAccess(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE p.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

function captureUrl(token: string): string {
  const baseUrl = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
  return `${baseUrl}/api/audience/hooks/${token}`
}

// GET stats + recent contacts. Writers also get the capture URL
// (generated on first view) for pasting into ManyChat.
audienceRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const stats = await pool.query<{ total: string; last7: string; last30: string; unsubscribed: string; unsynced: string }>(
    `SELECT count(*) FILTER (WHERE unsubscribed_at IS NULL) AS total,
            count(*) FILTER (WHERE unsubscribed_at IS NULL AND created_at > now() - interval '7 days') AS last7,
            count(*) FILTER (WHERE unsubscribed_at IS NULL AND created_at > now() - interval '30 days') AS last30,
            count(*) FILTER (WHERE unsubscribed_at IS NOT NULL) AS unsubscribed,
            count(*) FILTER (WHERE unsubscribed_at IS NULL AND resend_synced_at IS NULL) AS unsynced
       FROM audience_contacts WHERE project_id = $1`,
    [projectId],
  )
  const recent = await pool.query(
    `SELECT id, email, name, handle, source, trigger_word, resend_synced_at, created_at
       FROM audience_contacts
      WHERE project_id = $1 AND unsubscribed_at IS NULL
      ORDER BY created_at DESC LIMIT 20`,
    [projectId],
  )
  // Capture token: admins + project writers can see/mint it.
  let capture: { token: string; url: string } | null = null
  const isWriter = user.role === 'admin' || await assertProjectAccess(user.id, user.role, projectId)
  if (isWriter) {
    const t = await pool.query<{ audience_capture_token: string | null }>(
      `SELECT audience_capture_token FROM projects WHERE id = $1`, [projectId],
    )
    let token = t.rows[0]?.audience_capture_token ?? null
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url')
      await pool.query(
        `UPDATE projects SET audience_capture_token = $2
          WHERE id = $1 AND audience_capture_token IS NULL`,
        [projectId, token],
      )
      const re = await pool.query<{ audience_capture_token: string }>(
        `SELECT audience_capture_token FROM projects WHERE id = $1`, [projectId],
      )
      token = re.rows[0].audience_capture_token
    }
    capture = { token, url: captureUrl(token) }
  }
  const s = stats.rows[0]
  res.json({
    stats: {
      total: Number(s.total), last7: Number(s.last7), last30: Number(s.last30),
      unsubscribed: Number(s.unsubscribed), unsynced: Number(s.unsynced),
    },
    recent: recent.rows,
    capture,
  })
})

// CSV export — writer only (it's PII).
audienceRouter.get('/projects/:projectId/export.csv', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const { rows } = await pool.query<{
    email: string; name: string | null; handle: string | null;
    source: string; trigger_word: string | null; created_at: string;
  }>(
    `SELECT email, name, handle, source, trigger_word, created_at
       FROM audience_contacts
      WHERE project_id = $1 AND unsubscribed_at IS NULL
      ORDER BY created_at`,
    [projectId],
  )
  const esc = (v: string | null) => v == null ? '' : `"${v.replace(/"/g, '""')}"`
  const lines = ['email,name,handle,source,trigger_word,captured_at']
  for (const r of rows) {
    lines.push([esc(r.email), esc(r.name), esc(r.handle), esc(r.source), esc(r.trigger_word), esc(String(r.created_at))].join(','))
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="audience-${projectId}.csv"`)
  res.send(lines.join('\n'))
})

// Manual add — writer.
audienceRouter.post('/projects/:projectId/contacts', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const email = cleanStr(req.body?.email, 320)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) { res.status(400).json({ error: 'valid_email_required' }); return }
  const name = cleanStr(req.body?.name, 120)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO audience_contacts (project_id, email, name, source)
     VALUES ($1, $2, $3, 'manual')
     ON CONFLICT (project_id, email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, audience_contacts.name),
       unsubscribed_at = NULL
     RETURNING id`,
    [projectId, email, name],
  )
  void syncContactToResend({ projectId, contactId: rows[0].id, email, name })
  res.json({ ok: true })
})

// Re-push unsynced contacts to Resend — writer.
audienceRouter.post('/projects/:projectId/resync', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const pushed = await resyncProject(projectId)
  res.json({ ok: true, pushed })
})

// Rotate the capture token — admin only (invalidates the old URL in
// every ManyChat flow, so this is deliberate-action territory).
audienceRouter.post('/projects/:projectId/rotate-token', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (user.role !== 'admin') { res.status(403).json({ error: 'admin_only' }); return }
  const projectId = req.params.projectId
  const token = crypto.randomBytes(24).toString('base64url')
  const { rowCount } = await pool.query(
    `UPDATE projects SET audience_capture_token = $2 WHERE id = $1`,
    [projectId, token],
  )
  if ((rowCount ?? 0) === 0) { res.status(404).json({ error: 'not_found' }); return }
  logInfo('audience: capture token rotated', { projectId })
  res.json({ ok: true, token, url: captureUrl(token) })
})
