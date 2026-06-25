// Episode cuts API. The producer uploads a cut (Dropbox link or
// external URL), labels it, sets a status. The team and the client
// leave notes — optionally timestamped to a moment in the cut.
// Permissions:
//   GET     : any project member
//   POST    : any project member (writer+)
//   PATCH   : any project member (so client can flip status)
//   DELETE  : admin or the original uploader
import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { markProjectDirty } from '../script_publisher'
import { logInfo } from './../diag'

export const episodeCutsRouter = Router()
episodeCutsRouter.use(requireUser)

async function getSongProject(songId: string): Promise<string | null> {
  const { rows } = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM songs WHERE id = $1`, [songId],
  )
  return rows[0]?.project_id ?? null
}

async function userCanAccessProject(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

type CutRow = {
  id: string; song_id: string; label: string; description: string | null;
  dropbox_path: string | null; url: string | null; duration_ms: number | null;
  status: string; uploaded_by: string | null; uploaded_at: string; position: number;
  uploaded_by_name: string | null;
  note_count: string; unresolved_count: string;
}

function serializeCut(r: CutRow) {
  return {
    id: r.id,
    songId: r.song_id,
    label: r.label,
    description: r.description,
    dropboxPath: r.dropbox_path,
    url: r.url,
    durationMs: r.duration_ms,
    status: r.status as 'in_review' | 'needs_changes' | 'approved' | 'superseded',
    uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name,
    uploadedAt: r.uploaded_at,
    position: r.position,
    noteCount: Number(r.note_count),
    unresolvedCount: Number(r.unresolved_count),
  }
}

// List all cuts for an episode, newest first, with note counts.
episodeCutsRouter.get('/songs/:songId/cuts', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.songId
  const projectId = await getSongProject(songId)
  if (!projectId) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<CutRow>(
    `SELECT c.*,
       u.display_name AS uploaded_by_name,
       (SELECT COUNT(*)::text FROM cut_notes WHERE cut_id = c.id) AS note_count,
       (SELECT COUNT(*)::text FROM cut_notes WHERE cut_id = c.id AND resolved = false) AS unresolved_count
     FROM episode_cuts c
     LEFT JOIN users u ON u.id = c.uploaded_by
     WHERE c.song_id = $1
     ORDER BY c.uploaded_at DESC`,
    [songId],
  )
  res.json({ cuts: rows.map(serializeCut) })
})

// Create a new cut. Producer-only.
episodeCutsRouter.post('/songs/:songId/cuts', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.songId
  const projectId = await getSongProject(songId)
  if (!projectId) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, projectId, res)) return
  const label = String(req.body?.label ?? '').trim().slice(0, 120)
  const description = typeof req.body?.description === 'string' ? req.body.description.slice(0, 2000) : null
  const dropboxPath = typeof req.body?.dropboxPath === 'string' ? req.body.dropboxPath.slice(0, 500) : null
  const url = typeof req.body?.url === 'string' ? req.body.url.slice(0, 500) : null
  const durationMs = Number.isFinite(Number(req.body?.durationMs)) ? Number(req.body.durationMs) : null
  if (!label) { res.status(400).json({ error: 'label_required' }); return }
  if (!dropboxPath && !url) { res.status(400).json({ error: 'source_required', message: 'Provide a Dropbox path or a URL.' }); return }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO episode_cuts (song_id, label, description, dropbox_path, url, duration_ms, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [songId, label, description, dropboxPath, url, durationMs, user.id],
  )
  logInfo('episode cut created', { songId, cutId: rows[0].id, label, by: user.id })
  markProjectDirty(projectId)
  res.json({ ok: true, id: rows[0].id })
})

// Update a cut (label / description / status / source). Any project
// member can flip status — clients need to be able to approve.
episodeCutsRouter.patch('/cuts/:cutId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const cutId = req.params.cutId
  const lookup = await pool.query<{ song_id: string; project_id: string }>(
    `SELECT c.song_id, s.project_id FROM episode_cuts c
     JOIN songs s ON s.id = c.song_id WHERE c.id = $1`, [cutId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, lookup.rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const map: Array<[string, string, (v: unknown) => unknown]> = [
    ['label', 'label', (v) => (typeof v === 'string' ? v.slice(0, 120) : null)],
    ['description', 'description', (v) => (typeof v === 'string' ? v.slice(0, 2000) : null)],
    ['dropboxPath', 'dropbox_path', (v) => (typeof v === 'string' ? v.slice(0, 500) : null)],
    ['url', 'url', (v) => (typeof v === 'string' ? v.slice(0, 500) : null)],
    ['durationMs', 'duration_ms', (v) => (Number.isFinite(Number(v)) ? Number(v) : null)],
    ['status', 'status', (v) => {
      const s = String(v)
      return ['in_review', 'needs_changes', 'approved', 'superseded'].includes(s) ? s : null
    }],
  ]
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  for (const [reqKey, col, transform] of map) {
    if (reqKey in (req.body ?? {})) {
      updates.push(`${col} = $${i++}`)
      values.push(transform(req.body[reqKey]))
    }
  }
  if (updates.length === 0) { res.status(400).json({ error: 'no_fields' }); return }
  values.push(cutId)
  await pool.query(`UPDATE episode_cuts SET ${updates.join(', ')} WHERE id = $${i}`, values)
  markProjectDirty(lookup.rows[0].project_id)
  res.json({ ok: true })
})

// Delete a cut. Admin or the original uploader only — clients
// shouldn't be able to remove a producer's upload.
episodeCutsRouter.delete('/cuts/:cutId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const cutId = req.params.cutId
  const { rows } = await pool.query<{ uploaded_by: string | null; project_id: string }>(
    `SELECT c.uploaded_by, s.project_id FROM episode_cuts c
     JOIN songs s ON s.id = c.song_id WHERE c.id = $1`, [cutId],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (user.role !== 'admin' && rows[0].uploaded_by !== user.id) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  await pool.query(`DELETE FROM episode_cuts WHERE id = $1`, [cutId])
  markProjectDirty(rows[0].project_id)
  res.json({ ok: true })
})

// Notes on a cut — listed in upload order so the producer can walk
// through them sequentially.
episodeCutsRouter.get('/cuts/:cutId/notes', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const cutId = req.params.cutId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT s.project_id FROM episode_cuts c
     JOIN songs s ON s.id = c.song_id WHERE c.id = $1`, [cutId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, lookup.rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query(
    `SELECT n.id, n.cut_id, n.author_user_id, n.content, n.timestamp_ms,
            n.resolved, n.resolved_at, n.resolved_by, n.created_at,
            u.display_name AS author_name
     FROM cut_notes n
     LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.cut_id = $1
     ORDER BY n.timestamp_ms NULLS LAST, n.created_at ASC`,
    [cutId],
  )
  res.json({
    notes: rows.map((r) => ({
      id: r.id,
      cutId: r.cut_id,
      authorUserId: r.author_user_id,
      authorName: r.author_name,
      content: r.content,
      timestampMs: r.timestamp_ms,
      resolved: r.resolved,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      createdAt: r.created_at,
    })),
  })
})

