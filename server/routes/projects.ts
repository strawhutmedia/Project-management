import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { logInfo, logError } from '../diag'

export const projectsRouter = Router()

projectsRouter.use(requireUser)

projectsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projects = await pool.query(
    `SELECT DISTINCT p.id, p.name, p.subtitle, p.kind, p.created_at
     FROM projects p
     LEFT JOIN songs s ON s.project_id = p.id
     LEFT JOIN song_members sm ON sm.song_id = s.id AND sm.user_id = $1
     WHERE p.created_by = $1
        OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)
        OR sm.user_id IS NOT NULL
        OR $2 = 'admin'
     ORDER BY p.created_at DESC`,
    [user.id, user.role],
  )
  const ids = projects.rows.map((p: { id: string }) => p.id)
  const songsByProject: Record<string, unknown[]> = Object.fromEntries(
    ids.map((id: string) => [id, []]),
  )
  if (ids.length > 0) {
    const songs = await pool.query(
      `SELECT id, project_id, title, subtitle, stage, position
       FROM songs WHERE project_id = ANY($1)
       ORDER BY position ASC`,
      [ids],
    )
    for (const row of songs.rows) {
      songsByProject[row.project_id].push({
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        stage: row.stage,
        position: row.position,
      })
    }
  }
  res.json({
    projects: projects.rows.map((p: { id: string; name: string; subtitle: string | null; kind: string }) => ({
      id: p.id,
      name: p.name,
      subtitle: p.subtitle,
      kind: p.kind,
      songs: songsByProject[p.id],
    })),
  })
})

// Project members for autocomplete (@mentions, assignee pickers).
// Returns: project members + admins + the project creator. All distinct.
projectsRouter.get('/:id/members', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id

  try {
    // Verify access (full or partial via song_members)
    if (user.role !== 'admin') {
      const access = await pool.query(
        `SELECT 1 FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         LEFT JOIN songs s ON s.project_id = p.id
         LEFT JOIN song_members sm ON sm.song_id = s.id AND sm.user_id = $1
         WHERE p.id = $2 AND (p.created_by = $1 OR pm.user_id IS NOT NULL OR sm.user_id IS NOT NULL)
         LIMIT 1`,
        [user.id, projectId],
      )
      if (access.rows.length === 0) {
        res.status(403).json({ error: 'forbidden' })
        return
      }
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.display_name, u.role
       FROM users u
       WHERE u.role = 'admin'
          OR u.id IN (SELECT user_id FROM project_members WHERE project_id = $1)
          OR u.id IN (SELECT created_by FROM projects WHERE id = $1)
          OR u.id IN (
            SELECT sm.user_id FROM song_members sm
            JOIN songs s ON s.id = sm.song_id
            WHERE s.project_id = $1
          )
       ORDER BY COALESCE(u.display_name, u.name) ASC`,
      [projectId],
    )
    logInfo('members fetched', { projectId, count: rows.length, requesterRole: user.role })
    res.json({ members: rows })
  } catch (err) {
    logError('members fetch error', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' })
  }
})

projectsRouter.patch('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  // Only admin or project members can edit
  const access = await pool.query(
    `SELECT 1 FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, projectId, user.role],
  )
  if (access.rows.length === 0) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { name, subtitle, dropboxFolder } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof name === 'string' && name.trim().length > 0) {
    updates.push(`name = $${i++}`)
    values.push(name.trim().slice(0, 200))
  }
  if (typeof subtitle === 'string') {
    updates.push(`subtitle = $${i++}`)
    values.push(subtitle.trim().slice(0, 200) || null)
  }
  if (typeof dropboxFolder === 'string') {
    updates.push(`dropbox_folder = $${i++}`)
    values.push(dropboxFolder.trim() || null)
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'no_fields' })
    return
  }
  values.push(projectId)
  await pool.query(`UPDATE projects SET ${updates.join(', ')} WHERE id = $${i}`, values)
  res.json({ ok: true })
})

projectsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  const projRes = await pool.query(
    `SELECT id, name, subtitle, kind, dropbox_folder FROM projects WHERE id = $1`,
    [projectId],
  )
  if (projRes.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const project = projRes.rows[0]
  // Determine access level.
  // 'full' = admin / creator / project member -> sees all songs
  // 'partial' = song-level access only -> sees only granted songs
  // 'none' = no access -> 403
  let accessLevel: 'full' | 'partial' | 'none' = 'none'
  if (user.role === 'admin') {
    accessLevel = 'full'
  } else {
    const access = await pool.query(
      `SELECT 1 FROM projects p
       WHERE p.id = $1
         AND (p.created_by = $2
              OR EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2))`,
      [projectId, user.id],
    )
    if (access.rows.length > 0) {
      accessLevel = 'full'
    } else {
      const songAccess = await pool.query(
        `SELECT 1 FROM song_members sm JOIN songs s ON s.id = sm.song_id
         WHERE s.project_id = $1 AND sm.user_id = $2 LIMIT 1`,
        [projectId, user.id],
      )
      if (songAccess.rows.length > 0) accessLevel = 'partial'
    }
  }
  if (accessLevel === 'none') {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  const songs =
    accessLevel === 'full'
      ? await pool.query(
          `SELECT id, title, subtitle, stage, position FROM songs WHERE project_id = $1 ORDER BY position ASC`,
          [projectId],
        )
      : await pool.query(
          `SELECT s.id, s.title, s.subtitle, s.stage, s.position
           FROM songs s JOIN song_members sm ON sm.song_id = s.id
           WHERE s.project_id = $1 AND sm.user_id = $2
           ORDER BY s.position ASC`,
          [projectId, user.id],
        )
  const songIds = songs.rows.map((s: { id: string }) => s.id)
  const tasksBySong: Record<string, unknown[]> = Object.fromEntries(songIds.map((id: string) => [id, []]))
  if (songIds.length > 0) {
    const tasks = await pool.query(
      `SELECT id, song_id, title, stage, done, due_at FROM tasks WHERE song_id = ANY($1) ORDER BY created_at ASC`,
      [songIds],
    )
    for (const t of tasks.rows) {
      tasksBySong[t.song_id].push({
        id: t.id,
        title: t.title,
        stage: t.stage,
        done: t.done,
        dueAt: t.due_at,
      })
    }
  }
  res.json({
    project: {
      id: project.id,
      name: project.name,
      subtitle: project.subtitle,
      kind: project.kind,
      dropboxFolder: project.dropbox_folder,
      songs: songs.rows.map((s: { id: string; title: string; subtitle: string | null; stage: string }) => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle,
        stage: s.stage,
        tasks: tasksBySong[s.id],
        comments: [],
        links: [],
      })),
    },
  })
})
