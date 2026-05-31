import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { getProjectRole, assertWriter, assertProjectAdmin } from '../permissions'
import { fetchPodcastFeed } from '../rss'
import { hasAnthropicKey, generateBrandProfile } from '../anthropic'
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

projectsRouter.use(requireUser)

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
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'admin'`,
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

  if (!await assertWriter(user, projectId, res)) return

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

    // Returns each user's project_role (the per-project role) so the
    // member-management UI can show + edit it. System admins not in the
    // members table are surfaced as 'admin' (they have implicit auto-access).
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.display_name, u.role,
              COALESCE(pm.role, CASE WHEN u.role = 'admin' THEN 'admin' END) AS project_role
       FROM users u
       LEFT JOIN project_members pm
         ON pm.user_id = u.id AND pm.project_id = $1
       WHERE u.role = 'admin'
          OR pm.user_id IS NOT NULL
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
  // default roles, stage labels) is project-admin-only. Operational edits —
  // adding channels, editing channel titles, tasks, comments — go through
  // their own routes and remain available to project users.
  if (!await assertProjectAdmin(user, projectId, res)) return
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
  if ('socialsBrandVoice' in (req.body ?? {})) {
    const v = req.body.socialsBrandVoice
    updates.push(`socials_brand_voice = $${i++}`)
    values.push(typeof v === 'string' && v.trim() ? v.trim().slice(0, 8000) : null)
  }
  if (Array.isArray(req.body?.socialsExamplePosts)) {
    const cleaned = (req.body.socialsExamplePosts as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 1000))
      .slice(0, 20)
    updates.push(`socials_example_posts = $${i++}::jsonb`)
    values.push(JSON.stringify(cleaned))
  }
  if (req.body?.socialsDefaultAssignees && typeof req.body.socialsDefaultAssignees === 'object') {
    const allowedKinds = ['story_video', 'story_photo', 'reel_concept', 'photo_concept']
    const cleaned: Record<string, string> = {}
    for (const k of allowedKinds) {
      const v = (req.body.socialsDefaultAssignees as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.length > 0) cleaned[k] = v
    }
    updates.push(`socials_default_assignees = $${i++}::jsonb`)
    values.push(JSON.stringify(cleaned))
  }
  if ('rssFeedUrl' in (req.body ?? {})) {
    const v = req.body.rssFeedUrl
    updates.push(`rss_feed_url = $${i++}`)
    values.push(typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null)
  }
  if ('coverArtUrl' in (req.body ?? {})) {
    const v = req.body.coverArtUrl
    updates.push(`cover_art_url = $${i++}`)
    values.push(typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null)
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
    `SELECT id, name, subtitle, kind, dropbox_folder, default_owners, stage_labels, channels_subfolder, film_phase,
            socials_brand_voice, socials_example_posts, socials_default_assignees,
            rss_feed_url, cover_art_url,
            socials_brand_profile, socials_brand_profile_at
       FROM projects WHERE id = $1`,
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
      socialsBrandVoice: project.socials_brand_voice ?? null,
      socialsExamplePosts: Array.isArray(project.socials_example_posts) ? project.socials_example_posts : [],
      socialsDefaultAssignees: (project.socials_default_assignees && typeof project.socials_default_assignees === 'object')
        ? project.socials_default_assignees : {},
      rssFeedUrl: project.rss_feed_url ?? null,
      coverArtUrl: project.cover_art_url ?? null,
      brandProfile: project.socials_brand_profile ?? null,
      brandProfileAt: project.socials_brand_profile_at ?? null,
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

// ===== Per-project member management =====
// Add an existing workspace user to a project at a given role.
projectsRouter.post('/:id/members', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (!await assertProjectAdmin(user, projectId, res)) return
  const { userId, role } = req.body as { userId?: string; role?: 'admin' | 'user' | 'viewer' }
  if (!userId || !role || !['admin', 'user', 'viewer'].includes(role)) {
    res.status(400).json({ error: 'userId and role required' }); return
  }
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, role],
  )
  res.json({ ok: true })
})

projectsRouter.patch('/:id/members/:userId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (!await assertProjectAdmin(user, projectId, res)) return
  const { role } = req.body as { role?: 'admin' | 'user' | 'viewer' }
  if (!role || !['admin', 'user', 'viewer'].includes(role)) {
    res.status(400).json({ error: 'role required' }); return
  }
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, req.params.userId, role],
  )
  res.json({ ok: true })
})

projectsRouter.delete('/:id/members/:userId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (!await assertProjectAdmin(user, projectId, res)) return
  // Don't let the last project admin be removed.
  const target = await pool.query<{ role: string }>(
    `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, req.params.userId],
  )
  if (target.rows[0]?.role === 'admin') {
    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM project_members WHERE project_id = $1 AND role = 'admin'`,
      [projectId],
    )
    if (Number(count.rows[0].n) <= 1) {
      res.status(400).json({ error: 'cannot_remove_last_admin' }); return
    }
  }
  await pool.query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, req.params.userId],
  )
  res.json({ ok: true })
})

// Fetch + parse the project's RSS feed, extract show-level metadata
// (title, description, cover art URL), persist what's useful, and return
// it. Admin-only because it touches project config. Idempotent — safe to
// re-run when the show updates artwork.
projectsRouter.post('/:id/import-rss', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (!await assertProjectAdmin(user, projectId, res)) return
  const url = String(req.body?.rssFeedUrl || '').trim()
  if (!url) {
    res.status(400).json({ error: 'rssFeedUrl required' }); return
  }
  let meta
  try {
    meta = await fetchPodcastFeed(url)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) }); return
  }
  await pool.query(
    `UPDATE projects
        SET rss_feed_url = $2,
            cover_art_url = COALESCE($3, cover_art_url),
            subtitle = COALESCE(NULLIF(subtitle, ''), $4)
      WHERE id = $1`,
    [projectId, url, meta.coverArtUrl, meta.description],
  )
  res.json({ rssFeedUrl: url, coverArtUrl: meta.coverArtUrl, title: meta.title, description: meta.description })
})

// "Slate's read on this show" — calls Claude to propose a brand voice,
// example posts, posting times, weekly cadence, and default assignees.
// Caches the result on the project (overwriting any previous read) so
// the project page can re-render without re-calling Claude.
projectsRouter.post('/:id/brand-profile', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (!await assertProjectAdmin(user, projectId, res)) return

  const projRes = await pool.query<{
    name: string
    subtitle: string | null
    kind: 'podcast' | 'album' | 'film'
    rss_feed_url: string | null
  }>(
    `SELECT name, subtitle, kind, rss_feed_url FROM projects WHERE id = $1`,
    [projectId],
  )
  if (projRes.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const p = projRes.rows[0]

  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' }); return
  }

  // Pull RSS feed (description + recent episodes) if available
  let showDescription: string | null = null
  let recentEpisodes: Array<{ title: string; description?: string }> = []
  if (p.rss_feed_url) {
    try {
      const feed = await fetchPodcastFeed(p.rss_feed_url)
      showDescription = feed.description
      recentEpisodes = feed.episodes.map((e) => ({
        title: e.title,
        description: e.description ?? undefined,
      }))
    } catch (err) {
      logError('brand profile: rss fetch failed', { url: p.rss_feed_url, error: err instanceof Error ? err.message : String(err) })
      // Continue without RSS data
    }
  }

  // Pull up to 3 most-recent done transcripts and join snippets together
  // for voice signal. We cap each to ~2000 chars to keep prompt costs
  // sane while still giving Claude enough to read tone.
  const tRes = await pool.query<{ edited_blocks: Array<{ speaker: string; text: string }> | null }>(
    `SELECT edited_blocks
       FROM transcripts t
      WHERE t.song_id IN (SELECT id FROM songs WHERE project_id = $1)
        AND t.status = 'done'
      ORDER BY t.created_at DESC LIMIT 3`,
    [projectId],
  )
  const transcriptSamples = tRes.rows
    .map((r) => (r.edited_blocks ?? []).map((b) => `${b.speaker}: ${b.text}`).join('\n').slice(0, 2000))
    .filter((s) => s.length > 0)
    .join('\n\n---\n\n')

  // Available users for assignee suggestions: workspace admins + this
  // project's members. Pass id + display name so Claude can pick from
  // a real pool.
  const uRes = await pool.query<{ id: string; name: string; display_name: string | null }>(
    `SELECT DISTINCT u.id, u.name, u.display_name
       FROM users u
       LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = $1
      WHERE u.role = 'admin' OR pm.user_id IS NOT NULL`,
    [projectId],
  )
  const availableUsers = uRes.rows.map((u) => ({ id: u.id, name: u.display_name || u.name }))

  let result
  try {
    result = await generateBrandProfile({
      showName: p.name,
      showSubtitle: p.subtitle,
      kind: p.kind,
      showDescription,
      recentEpisodes,
      transcriptSamples,
      availableUsers,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('brand profile: generation failed', { projectId, error: msg })
    res.status(502).json({ error: `generation_failed: ${msg.slice(0, 200)}` }); return
  }

  await pool.query(
    `UPDATE projects
        SET socials_brand_profile = $2::jsonb,
            socials_brand_profile_at = now()
      WHERE id = $1`,
    [projectId, JSON.stringify(result.profile)],
  )
  res.json({ profile: result.profile, generatedAt: new Date().toISOString() })
})
