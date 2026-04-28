import { Router } from 'express'
import { pool } from '../db'
import { requireAdmin, type SessionUser } from '../auth'
import { sendInviteEmail } from '../email'
import { logError, logInfo } from '../diag'

export const adminRouter = Router()
adminRouter.use(requireAdmin)

// List all users with project + song access.
adminRouter.get('/users', async (_req, res) => {
  const userRes = await pool.query(
    `SELECT id, email, name, display_name, role, timezone, created_at FROM users ORDER BY created_at ASC`,
  )
  const projRes = await pool.query(
    `SELECT m.user_id, p.id, p.name FROM project_members m JOIN projects p ON p.id = m.project_id`,
  )
  const songRes = await pool.query(
    `SELECT sm.user_id, s.id, s.title, s.subtitle, s.project_id, p.name AS project_name
     FROM song_members sm
     JOIN songs s ON s.id = sm.song_id
     JOIN projects p ON p.id = s.project_id`,
  )
  const projectsByUser: Record<string, Array<{ id: string; name: string }>> = {}
  for (const r of projRes.rows) {
    if (!projectsByUser[r.user_id]) projectsByUser[r.user_id] = []
    projectsByUser[r.user_id].push({ id: r.id, name: r.name })
  }
  const songsByUser: Record<string, Array<{ id: string; title: string; subtitle: string | null; projectId: string; projectName: string }>> = {}
  for (const r of songRes.rows) {
    if (!songsByUser[r.user_id]) songsByUser[r.user_id] = []
    songsByUser[r.user_id].push({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      projectId: r.project_id,
      projectName: r.project_name,
    })
  }
  res.json({
    users: userRes.rows.map((u: { id: string; email: string; name: string; display_name: string | null; role: string; timezone: string; created_at: string }) => ({
      ...u,
      projects: projectsByUser[u.id] ?? [],
      songs: songsByUser[u.id] ?? [],
    })),
  })
})

// List all projects (for the invite form), each with songs for per-channel access selection.
adminRouter.get('/projects', async (_req, res) => {
  const projRes = await pool.query(`SELECT id, name FROM projects ORDER BY name ASC`)
  const songsRes = await pool.query(
    `SELECT id, project_id, title, subtitle, position
     FROM songs ORDER BY project_id, position ASC`,
  )
  const songsByProject: Record<string, Array<{ id: string; title: string; subtitle: string | null }>> = {}
  for (const row of songsRes.rows) {
    if (!songsByProject[row.project_id]) songsByProject[row.project_id] = []
    songsByProject[row.project_id].push({ id: row.id, title: row.title, subtitle: row.subtitle })
  }
  res.json({
    projects: projRes.rows.map((p: { id: string; name: string }) => ({
      id: p.id,
      name: p.name,
      songs: songsByProject[p.id] ?? [],
    })),
  })
})

// Create user (and grant project access).
// Email is OPTIONAL — leave blank to create a placeholder user (no invite
// email sent). Admin can add the email later via PATCH /users/:id, which
// triggers the invite email at that point.
adminRouter.post('/users', async (req, res) => {
  const inviter = (req as typeof req & { user: SessionUser }).user
  const rawEmail = String(req.body?.email || '').trim().toLowerCase()
  const name = String(req.body?.name || '').trim()
  const displayName = String(req.body?.displayName || '').trim() || name
  const role = req.body?.role === 'admin' ? 'admin' : 'user'
  const timezone = String(req.body?.timezone || 'America/Los_Angeles').trim()
  const projectIds: string[] = Array.isArray(req.body?.projectIds) ? req.body.projectIds : []
  const songIds: string[] = Array.isArray(req.body?.songIds) ? req.body.songIds : []

  // Email is optional. If provided, validate.
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    res.status(400).json({ error: 'invalid_email' })
    return
  }
  if (!name) {
    res.status(400).json({ error: 'name_required' })
    return
  }

  if (rawEmail) {
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [rawEmail])
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'user_exists' })
      return
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userRes = await client.query(
      `INSERT INTO users (email, name, display_name, role, timezone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, display_name, role, timezone`,
      [rawEmail || null, name.slice(0, 80), displayName.slice(0, 40), role, timezone.slice(0, 60)],
    )
    const newUser = userRes.rows[0]
    for (const projectId of projectIds) {
      await client.query(
        `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [projectId, newUser.id],
      )
    }
    for (const songId of songIds) {
      await client.query(
        `INSERT INTO song_members (song_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [songId, newUser.id],
      )
    }
    await client.query('COMMIT')

    // Only send invite email if we have an email. Placeholders stay silent.
    if (rawEmail) {
      void sendInviteEmail(rawEmail, name, inviter.display_name || inviter.name).catch((err) => {
        logError('invite email failed', { email: rawEmail, error: err instanceof Error ? err.message : String(err) })
      })
    }

    logInfo('user invited', { email: rawEmail || '(placeholder)', role, projectCount: projectIds.length })
    res.json({ user: newUser })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    client.release()
  }
})

