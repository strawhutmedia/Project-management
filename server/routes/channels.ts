import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { logError } from '../diag'

// Faceless YouTube channels — a separate top-level area, distinct from
// album/podcast/film projects. Reads are open to any signed-in user; writes
// are admin-only (channels are workspace-owned, managed by the admin).
export const channelsRouter = Router()
channelsRouter.use(requireUser)

// Admin-only guard for write methods. Reads (GET/HEAD) always pass.
function requireAdminWrite(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }
  const u = (req as Request & { user?: SessionUser }).user
  if (u?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}
channelsRouter.use(requireAdminWrite)

// GET / — list all channels with lightweight counts.
channelsRouter.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.subtitle, c.premise, c.audience, c.created_at,
              (SELECT COUNT(*) FROM channel_characters cc WHERE cc.channel_id = c.id) AS character_count,
              (SELECT COUNT(*) FROM channel_episodes ce WHERE ce.channel_id = c.id) AS episode_count
         FROM channels c
        ORDER BY c.created_at ASC`,
    )
    res.json({
      channels: rows.map((r) => ({
        id: r.id,
        name: r.name,
        subtitle: r.subtitle,
        premise: r.premise,
        audience: r.audience,
        createdAt: r.created_at,
        characterCount: Number(r.character_count),
        episodeCount: Number(r.episode_count),
      })),
    })
  } catch (err) {
    logError('channels list failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// GET /:id — one channel with its cast and episode list (no scenes).
channelsRouter.get('/:id', async (req, res) => {
  try {
    const chRes = await pool.query(
      `SELECT id, name, subtitle, premise, audience, art_style, created_at
         FROM channels WHERE id = $1`,
      [req.params.id],
    )
    const ch = chRes.rows[0]
    if (!ch) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const chars = await pool.query(
      `SELECT id, name, role, look_lock, personality, position
         FROM channel_characters WHERE channel_id = $1 ORDER BY position ASC, created_at ASC`,
      [ch.id],
    )
    const eps = await pool.query(
      `SELECT ce.id, ce.episode_number, ce.title, ce.feeling, ce.logline, ce.status, ce.position,
              (SELECT COUNT(*) FROM episode_scenes es WHERE es.episode_id = ce.id) AS scene_count
         FROM channel_episodes ce WHERE ce.channel_id = $1
        ORDER BY ce.position ASC, ce.episode_number ASC, ce.created_at ASC`,
      [ch.id],
    )
    res.json({
      channel: {
        id: ch.id,
        name: ch.name,
        subtitle: ch.subtitle,
        premise: ch.premise,
        audience: ch.audience,
        artStyle: ch.art_style,
        createdAt: ch.created_at,
        characters: chars.rows.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          lookLock: c.look_lock,
          personality: c.personality,
          position: c.position,
        })),
        episodes: eps.rows.map((e) => ({
          id: e.id,
          episodeNumber: e.episode_number,
          title: e.title,
          feeling: e.feeling,
          logline: e.logline,
          status: e.status,
          position: e.position,
          sceneCount: Number(e.scene_count),
        })),
      },
    })
  } catch (err) {
    logError('channel get failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

const MAIN_URL_PLACEHOLDER = '[PASTE MAIN VIDEO URL HERE]'

// GET /episodes/:episodeId — one episode with its scenes, publish kit, and
// shorts. A short's {{MAIN_URL}} token is resolved to the episode's published
// URL (or a placeholder until it's set).
channelsRouter.get('/episodes/:episodeId', async (req, res) => {
  try {
    const epRes = await pool.query(
      `SELECT ce.id, ce.channel_id, ce.episode_number, ce.title, ce.feeling, ce.logline,
              ce.youtube_title, ce.thumbnail_concept, ce.short_concept, ce.status,
              ce.yt_description, ce.yt_tags, ce.yt_category, ce.made_for_kids,
              ce.playlist, ce.pinned_comment, ce.recommended_publish, ce.youtube_url,
              c.name AS channel_name
         FROM channel_episodes ce JOIN channels c ON c.id = ce.channel_id
        WHERE ce.id = $1`,
      [req.params.episodeId],
    )
    const ep = epRes.rows[0]
    if (!ep) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const scenes = await pool.query(
      `SELECT id, position, visual, narration FROM episode_scenes
        WHERE episode_id = $1 ORDER BY position ASC, created_at ASC`,
      [ep.id],
    )
    const shorts = await pool.query(
      `SELECT id, position, title, description, recommended_publish, made_for_kids
         FROM episode_shorts WHERE episode_id = $1 ORDER BY position ASC, created_at ASC`,
      [ep.id],
    )
    const mainUrl = ep.youtube_url || MAIN_URL_PLACEHOLDER
    res.json({
      episode: {
        id: ep.id,
        channelId: ep.channel_id,
        channelName: ep.channel_name,
        episodeNumber: ep.episode_number,
        title: ep.title,
        feeling: ep.feeling,
        logline: ep.logline,
        youtubeTitle: ep.youtube_title,
        thumbnailConcept: ep.thumbnail_concept,
        shortConcept: ep.short_concept,
        status: ep.status,
        ytDescription: ep.yt_description,
        ytTags: ep.yt_tags,
        ytCategory: ep.yt_category,
        madeForKids: ep.made_for_kids,
        playlist: ep.playlist,
        pinnedComment: ep.pinned_comment,
        recommendedPublish: ep.recommended_publish,
        youtubeUrl: ep.youtube_url,
        scenes: scenes.rows.map((s) => ({
          id: s.id,
          position: s.position,
          visual: s.visual,
          narration: s.narration,
        })),
        shorts: shorts.rows.map((s) => ({
          id: s.id,
          position: s.position,
          title: s.title,
          description: (s.description ?? '').replaceAll('{{MAIN_URL}}', mainUrl),
          recommendedPublish: s.recommended_publish,
          madeForKids: s.made_for_kids,
          linksTo: ep.title,
        })),
      },
    })
  } catch (err) {
    logError('episode get failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// PATCH /episodes/:episodeId — update episode fields (admin). The common use
// is pasting the published main-video URL back in, which completes the shorts.
channelsRouter.patch('/episodes/:episodeId', async (req, res) => {
  const fields: Array<[string, string]> = [
    ['title', 'title'],
    ['feeling', 'feeling'],
    ['logline', 'logline'],
    ['youtubeTitle', 'youtube_title'],
    ['thumbnailConcept', 'thumbnail_concept'],
    ['status', 'status'],
    ['ytDescription', 'yt_description'],
    ['ytTags', 'yt_tags'],
    ['ytCategory', 'yt_category'],
    ['madeForKids', 'made_for_kids'],
    ['playlist', 'playlist'],
    ['pinnedComment', 'pinned_comment'],
    ['recommendedPublish', 'recommended_publish'],
    ['youtubeUrl', 'youtube_url'],
  ]
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [key, col] of fields) {
    if (req.body?.[key] !== undefined) {
      vals.push(req.body[key])
      sets.push(`${col} = $${vals.length}`)
    }
  }
  if (sets.length === 0) {
    res.json({ ok: true })
    return
  }
  vals.push(req.params.episodeId)
  try {
    await pool.query(`UPDATE channel_episodes SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    res.json({ ok: true })
  } catch (err) {
    logError('episode patch failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// POST / — create a channel (admin).
channelsRouter.post('/', async (req, res) => {
  const user = (req as Request & { user: SessionUser }).user
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null
  if (!name) {
    res.status(400).json({ error: 'name_required' })
    return
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO channels (name, subtitle, premise, audience, art_style, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        name,
        req.body?.subtitle ?? null,
        req.body?.premise ?? null,
        req.body?.audience ?? null,
        req.body?.artStyle ?? null,
        user.id,
      ],
    )
    res.json({ ok: true, id: rows[0].id })
  } catch (err) {
    logError('channel create failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// PATCH /:id — update channel fields (admin).
channelsRouter.patch('/:id', async (req, res) => {
  const fields: Array<[string, string]> = [
    ['name', 'name'],
    ['subtitle', 'subtitle'],
    ['premise', 'premise'],
    ['audience', 'audience'],
    ['artStyle', 'art_style'],
  ]
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [key, col] of fields) {
    if (req.body?.[key] !== undefined) {
      vals.push(req.body[key])
      sets.push(`${col} = $${vals.length}`)
    }
  }
  if (sets.length === 0) {
    res.json({ ok: true })
    return
  }
  vals.push(req.params.id)
  try {
    await pool.query(`UPDATE channels SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    res.json({ ok: true })
  } catch (err) {
    logError('channel patch failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// PATCH /characters/:characterId — update a character (admin).
channelsRouter.patch('/characters/:characterId', async (req, res) => {
  const fields: Array<[string, string]> = [
    ['name', 'name'],
    ['role', 'role'],
    ['lookLock', 'look_lock'],
    ['personality', 'personality'],
  ]
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [key, col] of fields) {
    if (req.body?.[key] !== undefined) {
      vals.push(req.body[key])
      sets.push(`${col} = $${vals.length}`)
    }
  }
  if (sets.length === 0) {
    res.json({ ok: true })
    return
  }
  vals.push(req.params.characterId)
  try {
    await pool.query(`UPDATE channel_characters SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    res.json({ ok: true })
  } catch (err) {
    logError('character patch failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// PATCH /scenes/:sceneId — update a scene's visual/narration (admin).
channelsRouter.patch('/scenes/:sceneId', async (req, res) => {
  const sets: string[] = []
  const vals: unknown[] = []
  if (req.body?.visual !== undefined) {
    vals.push(req.body.visual)
    sets.push(`visual = $${vals.length}`)
  }
  if (req.body?.narration !== undefined) {
    vals.push(req.body.narration)
    sets.push(`narration = $${vals.length}`)
  }
  if (sets.length === 0) {
    res.json({ ok: true })
    return
  }
  vals.push(req.params.sceneId)
  try {
    await pool.query(`UPDATE episode_scenes SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    res.json({ ok: true })
  } catch (err) {
    logError('scene patch failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})
