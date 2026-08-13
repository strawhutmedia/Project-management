// Teleprompter sessions — a SHARED library for the podcast team.
//
//   GET    /api/teleprompter        → { sessions: [...] }   (newest edit first)
//   POST   /api/teleprompter        → { session }           body: { name, html }
//   PUT    /api/teleprompter/:id     → { ok, updatedAt }     body: { name, html }
//   DELETE /api/teleprompter/:id     → { ok }
//
// Every session is visible to everyone with podcast access (admins, plus
// anyone who's a member or creator of a podcast-kind project). It's one
// shared pool — not per-user and not per-project — so whoever sits down at
// the prompter sees the same scripts.

import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'

export const teleprompterRouter = Router()
teleprompterRouter.use(requireUser)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NAME = 200
const MAX_HTML = 500_000 // ~500KB of script HTML is plenty; guards against abuse

async function hasPodcastAccess(user: SessionUser): Promise<boolean> {
  if (user.role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE p.kind = 'podcast' AND (p.created_by = $1 OR m.user_id IS NOT NULL)
      LIMIT 1`,
    [user.id],
  )
  return rows.length > 0
}

// Gate the whole router on podcast access.
teleprompterRouter.use(async (req, res, next) => {
  const user = (req as typeof req & { user: SessionUser }).user
  try {
    if (!(await hasPodcastAccess(user))) {
      res.status(403).json({ error: 'forbidden', detail: 'podcast access required' })
      return
    }
    next()
  } catch (err) {
    next(err)
  }
})

type Row = {
  id: string
  name: string | null
  html: string | null
  created_at: string
  updated_at: string
  created_by_name?: string | null
  updated_by_name?: string | null
}

function rowToSession(r: Row) {
  return {
    id: r.id,
    name: r.name ?? '',
    html: r.html ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdByName: r.created_by_name ?? null,
    updatedByName: r.updated_by_name ?? null,
  }
}

const SELECT_WITH_NAMES = `
  SELECT s.id, s.name, s.html, s.created_at, s.updated_at,
         COALESCE(cu.display_name, cu.name) AS created_by_name,
         COALESCE(uu.display_name, uu.name) AS updated_by_name
    FROM teleprompter_sessions s
    LEFT JOIN users cu ON cu.id = s.created_by
    LEFT JOIN users uu ON uu.id = s.updated_by`

function readBody(body: unknown): { name: string; html: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.slice(0, MAX_NAME) : ''
  const html = typeof b.html === 'string' ? b.html.slice(0, MAX_HTML) : ''
  return { name, html }
}

teleprompterRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query<Row>(`${SELECT_WITH_NAMES} ORDER BY s.updated_at DESC`)
    res.json({ sessions: rows.map(rowToSession) })
  } catch (err) {
    next(err)
  }
})

teleprompterRouter.post('/', async (req, res, next) => {
  try {
    const user = (req as typeof req & { user: SessionUser }).user
    const { name, html } = readBody(req.body)
    const { rows } = await pool.query<Row>(
      `WITH ins AS (
         INSERT INTO teleprompter_sessions (name, html, created_by, updated_by)
         VALUES ($1, $2, $3, $3)
         RETURNING *
       )
       SELECT ins.id, ins.name, ins.html, ins.created_at, ins.updated_at,
              COALESCE(cu.display_name, cu.name) AS created_by_name,
              COALESCE(uu.display_name, uu.name) AS updated_by_name
         FROM ins
         LEFT JOIN users cu ON cu.id = ins.created_by
         LEFT JOIN users uu ON uu.id = ins.updated_by`,
      [name, html, user.id],
    )
    res.json({ session: rowToSession(rows[0]) })
  } catch (err) {
    next(err)
  }
})

teleprompterRouter.put('/:id', async (req, res, next) => {
  try {
    const user = (req as typeof req & { user: SessionUser }).user
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'bad_id' })
      return
    }
    const { name, html } = readBody(req.body)
    const { rows } = await pool.query(
      `UPDATE teleprompter_sessions
          SET name = $1, html = $2, updated_by = $3, updated_at = now()
        WHERE id = $4
        RETURNING updated_at`,
      [name, html, user.id, id],
    )
    if (rows.length === 0) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.json({ ok: true, updatedAt: rows[0].updated_at })
  } catch (err) {
    next(err)
  }
})

teleprompterRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'bad_id' })
      return
    }
    await pool.query('DELETE FROM teleprompter_sessions WHERE id = $1', [id])
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})