// Add a note to a cut. Any project member can leave one — clients
// included.
episodeCutsRouter.post('/cuts/:cutId/notes', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const cutId = req.params.cutId
  const lookup = await pool.query<{ project_id: string }>(
    `SELECT s.project_id FROM episode_cuts c
     JOIN songs s ON s.id = c.song_id WHERE c.id = $1`, [cutId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, lookup.rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const content = String(req.body?.content ?? '').trim().slice(0, 3000)
  const timestampMs = Number.isFinite(Number(req.body?.timestampMs)) ? Number(req.body.timestampMs) : null
  if (!content) { res.status(400).json({ error: 'content_required' }); return }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO cut_notes (cut_id, author_user_id, content, timestamp_ms)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [cutId, user.id, content, timestampMs],
  )
  markProjectDirty(lookup.rows[0].project_id)
  res.json({ ok: true, id: rows[0].id })
})

// Toggle resolved on a note. Any member can resolve their own; admins
// can resolve any.
episodeCutsRouter.patch('/notes/:noteId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const noteId = req.params.noteId
  const lookup = await pool.query<{ project_id: string; author_user_id: string | null }>(
    `SELECT s.project_id, n.author_user_id FROM cut_notes n
     JOIN episode_cuts c ON c.id = n.cut_id
     JOIN songs s ON s.id = c.song_id WHERE n.id = $1`, [noteId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, lookup.rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  if ('resolved' in (req.body ?? {})) {
    const resolved = Boolean(req.body.resolved)
    await pool.query(
      `UPDATE cut_notes
         SET resolved = $1,
             resolved_at = CASE WHEN $1 THEN now() ELSE NULL END,
             resolved_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END
       WHERE id = $3`,
      [resolved, user.id, noteId],
    )
  }
  if (typeof req.body?.content === 'string') {
    if (user.role !== 'admin' && lookup.rows[0].author_user_id !== user.id) {
      res.status(403).json({ error: 'forbidden_edit' }); return
    }
    await pool.query(
      `UPDATE cut_notes SET content = $1 WHERE id = $2`,
      [req.body.content.slice(0, 3000), noteId],
    )
  }
  markProjectDirty(lookup.rows[0].project_id)
  res.json({ ok: true })
})

episodeCutsRouter.delete('/notes/:noteId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const noteId = req.params.noteId
  const lookup = await pool.query<{ author_user_id: string | null; project_id: string }>(
    `SELECT n.author_user_id, s.project_id FROM cut_notes n
     JOIN episode_cuts c ON c.id = n.cut_id
     JOIN songs s ON s.id = c.song_id WHERE n.id = $1`, [noteId],
  )
  if (lookup.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (user.role !== 'admin' && lookup.rows[0].author_user_id !== user.id) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  await pool.query(`DELETE FROM cut_notes WHERE id = $1`, [noteId])
  markProjectDirty(lookup.rows[0].project_id)
  res.json({ ok: true })
})
