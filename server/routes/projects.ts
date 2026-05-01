import { Router } from 'express'
import { pool } from '../db'
import { requireUser, blockViewerWrites, type SessionUser } from '../auth'
import { logInfo, logError } from '../diag'

// Look up the admin user (Ryan) by ADMIN_EMAIL so we can auto-assign
// the Executive Producer role on every new podcast project. Falls back
// to any user with role='admin' if the env email isn't found.
async function findAdminUserId(): Promise<string | null> {
  const adminEmail = process.env.ADMIN_EMAIL || 'ryan@strawhutmedia.com'
  const byEmail = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [adminEmail],
  )
  if (byEmail.rows.length > 0) return byEmail.rows[0].id
  const byRole = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
  )
  return byRole.rows[0]?.id ?? null
}

// Backfill helper: for every existing podcast project, ensure the
// Executive Producer slot is set to the admin. Idempotent — only writes
// if the slot is currently empty. Called once at boot.
export async function ensureRyanIsPodcastEp(): Promise<void> {
  const ryanId = await findAdminUserId()
  if (!ryanId) return
  const { rows } = await pool.query<{ id: string; default_owners: Record<string, unknown> | null }>(
    `SELECT id, default_owners FROM projects WHERE kind = 'podcast'`,
  )
  for (const r of rows) {
    const current = (r.default_owners ?? {}) as Record<string, unknown>
    if (current.executive_producer) continue
    const next = { ...current, executive_producer: ryanId }
    await pool.query(
      `UPDATE projects SET default_owners = $1::jsonb WHERE id = $2`,
      [JSON.stringify(next), r.id],
    )
    logInfo('podcast: backfilled executive_producer = admin', { projectId: r.id })
  }
}

export const projectsRouter = Router()

projectsRouter.use(requireUser, blockViewerWrites)

projectsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projects = await pool.query(
    `SELECT DISTINCT p.id, p.name, p.subtitle, p.kind, p.created_at, p.stage_labels
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
    projects: projects.rows.map((p: { id: string; name: string; subtitle: string | null; kind: string; stage_labels: Record<string, unknown> | null }) => ({
      id: p.id,
      name: p.name,
      subtitle: p.subtitle,
      kind: p.kind,
      stageLabels: p.stage_labels || {},
      songs: songsByProject[p.id],
    })),
  })
})

// Default stage labels per project kind. The internal stage keys stay
// the same (writing/tracking/overdubs/producing/stems/mixing/mastering/done)
// so the data layer is identical across project types — only the displayed
// label and icon change per project.
const PODCAST_LABELS = {
  writing: { label: 'Scheduled', icon: '📅' },
  tracking: { label: 'Prepped', icon: '🎤' },
  overdubs: { label: 'Recorded', icon: '🎬' },
  producing: { label: 'Editing', icon: '✂️' },
  stems: { label: 'Client Review', icon: '👀' },
  mixing: { label: 'Revisions', icon: '🔧' },
  mastering: { label: 'Finalized', icon: '✨' },
  done: { label: 'Released', icon: '🚀' },
}

projectsRouter.post('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const name = String(req.body?.name || '').trim()
  const subtitle = String(req.body?.subtitle || '').trim() || null
  const kindRaw = req.body?.kind
  const kind = kindRaw === 'podcast' || kindRaw === 'film' ? kindRaw : 'album'
  const dropboxFolder = String(req.body?.dropboxFolder || '').trim() || null

  if (!name) {
    res.status(400).json({ error: 'name_required' })
    return
  }

  const stageLabels = kind === 'podcast' ? PODCAST_LABELS : {}
  const channelsSubfolder = kind === 'podcast' ? 'episodes' : null

  // For podcasts, auto-default the Executive Producer slot to the
  // workspace admin (Ryan). Project creator gets Project Manager unless
  // they're Ryan, in which case PM stays unassigned for explicit picking.
  const defaultOwners: Record<string, string> = {}
  if (kind === 'podcast') {
    const ryanId = await findAdminUserId()
    if (ryanId) defaultOwners.executive_producer = ryanId
    if (ryanId && user.id !== ryanId) defaultOwners.project_manager = user.id
  }

  const { rows } = await pool.query(
    `INSERT INTO projects (name, subtitle, kind, created_by, dropbox_folder, stage_labels, channels_subfolder, default_owners)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
     RETURNING id, name, subtitle, kind, dropbox_folder, stage_labels, channels_subfolder`,
    [name.slice(0, 200), subtitle, kind, user.id, dropboxFolder, JSON.stringify(stageLabels), channelsSubfolder, JSON.stringify(defaultOwners)],
  )
  const project = rows[0]
  await pool.query(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [project.id, user.id],
  )
  logInfo('project created', { id: project.id, name: project.name, kind, by: user.id })
  res.json({
    project: {
      id: project.id,
      name: project.name,
      subtitle: project.subtitle,
      kind: project.kind,
      dropboxFolder: project.dropbox_folder,
      songs: [],
    },
  })
})

// Create a new channel/song/episode under a project. Auto-derives the
// Dropbox folder using {project_root}/{channels_subfolder}/{title}/
// (or {project_root}/{title}/ if no channels_subfolder is set).
projectsRouter.post('/:id/songs', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  const title = String(req.body?.title || '').trim()
  const subtitle = String(req.body?.subtitle || '').trim() || null

  if (!title) {
    res.status(400).json({ error: 'title_required' })
    return
  }

  // Verify access
  if (user.role !== 'admin') {
    const access = await pool.query(
      `SELECT 1 FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
       WHERE p.id = $2 AND (p.created_by = $1 OR pm.user_id IS NOT NULL) LIMIT 1`,
      [user.id, projectId],
    )
    if (access.rows.length === 0) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const projRes = await pool.query(
    `SELECT dropbox_folder, channels_subfolder FROM projects WHERE id = $1`,
    [projectId],
  )
  if (projRes.rows.length === 0) {
    res.status(404).json({ error: 'project_not_found' })
    return
  }
  const root = projRes.rows[0].dropbox_folder as string | null
  const subfolder = projRes.rows[0].channels_subfolder as string | null

  let dropboxFolder: string | null = null
  if (root) {
    const cleanRoot = root.replace(/\/+$/, '')
    const folderTitle = subtitle ? `${title} (${subtitle})` : title
    dropboxFolder = subfolder
      ? `${cleanRoot}/${subfolder}/${folderTitle}`
      : `${cleanRoot}/${folderTitle}`
  }

  const positionRes = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM songs WHERE project_id = $1`,
    [projectId],
  )
  const position = positionRes.rows[0].next as number

  const { rows } = await pool.query(
    `INSERT INTO songs (project_id, title, subtitle, stage, position, dropbox_folder)
     VALUES ($1, $2, $3, 'writing', $4, $5)
     RETURNING id, title, subtitle, stage, position, dropbox_folder`,
    [projectId, title.slice(0, 200), subtitle, position, dropboxFolder],
  )
  logInfo('song created', { id: rows[0].id, projectId, title })
  res.json({ song: rows[0] })
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
  // Project-level config (name, subtitle, Dropbox root, channels subfolder,
  // default roles, stage labels) is admin-only. Operational edits — adding
  // channels, editing channel titles, tasks, comments — happen through
  // their own routes and remain available to project members.
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'admin_only' })
    return
  }
  const { name, subtitle, dropboxFolder, defaultOwners } = req.body ?? {}
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
  if (typeof req.body?.channelsSubfolder === 'string' || req.body?.channelsSubfolder === null) {
    const v = typeof req.body.channelsSubfolder === 'string' ? req.body.channelsSubfolder.trim() : ''
    updates.push(`channels_subfolder = $${i++}`)
    values.push(v || null)
  }
  if (defaultOwners && typeof defaultOwners === 'object') {
    // Whitelist: music stage keys + film role keys + podcast role keys
    const allowed = [
      // Music
      'writing', 'tracking', 'overdubs', 'producing', 'stems', 'mixing', 'mastering',
      // Film
      'writer', 'producer', 'director', 'asst_director', 'editor',
      // Podcast (note: 'producer' and 'editor' are shared with film)
      'project_manager', 'executive_producer',
    ]
    const cleaned: Record<string, string> = {}
    for (const k of allowed) {
      const v = (defaultOwners as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.length > 0) cleaned[k] = v
    }
    updates.push(`default_owners = $${i++}::jsonb`)
    values.push(JSON.stringify(cleaned))
  }
  if (typeof req.body?.filmPhase === 'string') {
    const phase = req.body.filmPhase
    if (['pre', 'production', 'post', 'wrapped'].includes(phase)) {
      updates.push(`film_phase = $${i++}`)
      values.push(phase)
    }
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
    `SELECT id, name, subtitle, kind, dropbox_folder, default_owners, stage_labels, channels_subfolder, film_phase FROM projects WHERE id = $1`,
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
  // Resolve default owner names for the project page UI.
  const defaultOwners = (project.default_owners || {}) as Record<string, string>
  const defaultIds = Object.values(defaultOwners).filter(Boolean)
  const defaultOwnersResolved: Record<string, { id: string; name: string } | null> = {}
  if (defaultIds.length > 0) {
    const dRes = await pool.query(
      `SELECT id, name, display_name FROM users WHERE id = ANY($1)`,
      [defaultIds],
    )
    const byId: Record<string, string> = {}
    for (const r of dRes.rows) byId[r.id] = r.display_name || r.name
    for (const [stage, uid] of Object.entries(defaultOwners)) {
      if (uid && byId[uid]) defaultOwnersResolved[stage] = { id: uid, name: byId[uid] }
    }
  }

  res.json({
    project: {
      id: project.id,
      name: project.name,
      subtitle: project.subtitle,
      kind: project.kind,
      dropboxFolder: project.dropbox_folder,
      defaultOwners: defaultOwnersResolved,
      stageLabels: project.stage_labels || {},
      channelsSubfolder: project.channels_subfolder,
      filmPhase: project.film_phase || 'pre',
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