adminRouter.patch('/users/:id', async (req, res) => {
  const inviter = (req as typeof req & { user: SessionUser }).user
  const userId = req.params.id
  const { displayName, name, role, timezone, email } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  // If email is being set, validate uniqueness and prepare to send invite if user previously had no email.
  let willSendInvite = false
  let inviteToEmail: string | null = null
  let inviteToName: string | null = null
  if (typeof email === 'string') {
    const trimmed = email.trim().toLowerCase()
    if (trimmed.length === 0) {
      res.status(400).json({ error: 'email_cannot_be_empty' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      res.status(400).json({ error: 'invalid_email' })
      return
    }
    const conflict = await pool.query(`SELECT id FROM users WHERE email = $1 AND id <> $2`, [trimmed, userId])
    if (conflict.rows.length > 0) {
      res.status(409).json({ error: 'email_taken' })
      return
    }
    const cur = await pool.query(`SELECT email, name FROM users WHERE id = $1`, [userId])
    if (cur.rows.length === 0) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    if (!cur.rows[0].email) {
      willSendInvite = true
      inviteToEmail = trimmed
      inviteToName = cur.rows[0].name
    }
    updates.push(`email = $${i++}`)
    values.push(trimmed)
  }

  if (typeof name === 'string' && name.trim().length > 0) {
    updates.push(`name = $${i++}`)
    values.push(name.trim().slice(0, 80))
  }
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    updates.push(`display_name = $${i++}`)
    values.push(displayName.trim().slice(0, 40))
  }
  if (role === 'admin' || role === 'user') {
    updates.push(`role = $${i++}`)
    values.push(role)
  }
  if (typeof timezone === 'string' && timezone.trim().length > 0) {
    updates.push(`timezone = $${i++}`)
    values.push(timezone.trim().slice(0, 60))
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'no_fields' })
    return
  }
  values.push(userId)
  await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, values)

  if (willSendInvite && inviteToEmail) {
    void sendInviteEmail(inviteToEmail, inviteToName || 'there', inviter.display_name || inviter.name).catch((err) => {
      logError('invite email failed', { email: inviteToEmail, error: err instanceof Error ? err.message : String(err) })
    })
    logInfo('placeholder activated + invite email sent', { email: inviteToEmail })
  }

  res.json({ ok: true })
})

adminRouter.delete('/users/:id', async (req, res) => {
  const admin = (req as typeof req & { user: SessionUser }).user
  const userId = req.params.id
  if (userId === admin.id) {
    res.status(400).json({ error: 'cannot_delete_self' })
    return
  }
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId])
  res.json({ ok: true })
})

adminRouter.post('/users/:id/projects/:projectId', async (req, res) => {
  const userId = req.params.id
  const projectId = req.params.projectId
  await pool.query(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [projectId, userId],
  )
  res.json({ ok: true })
})

adminRouter.delete('/users/:id/projects/:projectId', async (req, res) => {
  const userId = req.params.id
  const projectId = req.params.projectId
  await pool.query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  res.json({ ok: true })
})

adminRouter.post('/users/:id/songs/:songId', async (req, res) => {
  const userId = req.params.id
  const songId = req.params.songId
  await pool.query(
    `INSERT INTO song_members (song_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [songId, userId],
  )
  res.json({ ok: true })
})

adminRouter.delete('/users/:id/songs/:songId', async (req, res) => {
  const userId = req.params.id
  const songId = req.params.songId
  await pool.query(
    `DELETE FROM song_members WHERE song_id = $1 AND user_id = $2`,
    [songId, userId],
  )
  res.json({ ok: true })
})
