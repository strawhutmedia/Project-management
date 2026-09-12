import { Router } from 'express'
import { pool } from '../db'
import { requireUser, getSessionUser, isViewer, type SessionUser } from '../auth'
import { logError } from '../diag'

// QA Production Checklist — Slate's replacement for the "QA PRODUCTION
// SHEET" Google Sheet. Anyone with access to at least one podcast project
// can log recordings and run QA; approving stamps who approved and when.
// A recording's checklist is seeded from its show's expected-deliverables
// template (qa_checklist_items) so QA is a real per-asset checklist, not
// just a date column.
export const qaRouter = Router()

// ── Service read for the Premiere automation ────────────────────────────
// GET /api/qa/approved?since=<ISO> — approved recordings, newest first.
// Auth: a browser session works, and so does `X-QA-Token: $QA_SERVICE_TOKEN`
// (or `Authorization: Bearer …`) so a local Claude Code hook can poll for
// freshly approved QA without a session. Registered BEFORE requireUser.
qaRouter.get('/approved', async (req, res) => {
  const configured = (process.env.QA_SERVICE_TOKEN ?? '').trim()
  const presented = (
    req.header('x-qa-token') ??
    (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
  ).trim()
  const tokenOk = configured.length >= 16 && presented === configured
  if (!tokenOk) {
    const u = await getSessionUser(req)
    if (!u) { res.status(401).json({ error: 'unauthorized' }); return }
  }
  try {
    const since = typeof req.query.since === 'string' && req.query.since ? new Date(req.query.since) : null
    const params: unknown[] = []
    let where = `r.status = 'approved'`
    if (since && !isNaN(since.getTime())) {
      params.push(since.toISOString())
      where += ` AND r.qa_at >= $1`
    }
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.record_date, r.recording_type, r.resolution,
              r.dropbox_url, r.dropbox_path, r.notes, r.qa_at,
              p.id AS project_id, p.name AS project_name,
              qb.display_name AS qa_by_display, qb.name AS qa_by_name
         FROM qa_recordings r
         LEFT JOIN projects p ON p.id = r.project_id
         LEFT JOIN users qb ON qb.id = r.qa_by
        WHERE ${where}
        ORDER BY r.qa_at DESC NULLS LAST
        LIMIT 200`,
      params,
    )
    res.json({
      approved: rows.map((r) => ({
        id: r.id,
        title: r.title,
        recordDate: r.record_date,
        recordingType: r.recording_type,
        resolution: r.resolution,
        dropboxUrl: r.dropbox_url,
        dropboxPath: r.dropbox_path,
        notes: r.notes,
        approvedAt: r.qa_at,
        approvedBy: r.qa_by_display || r.qa_by_name || null,
        projectId: r.project_id,
        projectName: r.project_name,
      })),
    })
  } catch (err) {
    logError('qa approved feed failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Token-authed status channel for the on-PC Premiere bot. It POSTs what
// it's doing here; Ryan and Claude read it in Slate instead of relaying a
// terminal by screenshot. Same QA_SERVICE_TOKEN as /approved, registered
// BEFORE requireUser so the session-less bot can reach it.
function qaTokenOk(req: { header: (n: string) => string | undefined }): boolean {
  const configured = (process.env.QA_SERVICE_TOKEN ?? '').trim()
  const presented = (
    req.header('x-qa-token') ??
    (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
  ).trim()
  return configured.length >= 16 && presented === configured
}

qaRouter.post('/bot-log', async (req, res) => {
  if (!qaTokenOk(req)) {
    const u = await getSessionUser(req)
    if (!u) { res.status(401).json({ error: 'unauthorized' }); return }
  }
  try {
    const b = (req.body ?? {}) as { level?: string; message?: string; data?: unknown; source?: string }
    const level = ['info', 'ok', 'warn', 'error'].includes(String(b.level)) ? String(b.level) : 'info'
    await pool.query(
      `INSERT INTO qa_bot_log (level, source, message, data) VALUES ($1, $2, $3, $4)`,
      [
        level,
        String(b.source ?? 'premiere-bot').slice(0, 80),
        String(b.message ?? '').slice(0, 8000),
        b.data !== undefined ? JSON.stringify(b.data) : null,
      ],
    )
    res.json({ ok: true })
  } catch (err) {
    logError('qa bot-log post failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

qaRouter.get('/bot-log', async (req, res) => {
  if (!qaTokenOk(req)) {
    const u = await getSessionUser(req)
    if (!u) { res.status(401).json({ error: 'unauthorized' }); return }
  }
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const { rows } = await pool.query(
      `SELECT ts, level, source, message, data FROM qa_bot_log ORDER BY ts DESC LIMIT $1`,
      [limit],
    )
    res.json({ log: rows })
  } catch (err) {
    logError('qa bot-log get failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

qaRouter.use(requireUser)

// The QA board is open to anyone who can see at least one podcast project
// (admins see everything). It's a studio-wide log — same trust model as the
// shared sheet it replaces — so access to any podcast unlocks the whole board.
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

function userOf(req: unknown): SessionUser {
  return (req as { user: SessionUser }).user
}

async function assertQaAccess(req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, write: boolean): Promise<SessionUser | null> {
  const user = userOf(req)
  if (!(await hasPodcastAccess(user))) {
    res.status(403).json({ error: 'no_podcast_access' })
    return null
  }
  if (write && isViewer(user)) {
    res.status(403).json({ error: 'read_only' })
    return null
  }
  return user
}

// ── Context: shows + people for the pickers ─────────────────────────────
qaRouter.get('/context', async (req, res) => {
  const user = await assertQaAccess(req, res, false)
  if (!user) return
  try {
    const projects = await pool.query(
      user.role === 'admin'
        ? `SELECT id, name, cover_art_url, dropbox_folder FROM projects WHERE kind = 'podcast' ORDER BY name ASC`
        : `SELECT DISTINCT p.id, p.name, p.cover_art_url, p.dropbox_folder FROM projects p
           LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
           WHERE p.kind = 'podcast' AND (p.created_by = $1 OR m.user_id IS NOT NULL)
           ORDER BY p.name ASC`,
      user.role === 'admin' ? [] : [user.id],
    )
    // Every Slate account is a valid "shot by" / "QA by" pick — the crew
    // list IS the accounts list, per Ryan.
    const users = await pool.query(
      `SELECT id, name, display_name, role FROM users ORDER BY COALESCE(display_name, name) ASC`,
    )
    res.json({
      projects: projects.rows.map((p) => ({ id: p.id, name: p.name, coverArtUrl: p.cover_art_url ?? null, dropboxFolder: p.dropbox_folder ?? null })),
      users: users.rows.map((u) => ({ id: u.id, name: u.display_name || u.name, role: u.role })),
      canWrite: !isViewer(user),
    })
  } catch (err) {
    logError('qa context failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── Recordings list ─────────────────────────────────────────────────────
type CheckRow = {
  id: string; recording_id: string; label: string; spec: string
  position: number; checked: boolean; checked_by: string | null
  checked_at: string | null; checked_by_name: string | null
}

async function loadRecordings(where: string, params: unknown[]) {
  const { rows } = await pool.query(
    `SELECT r.*, p.name AS project_name, p.cover_art_url AS project_cover,
            qb.display_name AS qa_by_display, qb.name AS qa_by_name,
            cb.display_name AS created_by_display, cb.name AS created_by_name
       FROM qa_recordings r
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN users qb ON qb.id = r.qa_by
       LEFT JOIN users cb ON cb.id = r.created_by
      ${where}
      ORDER BY r.record_date DESC NULLS LAST, r.created_at DESC`,
    params,
  )
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const shooters = await pool.query(
    `SELECT s.recording_id, u.id, COALESCE(u.display_name, u.name) AS name
       FROM qa_recording_shooters s JOIN users u ON u.id = s.user_id
      WHERE s.recording_id = ANY($1::uuid[])
      ORDER BY name ASC`,
    [ids],
  )
  const checks = await pool.query<CheckRow>(
    `SELECT c.*, COALESCE(u.display_name, u.name) AS checked_by_name
       FROM qa_recording_checks c LEFT JOIN users u ON u.id = c.checked_by
      WHERE c.recording_id = ANY($1::uuid[])
      ORDER BY c.position ASC, c.label ASC`,
    [ids],
  )
  const shootersBy = new Map<string, Array<{ id: string; name: string }>>()
  for (const s of shooters.rows) {
    const list = shootersBy.get(s.recording_id) ?? []
    list.push({ id: s.id, name: s.name })
    shootersBy.set(s.recording_id, list)
  }
  const checksBy = new Map<string, CheckRow[]>()
  for (const c of checks.rows) {
    const list = checksBy.get(c.recording_id) ?? []
    list.push(c)
    checksBy.set(c.recording_id, list)
  }
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name ?? null,
    projectCoverArtUrl: r.project_cover ?? null,
    title: r.title,
    recordDate: r.record_date,
    uploadTime: r.upload_time,
    recordingType: r.recording_type,
    resolution: r.resolution,
    audioFolder: r.audio_folder,
    audioCard: r.audio_card,
    videoCard: r.video_card,
    dropboxUrl: r.dropbox_url,
    dropboxPath: r.dropbox_path,
    notes: r.notes,
    status: r.status,
    qaById: r.qa_by,
    qaByName: r.qa_by_display || r.qa_by_name || null,
    qaAt: r.qa_at,
    createdByName: r.created_by_display || r.created_by_name || null,
    createdAt: r.created_at,
    shooters: shootersBy.get(r.id) ?? [],
    checks: (checksBy.get(r.id) ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      spec: c.spec,
      checked: c.checked,
      checkedByName: c.checked_by_name,
      checkedAt: c.checked_at,
    })),
  }))
}

qaRouter.get('/recordings', async (req, res) => {
  const user = await assertQaAccess(req, res, false)
  if (!user) return
  try {
    const clauses: string[] = []
    const params: unknown[] = []
    if (typeof req.query.projectId === 'string' && req.query.projectId) {
      params.push(req.query.projectId)
      clauses.push(`r.project_id = $${params.length}`)
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      params.push(req.query.status)
      clauses.push(`r.status = $${params.length}`)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    res.json({ recordings: await loadRecordings(where, params) })
  } catch (err) {
    logError('qa recordings list failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

type RecordingBody = {
  title?: string
  projectId?: string | null
  recordDate?: string | null
  uploadTime?: string
  recordingType?: string
  resolution?: string
  audioFolder?: string
  audioCard?: string
  videoCard?: string
  dropboxUrl?: string
  dropboxPath?: string
  notes?: string
  shooterIds?: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const dateOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null

async function setShooters(recordingId: string, shooterIds: unknown): Promise<void> {
  if (!Array.isArray(shooterIds)) return
  const ids = shooterIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
  await pool.query(`DELETE FROM qa_recording_shooters WHERE recording_id = $1`, [recordingId])
  for (const uid of ids) {
    await pool.query(
      `INSERT INTO qa_recording_shooters (recording_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [recordingId, uid],
    )
  }
}

qaRouter.post('/recordings', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  const body = (req.body ?? {}) as RecordingBody
  const title = str(body.title)
  if (!title) { res.status(400).json({ error: 'title_required' }); return }
  try {
    const projectId = str(body.projectId) || null
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO qa_recordings
         (project_id, title, record_date, upload_time, recording_type, resolution,
          audio_folder, audio_card, video_card, dropbox_url, dropbox_path, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        projectId, title, dateOrNull(body.recordDate), str(body.uploadTime),
        str(body.recordingType), str(body.resolution), str(body.audioFolder),
        str(body.audioCard), str(body.videoCard), str(body.dropboxUrl),
        str(body.dropboxPath), str(body.notes), user.id,
      ],
    )
    const id = rows[0].id
    await setShooters(id, body.shooterIds)
    // Stamp the show's expected-deliverables template onto this recording.
    if (projectId) {
      await pool.query(
        `INSERT INTO qa_recording_checks (recording_id, label, spec, position)
         SELECT $1, label, spec, position FROM qa_checklist_items
          WHERE project_id = $2 ORDER BY position ASC`,
        [id, projectId],
      )
    }
    const [recording] = await loadRecordings('WHERE r.id = $1', [id])
    res.json({ recording })
  } catch (err) {
    logError('qa recording create failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

qaRouter.patch('/recordings/:id', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  const body = (req.body ?? {}) as RecordingBody
  try {
    const existing = await pool.query<{ id: string; project_id: string | null }>(
      `SELECT id, project_id FROM qa_recordings WHERE id = $1`, [req.params.id],
    )
    if (!existing.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    const sets: string[] = []
    const params: unknown[] = []
    const set = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col} = $${params.length}`)
    }
    if (body.title !== undefined) {
      const t = str(body.title)
      if (!t) { res.status(400).json({ error: 'title_required' }); return }
      set('title', t)
    }
    if (body.projectId !== undefined) set('project_id', str(body.projectId) || null)
    if (body.recordDate !== undefined) set('record_date', dateOrNull(body.recordDate))
    if (body.uploadTime !== undefined) set('upload_time', str(body.uploadTime))
    if (body.recordingType !== undefined) set('recording_type', str(body.recordingType))
    if (body.resolution !== undefined) set('resolution', str(body.resolution))
    if (body.audioFolder !== undefined) set('audio_folder', str(body.audioFolder))
    if (body.audioCard !== undefined) set('audio_card', str(body.audioCard))
    if (body.videoCard !== undefined) set('video_card', str(body.videoCard))
    if (body.dropboxUrl !== undefined) set('dropbox_url', str(body.dropboxUrl))
    if (body.dropboxPath !== undefined) set('dropbox_path', str(body.dropboxPath))
    if (body.notes !== undefined) set('notes', str(body.notes))
    if (sets.length > 0) {
      params.push(req.params.id)
      await pool.query(
        `UPDATE qa_recordings SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
        params,
      )
    }
    await setShooters(req.params.id, body.shooterIds)
    const [recording] = await loadRecordings('WHERE r.id = $1', [req.params.id])
    res.json({ recording })
  } catch (err) {
    logError('qa recording update failed', { error: err instanceof Error ? err.message : String(err), id: req.params.id })
    res.status(500).json({ error: 'internal_error' })
  }
})

qaRouter.delete('/recordings/:id', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  try {
    await pool.query(`DELETE FROM qa_recordings WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    logError('qa recording delete failed', { error: err instanceof Error ? err.message : String(err), id: req.params.id })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── QA verdict: approve / flag / reopen ─────────────────────────────────
// Approving stamps the current signed-in user as "QA by" — the approver
// list is the accounts list by construction.
qaRouter.post('/recordings/:id/status', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  const status = str((req.body ?? {}).status)
  if (!['pending', 'approved', 'flagged', 'cancelled'].includes(status)) {
    res.status(400).json({ error: 'bad_status' }); return
  }
  try {
    const stamped = status === 'approved' || status === 'flagged'
    await pool.query(
      stamped
        ? `UPDATE qa_recordings SET status = $2, qa_by = $3, qa_at = now(), updated_at = now() WHERE id = $1`
        : `UPDATE qa_recordings SET status = $2, qa_by = NULL, qa_at = NULL, updated_at = now() WHERE id = $1`,
      stamped ? [req.params.id, status, user.id] : [req.params.id, status],
    )
    const [recording] = await loadRecordings('WHERE r.id = $1', [req.params.id])
    if (!recording) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ recording })
  } catch (err) {
    logError('qa status change failed', { error: err instanceof Error ? err.message : String(err), id: req.params.id })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── Per-recording checklist items ───────────────────────────────────────
qaRouter.post('/recordings/:id/checks', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  const label = str((req.body ?? {}).label)
  if (!label) { res.status(400).json({ error: 'label_required' }); return }
  try {
    await pool.query(
      `INSERT INTO qa_recording_checks (recording_id, label, spec, position)
       VALUES ($1, $2, $3,
               COALESCE((SELECT MAX(position) FROM qa_recording_checks WHERE recording_id = $1), 0) + 10)`,
      [req.params.id, label, str((req.body ?? {}).spec)],
    )
    const [recording] = await loadRecordings('WHERE r.id = $1', [req.params.id])
    res.json({ recording })
  } catch (err) {
    logError('qa check add failed', { error: err instanceof Error ? err.message : String(err), id: req.params.id })
    res.status(500).json({ error: 'internal_error' })
  }
})

qaRouter.patch('/checks/:checkId', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  const body = (req.body ?? {}) as { checked?: boolean; label?: string; spec?: string }
  try {
    if (typeof body.checked === 'boolean') {
      await pool.query(
        body.checked
          ? `UPDATE qa_recording_checks SET checked = TRUE, checked_by = $2, checked_at = now() WHERE id = $1`
          : `UPDATE qa_recording_checks SET checked = FALSE, checked_by = NULL, checked_at = NULL WHERE id = $1`,
        body.checked ? [req.params.checkId, user.id] : [req.params.checkId],
      )
    }
    if (typeof body.label === 'string' && body.label.trim()) {
      await pool.query(`UPDATE qa_recording_checks SET label = $2 WHERE id = $1`, [req.params.checkId, body.label.trim()])
    }
    if (typeof body.spec === 'string') {
      await pool.query(`UPDATE qa_recording_checks SET spec = $2 WHERE id = $1`, [req.params.checkId, body.spec.trim()])
    }
    const rec = await pool.query<{ recording_id: string }>(
      `SELECT recording_id FROM qa_recording_checks WHERE id = $1`, [req.params.checkId],
    )
    if (!rec.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    const [recording] = await loadRecordings('WHERE r.id = $1', [rec.rows[0].recording_id])
    res.json({ recording })
  } catch (err) {
    logError('qa check update failed', { error: err instanceof Error ? err.message : String(err), checkId: req.params.checkId })
    res.status(500).json({ error: 'internal_error' })
  }
})

qaRouter.delete('/checks/:checkId', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  try {
    const rec = await pool.query<{ recording_id: string }>(
      `SELECT recording_id FROM qa_recording_checks WHERE id = $1`, [req.params.checkId],
    )
    await pool.query(`DELETE FROM qa_recording_checks WHERE id = $1`, [req.params.checkId])
    const recordingId = rec.rows[0]?.recording_id
    if (recordingId) {
      const [recording] = await loadRecordings('WHERE r.id = $1', [recordingId])
      res.json({ recording })
    } else {
      res.json({ ok: true })
    }
  } catch (err) {
    logError('qa check delete failed', { error: err instanceof Error ? err.message : String(err), checkId: req.params.checkId })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── Per-show expected-deliverables template ─────────────────────────────
qaRouter.get('/projects/:projectId/template', async (req, res) => {
  const user = await assertQaAccess(req, res, false)
  if (!user) return
  try {
    const { rows } = await pool.query(
      `SELECT id, label, spec, position FROM qa_checklist_items
        WHERE project_id = $1 ORDER BY position ASC, label ASC`,
      [req.params.projectId],
    )
    res.json({ items: rows })
  } catch (err) {
    logError('qa template get failed', { error: err instanceof Error ? err.message : String(err), projectId: req.params.projectId })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Replace-all save — the editor submits the full list. Only affects FUTURE
// recordings; checklists already stamped onto recordings stay as they are.
qaRouter.put('/projects/:projectId/template', async (req, res) => {
  const user = await assertQaAccess(req, res, true)
  if (!user) return
  const items = Array.isArray((req.body ?? {}).items) ? (req.body.items as Array<{ label?: string; spec?: string }>) : null
  if (!items) { res.status(400).json({ error: 'items_required' }); return }
  try {
    await pool.query(`DELETE FROM qa_checklist_items WHERE project_id = $1`, [req.params.projectId])
    let pos = 0
    for (const item of items) {
      const label = str(item.label)
      if (!label) continue
      pos += 10
      await pool.query(
        `INSERT INTO qa_checklist_items (project_id, label, spec, position) VALUES ($1, $2, $3, $4)`,
        [req.params.projectId, label, str(item.spec), pos],
      )
    }
    const { rows } = await pool.query(
      `SELECT id, label, spec, position FROM qa_checklist_items
        WHERE project_id = $1 ORDER BY position ASC`,
      [req.params.projectId],
    )
    res.json({ items: rows })
  } catch (err) {
    logError('qa template save failed', { error: err instanceof Error ? err.message : String(err), projectId: req.params.projectId })
    res.status(500).json({ error: 'internal_error' })
  }
})
