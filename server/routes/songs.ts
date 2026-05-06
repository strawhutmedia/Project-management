import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertSongWriter, getSongRole } from '../permissions'
import { logInfo } from '../diag'
import { findMentionedUsers, notify } from '../notifications'

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
            s.writer_id, s.tracker_id, s.overdub_id, s.producer_id, s.stems_id, s.mixer_id, s.master_id,
            wu.display_name AS writer_name, wu.name AS writer_full_name,
            tu.display_name AS tracker_name, tu.name AS tracker_full_name,
            ou.display_name AS overdub_name, ou.name AS overdub_full_name,
            pu.display_name AS producer_name, pu.name AS producer_full_name,
            su.display_name AS stems_name, su.name AS stems_full_name,
            mu.display_name AS mixer_name, mu.name AS mixer_full_name,
            mau.display_name AS master_name, mau.name AS master_full_name,
            p.name AS project_name, p.kind AS project_kind, p.dropbox_folder AS project_root,
            p.default_owners AS project_default_owners,
            p.stage_labels AS project_stage_labels
     FROM songs s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN users wu ON wu.id = s.writer_id
     LEFT JOIN users tu ON tu.id = s.tracker_id
     LEFT JOIN users ou ON ou.id = s.overdub_id
     LEFT JOIN users pu ON pu.id = s.producer_id
     LEFT JOIN users su ON su.id = s.stems_id
     LEFT JOIN users mu ON mu.id = s.mixer_id
     LEFT JOIN users mau ON mau.id = s.master_id
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

  // Resolve effective stage owners: explicit song owner, or fall back to project default.
  const defaults = (song.project_default_owners || {}) as Record<string, string>
  const defaultIds = Object.values(defaults).filter(Boolean)
  let defaultsByStage: Record<string, { id: string; name: string } | null> = {}
  if (defaultIds.length > 0) {
    const dRes = await pool.query(
      `SELECT id, name, display_name FROM users WHERE id = ANY($1)`,
      [defaultIds],
    )
    const byId: Record<string, { name: string }> = {}
    for (const r of dRes.rows) {
      byId[r.id] = { name: r.display_name || r.name }
    }
    for (const [stage, uid] of Object.entries(defaults)) {
      if (uid && byId[uid]) defaultsByStage[stage] = { id: uid, name: byId[uid].name }
    }
  }
  function effectiveOwner(stage: string, explicitId: string | null, explicitName: string | null) {
    if (explicitId) return { owner: { id: explicitId, name: explicitName || '' }, fromDefault: false }
    const d = defaultsByStage[stage]
    if (d) return { owner: d, fromDefault: true }
    return { owner: null, fromDefault: false }
  }
  const owners = {
    writing: effectiveOwner('writing', song.writer_id, song.writer_name || song.writer_full_name),
    tracking: effectiveOwner('tracking', song.tracker_id, song.tracker_name || song.tracker_full_name),
    overdubs: effectiveOwner('overdubs', song.overdub_id, song.overdub_name || song.overdub_full_name),
    producing: effectiveOwner('producing', song.producer_id, song.producer_name || song.producer_full_name),
    stems: effectiveOwner('stems', song.stems_id, song.stems_name || song.stems_full_name),
    mixing: effectiveOwner('mixing', song.mixer_id, song.mixer_name || song.mixer_full_name),
    mastering: effectiveOwner('mastering', song.master_id, song.master_name || song.master_full_name),
  }

  res.json({
    song: {
      id: song.id,
      projectId: song.project_id,
      projectName: song.project_name,
      projectKind: song.project_kind,
      projectRoot: song.project_root,
      projectStageLabels: song.project_stage_labels || {},
      title: song.title,
      subtitle: song.subtitle,
      stage: song.stage,
      dropboxFolder: song.dropbox_folder,
      stageOwners: {
        writing: owners.writing.owner,
        tracking: owners.tracking.owner,
        overdubs: owners.overdubs.owner,
        producing: owners.producing.owner,
        stems: owners.stems.owner,
        mixing: owners.mixing.owner,
        mastering: owners.mastering.owner,
      },
      stageOwnerFromDefault: {
        writing: owners.writing.fromDefault,
        tracking: owners.tracking.fromDefault,
        overdubs: owners.overdubs.fromDefault,
        producing: owners.producing.fromDefault,
        stems: owners.stems.fromDefault,
        mixing: owners.mixing.fromDefault,
        mastering: owners.mastering.fromDefault,
      },
      // legacy fields kept for backward compat
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
  if (!await assertSongWriter(user, songId, res)) return
  const { stage, title, subtitle, dropboxFolder, producerId, mixerId, writerId, trackerId, overdubId, stemsId, masterId } = req.body ?? {}

  // The Dropbox folder anchor is project-structural config, not an
  // operational edit — only Project Admins (and Super Admins) may
  // change it. A regular User changing it once accidentally points the
  // whole song at the wrong place for everyone.
  if (typeof dropboxFolder === 'string') {
    const role = await getSongRole(user.id, user.role, songId)
    if (role !== 'admin') {
      res.status(403).json({ error: 'project_admin_only_for_dropbox_folder' })
      return
    }
    logInfo('song.dropbox_folder changed', {
      songId,
      by: user.id,
      byEmail: user.email,
      newValue: dropboxFolder.trim() || null,
    })
  }
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
  const ownerFields: Array<[unknown, string]> = [
    [writerId, 'writer_id'],
    [trackerId, 'tracker_id'],
    [overdubId, 'overdub_id'],
    [producerId, 'producer_id'],
    [stemsId, 'stems_id'],
    [mixerId, 'mixer_id'],
    [masterId, 'master_id'],
  ]
  for (const [val, col] of ownerFields) {
    if (val === null || (typeof val === 'string' && val.length > 0)) {
      updates.push(`${col} = $${i++}`)
      values.push(val || null)
    }
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'no_fields' })
    return
  }
  values.push(songId)
  await pool.query(`UPDATE songs SET ${updates.join(', ')} WHERE id = $${i}`, values)

  // Notify newly-assigned producer / mixer (if changed).
  try {
    const songInfo = await pool.query(
      `SELECT s.title, s.subtitle, s.project_id, p.name AS project_name
       FROM songs s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
      [songId],
    )
    const s = songInfo.rows[0]
    if (s) {
      const link = `/projects/${s.project_id}/songs/${songId}`
      const songLabel = s.subtitle ? `${s.title} (${s.subtitle})` : s.title
      if (typeof producerId === 'string' && producerId.length > 0) {
        await notify({
          actorId: user.id,
          userId: producerId,
          kind: 'assigned_song_role',
          title: `You're now comping ${songLabel}`,
          body: `${user.display_name || user.name} assigned you as the comp engineer for ${songLabel} on ${s.project_name}.`,
          link,
          songId,
        })
      }
      if (typeof mixerId === 'string' && mixerId.length > 0) {
        await notify({
          actorId: user.id,
          userId: mixerId,
          kind: 'assigned_song_role',
          title: `You're now mixing ${songLabel}`,
          body: `${user.display_name || user.name} assigned you to mix ${songLabel} on ${s.project_name}.`,
          link,
          songId,
        })
      }
    }
  } catch {
    // non-critical
  }

  res.json({ ok: true })
})

