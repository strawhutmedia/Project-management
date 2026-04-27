import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'

export const notificationsRouter = Router()
notificationsRouter.use(requireUser)

notificationsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query(
    `SELECT id, kind, title, body, link, song_id, task_id, read_at, created_at
     FROM notifications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  )
  const unread = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [user.id],
  )
  res.json({
    notifications: rows.map((r: { id: string; kind: string; title: string; body: string; link: string | null; song_id: string | null; task_id: string | null; read_at: string | null; created_at: string }) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      link: r.link,
      songId: r.song_id,
      taskId: r.task_id,
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
    unreadCount: unread.rows[0].n as number,
  })
})

notificationsRouter.post('/:id/read', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [req.params.id, user.id],
  )
  res.json({ ok: true })
})

notificationsRouter.post('/read-all', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [user.id],
  )
  res.json({ ok: true })
})
