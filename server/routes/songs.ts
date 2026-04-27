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
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     LEFT JOIN song_members sm ON sm.song_id = s.id AND sm.user_id = $1
     WHERE s.id = $2
       AND (p.created_by = $1 OR pm.user_id IS NOT NULL OR sm.user_id IS NOT NULL)`,
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
            s.producer_id, s.mixer_id,
            pu.display_name AS producer_name, pu.name AS producer_full_name,
            mu.display_name AS mixer_name, mu.name AS mixer_full_name,
            p.name AS project_name, p.dropbox_folder AS project_root
     FROM songs s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN users pu ON pu.id = s.producer_id
     LEFT JOIN users mu ON mu.id = s.mixer_id
     WHERE s.id = $1`,
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
  const links = await pool.query(
    `SELECT id, label, url, created_at FROM links WHERE song_id = $1 ORDER BY created_at DESC`,
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
      producerId: song.producer_id,
      producerName: song.producer_name || song.producer_full_name || null,
      mixerId: song.mixer_id,
      mixerName: song.mixer_name || song.mixer_full_name || null,
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
      links: links.rows.map((l: { id: string; label: string; url: string; created_at: string }) => ({
        id: l.id,
        label: l.label,
        url: l.url,
        createdAt: l.created_at,
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
  const { stage, title, subtitle, dropboxFolder, producerId, mixerId } = req.body ?? {}
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
  if (producerId === null || (typeof producerId === 'string' && producerId.length > 0)) {
    updates.push(`producer_id = $${i++}`)
    values.push(producerId || null)
  }
  if (mixerId === null || (typeof mixerId === 'string' && mixerId.length > 0)) {
    updates.push(`mixer_id = $${i++}`)
    values.push(mixerId || null)
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

// Links
songsRouter.get('/:id/links', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!(await userCanAccessSong(user.id, user.role, songId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { rows } = await pool.query(
    `SELECT id, label, url, created_at FROM links WHERE song_id = $1 ORDER BY created_at DESC`,
    [songId],
  )
  res.json({ links: rows })
})

songsRouter.post('/:id/links', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!(await userCanAccessSong(user.id, user.role, songId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { label, url } = req.body ?? {}
  if (typeof label !== 'string' || label.trim().length === 0) {
    res.status(400).json({ error: 'label_required' })
    return
  }
  if (typeof url !== 'string' || url.trim().length === 0) {
    res.status(400).json({ error: 'url_required' })
    return
  }
  const { rows } = await pool.query(
    `INSERT INTO links (song_id, label, url, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, url, created_at`,
    [songId, label.trim().slice(0, 120), url.trim().slice(0, 2000), user.id],
  )
  res.json({ link: rows[0] })
})

songsRouter.patch('/links/:linkId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const linkId = req.params.linkId
  const { rows } = await pool.query(`SELECT song_id FROM links WHERE id = $1`, [linkId])
  if (rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (!(await userCanAccessSong(user.id, user.role, rows[0].song_id))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { label, url } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof label === 'string' && label.trim().length > 0) {
    updates.push(`label = $${i++}`)
    values.push(label.trim().slice(0, 120))
  }
  if (typeof url === 'string' && url.trim().length > 0) {
    updates.push(`url = $${i++}`)
    values.push(url.trim().slice(0, 2000))
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'no_fields' })
    return
  }
  values.push(linkId)
  await pool.query(`UPDATE links SET ${updates.join(', ')} WHERE id = $${i}`, values)
  res.json({ ok: true })
})

songsRouter.delete('/links/:linkId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const linkId = req.params.linkId
  const { rows } = await pool.query(`SELECT song_id FROM links WHERE id = $1`, [linkId])
  if (rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (!(await userCanAccessSong(user.id, user.role, rows[0].song_id))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  await pool.query(`DELETE FROM links WHERE id = $1`, [linkId])
  res.json({ ok: true })
})