// Tasks
songsRouter.post('/:id/tasks', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!await assertSongWriter(user, songId, res)) return
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
  const task = rows[0]

  // Notify assignee (if any) and any @mentioned users in the title.
  try {
    const songInfo = await pool.query(
      `SELECT s.title, s.subtitle, s.project_id, p.name AS project_name
       FROM songs s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
      [songId],
    )
    const s = songInfo.rows[0]
    if (s) {
      const link = `/projects/${s.project_id}/songs/${songId}`
      const songLabel = s.subtitle ? `${s.title} (${s.subtitle})` : s.title
      if (assigneeId) {
        await notify({
          actorId: user.id,
          userId: assigneeId,
          kind: 'assigned_task',
          title: `Task assigned: ${task.title}`,
          body: `${user.display_name || user.name} assigned you a task on ${songLabel}: "${task.title}"`,
          link,
          songId,
          taskId: task.id,
        })
      }
      const mentioned = await findMentionedUsers(task.title, s.project_id)
      for (const mu of mentioned) {
        if (mu.id === assigneeId) continue
        await notify({
          actorId: user.id,
          userId: mu.id,
          kind: 'mention',
          title: `You were mentioned in a task on ${songLabel}`,
          body: `${user.display_name || user.name}: "${task.title}"`,
          link,
          songId,
          taskId: task.id,
        })
      }
    }
  } catch {
    // non-critical
  }

  res.json({ task })
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
  if (!await assertSongWriter(user, accessRes.rows[0].song_id, res)) return
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

  // Notify newly-assigned assignee
  if (typeof assigneeId === 'string' && assigneeId.length > 0) {
    try {
      const t = await pool.query(
        `SELECT t.title, t.song_id, s.title AS song_title, s.subtitle AS song_subtitle,
                s.project_id
         FROM tasks t JOIN songs s ON s.id = t.song_id WHERE t.id = $1`,
        [taskId],
      )
      if (t.rows.length > 0) {
        const r = t.rows[0]
        const songLabel = r.song_subtitle ? `${r.song_title} (${r.song_subtitle})` : r.song_title
        await notify({
          actorId: user.id,
          userId: assigneeId,
          kind: 'assigned_task',
          title: `Task assigned: ${r.title}`,
          body: `${user.display_name || user.name} assigned you a task on ${songLabel}: "${r.title}"`,
          link: `/projects/${r.project_id}/songs/${r.song_id}`,
          songId: r.song_id,
          taskId,
        })
      }
    } catch {
      // non-critical
    }
  }

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
  if (!await assertSongWriter(user, accessRes.rows[0].song_id, res)) return
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [taskId])
  res.json({ ok: true })
})

// Comments
songsRouter.post('/:id/comments', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = req.params.id
  if (!await assertSongWriter(user, songId, res)) return
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

  // Notify @mentioned users
  try {
    const songInfo = await pool.query(
      `SELECT s.title, s.subtitle, s.project_id, p.name AS project_name
       FROM songs s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
      [songId],
    )
    const s = songInfo.rows[0]
    if (s) {
      const songLabel = s.subtitle ? `${s.title} (${s.subtitle})` : s.title
      const mentioned = await findMentionedUsers(c.body, s.project_id)
      for (const mu of mentioned) {
        await notify({
          actorId: user.id,
          userId: mu.id,
          kind: 'mention',
          title: `${user.display_name || user.name} mentioned you on ${songLabel}`,
          body: `${user.display_name || user.name}: ${c.body.slice(0, 280)}`,
          link: `/projects/${s.project_id}/songs/${songId}`,
          songId,
        })
      }
    }
  } catch {
    // non-critical
  }

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
  if (!await assertSongWriter(user, c.song_id, res)) return
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
  if (!await assertSongWriter(user, songId, res)) return
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
  if (!await assertSongWriter(user, rows[0].song_id, res)) return
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
  if (!await assertSongWriter(user, rows[0].song_id, res)) return
  await pool.query(`DELETE FROM links WHERE id = $1`, [linkId])
  res.json({ ok: true })
})
