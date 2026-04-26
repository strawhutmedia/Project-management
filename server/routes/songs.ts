import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'

export const songsRouter = Router()
songsRouter.use(requireUser)

const STAGES = new Set([
  'writing',
  'tracking',
  'overdubs',
  'producing',
  'stems',
  'mixing',
  'mastering',
  'done',
])

async function userCanAccessSong(userId: string, role: string, songId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM songs s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE s.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [userId, songId],
  )
  return rows.length > 0
}

songsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!(await userCanAccessSong(user.id, user.role, songId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const songRes = await pool.query(
    `SELECT s.id, s.project_id, s.title, s.subtitle, s.stage, s.dropbox_folder,
            p.name AS project_name, p.dropbox_folder AS project_root
     FROM songs s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
    [songId],
  )
  if (songRes.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const song = songRes.rows[0]
  const tasks = await pool.query(
    `SELECT t.id, t.title, t.stage, t.done, t.due_at, t.assignee_id,
            u.display_name AS assignee_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.song_id = $1 ORDER BY t.created_at ASC`,
    [songId],
  )
  const comments = await pool.query(
    `SELECT c.id, c.body, c.created_at, c.author_id,
            COALESCE(u.display_name, u.name) AS author_name
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.song_id = $1 ORDER BY c.created_at ASC`,
    [songId],
  )
  res.json({
    song: {
      id: song.id,
      projectId: song.project_id,
      projectName: song.project_name,
      projectRoot: song.project_root,
      title: song.title,
      subtitle: song.subtitle,
      stage: song.stage,
      dropboxFolder: song.dropbox_folder,
      tasks: tasks.rows.map((t: { id: string; title: string; stage: string; done: boolean; due_at: string | null; assignee_id: string | null; assignee_name: string | null }) => ({
        id: t.id,
        title: t.title,
        stage: t.stage,
        done: t.done,
        dueAt: t.due_at,
        assigneeId: t.assignee_id,
        assigneeName: t.assignee_name,
      })),
      comments: comments.rows.map((c: { id: string; body: string; created_at: string; author_id: string; author_name: string }) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        authorId: c.author_id,
        authorName: c.author_name,
      })),
    },
  })
})

songsRouter.patch('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!(await userCanAccessSong(user.id, user.role, songId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { stage, title, subtitle, dropboxFolder } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof stage === 'string' && STAGES.has(stage)) {
    updates.push(`stage = $${i++}`)
    values.push(stage)
  }
  if (typeof title === 'string' && title.trim().length > 0) {
    updates.push(`title = $${i++}`)
    values.push(title.trim().slice(0, 200))
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
  values.push(songId)
  await pool.query(`UPDATE songs SET ${updates.join(', ')} WHERE id = $${i}`, values)
  res.json({ ok: true })
})

// Tasks
songsRouter.post('/:id/tasks', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!(await userCanAccessSong(user.id, user.role, songId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { title, stage, dueAt, assigneeId } = req.body ?? {}
  if (typeof title !== 'string' || title.trim().length === 0) {
    res.status(400).json({ error: 'title_required' })
    return
  }
  const stageVal = STAGES.has(stage) ? stage : 'writing'
  const { rows } = await pool.query(
    `INSERT INTO tasks (song_id, title, stage, due_at, assignee_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, stage, done, due_at, assignee_id`,
    [songId, title.trim().slice(0, 200), stageVal, dueAt || null, assigneeId || null, user.id],
  )
  res.json({ task: rows[0] })
})

songsRouter.patch('/tasks/:taskId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const taskId = req.params.taskId
  // verify access
  const accessRes = await pool.query(
    `SELECT t.song_id FROM tasks t WHERE t.id = $1`,
    [taskId],
  )
  if (accessRes.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (!(await userCanAccessSong(user.id, user.role, accessRes.rows[0].song_id))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { title, done, dueAt, assigneeId, stage } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof title === 'string' && title.trim().length > 0) {
    updates.push(`title = $${i++}`)
    values.push(title.trim().slice(0, 200))
  }
  if (typeof done === 'boolean') {
    updates.push(`done = $${i++}`)
    values.push(done)
  }
  if (typeof dueAt === 'string' || dueAt === null) {
    updates.push(`due_at = $${i++}`)
    values.push(dueAt || null)
  }
  if (typeof assigneeId === 'string' || assigneeId === null) {
    updates.push(`assignee_id = $${i++}`)
    values.push(assigneeId || null)
  }
  if (typeof stage === 'string' && STAGES.has(stage)) {
    updates.push(`stage = $${i++}`)
    values.push(stage)
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'no_fields' })
    return
  }
  values.push(taskId)
  await pool.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${i}`, values)
  res.json({ ok: true })
})

songsRouter.delete('/tasks/:taskId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const taskId = req.params.taskId
  const accessRes = await pool.query(`SELECT song_id FROM tasks WHERE id = $1`, [taskId])
  if (accessRes.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (!(await userCanAccessSong(user.id, user.role, accessRes.rows[0].song_id))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [taskId])
  res.json({ ok: true })
})

// Comments
songsRouter.post('/:id/comments', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!(await userCanAccessSong(user.id, user.role, songId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { body } = req.body ?? {}
  if (typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'body_required' })
    return
  }
  const { rows } = await pool.query(
    `INSERT INTO comments (song_id, author_id, body) VALUES ($1, $2, $3)
     RETURNING id, body, created_at, author_id`,
    [songId, user.id, body.trim().slice(0, 4000)],
  )
  const c = rows[0]
  res.json({
    comment: {
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      authorId: c.author_id,
      authorName: user.display_name || user.name,
    },
  })
})

songsRouter.delete('/comments/:commentId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const commentId = req.params.commentId
  const { rows } = await pool.query(
    `SELECT author_id, song_id FROM comments WHERE id = $1`,
    [commentId],
  )
  if (rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const c = rows[0]
  if (c.author_id !== user.id && user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  await pool.query(`DELETE FROM comments WHERE id = $1`, [commentId])
  res.json({ ok: true })
})
