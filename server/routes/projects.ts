import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'

export const projectsRouter = Router()

projectsRouter.use(requireUser)

projectsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projects = await pool.query(
    `SELECT p.id, p.name, p.subtitle, p.kind, p.created_at
     FROM projects p
     WHERE p.created_by = $1
        OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)
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

projectsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  const projRes = await pool.query(
    `SELECT id, name, subtitle, kind FROM projects WHERE id = $1`,
    [projectId],
  )
  if (projRes.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const project = projRes.rows[0]
  if (user.role !== 'admin') {
    const access = await pool.query(
      `SELECT 1 FROM projects p
       WHERE p.id = $1 AND (p.created_by = $2 OR EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2))`,
      [projectId, user.id],
    )
    if (access.rows.length === 0) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }
  const songs = await pool.query(
    `SELECT id, title, subtitle, stage, position FROM songs WHERE project_id = $1 ORDER BY position ASC`,
    [projectId],
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
