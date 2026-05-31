// Daily social plans for podcast episodes.
//
//   POST   /api/socials                       → generate a plan for an episode
//   GET    /api/socials?songId=…              → list plans for an episode
//   GET    /api/socials/:id                   → one plan + items
//   PATCH  /api/socials/:id                   → update an item's text / status
//   DELETE /api/socials/:id                   → remove
//
// Generation is fire-and-forget: we insert the row with status='generating',
// return immediately, and finish the Claude call in the background. The
// frontend polls until status flips to 'generated' or 'failed'.
import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { hasAnthropicKey, generateSocialPlan, type RawSocialPlan } from '../anthropic'
import { logError, logInfo } from '../diag'

export const socialsRouter = Router()
socialsRouter.use(requireUser)

const MAX_TRANSCRIPT_CHARS = 200_000

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

export type SocialItem =
  | { id: string; kind: 'text_post'; status: ItemStatus; ai_text: string; text: string }
  | { id: string; kind: 'story_concept'; status: ItemStatus; assignee_user_id: string | null; medium: 'video' | 'photo'; description: string; caption: string; suggested_clip: string; image_direction: string }
  | { id: string; kind: 'reel_concept'; status: ItemStatus; assignee_user_id: string | null; hook: string; talking_points: string[]; suggested_clip: string }
  | { id: string; kind: 'photo_concept'; status: ItemStatus; assignee_user_id: string | null; image_direction: string; caption: string; vibe: string }

type ItemStatus = 'idea' | 'drafted' | 'selected' | 'rejected' | 'scheduled' | 'posted'

function rawPlanToItems(plan: RawSocialPlan, defaults: Record<string, string | undefined>): SocialItem[] {
  const a = (key: string): string | null => defaults[key] ?? null
  const items: SocialItem[] = []
  for (const p of plan.text_posts) {
    items.push({ id: crypto.randomUUID(), kind: 'text_post', status: 'drafted', ai_text: p.text, text: p.text })
  }
  for (const s of plan.story_concepts) {
    items.push({
      id: crypto.randomUUID(),
      kind: 'story_concept',
      status: 'idea',
      // story_video / story_photo defaults route each item to the right
      // human owner without the admin having to manually reassign.
      assignee_user_id: s.medium === 'video' ? a('story_video') : a('story_photo'),
      medium: s.medium,
      description: s.description,
      caption: s.caption,
      suggested_clip: s.suggested_clip,
      image_direction: s.image_direction,
    })
  }
  for (const r of plan.reel_concepts) {
    items.push({
      id: crypto.randomUUID(),
      kind: 'reel_concept',
      status: 'idea',
      assignee_user_id: a('reel_concept'),
      hook: r.hook,
      talking_points: r.talking_points,
      suggested_clip: r.suggested_clip,
    })
  }
  for (const ph of plan.photo_concepts) {
    items.push({
      id: crypto.randomUUID(),
      kind: 'photo_concept',
      status: 'idea',
      assignee_user_id: a('photo_concept'),
      image_direction: ph.image_direction,
      caption: ph.caption,
      vibe: ph.vibe,
    })
  }
  return items
}

type PlanRow = {
  id: string
  project_id: string
  song_id: string
  transcript_id: string | null
  items: SocialItem[]
  status: 'generating' | 'generated' | 'failed'
  error: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_create_tokens: number | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function rowToApi(row: PlanRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    songId: row.song_id,
    transcriptId: row.transcript_id,
    items: row.items,
    status: row.status,
    error: row.error,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreateTokens: row.cache_create_tokens,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// LIST
socialsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = String(req.query.songId || '')
  if (!songId) { res.status(400).json({ error: 'songId required' }); return }
  const songRes = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM songs WHERE id = $1`, [songId],
  )
  if (songRes.rows.length === 0) { res.status(404).json({ error: 'song_not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, songRes.rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<PlanRow>(
    `SELECT * FROM social_plans WHERE song_id = $1 ORDER BY created_at DESC`, [songId],
  )
  res.json({ plans: rows.map(rowToApi) })
})

// READ ONE
socialsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<PlanRow>(`SELECT * FROM social_plans WHERE id = $1`, [req.params.id])
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  res.json({ plan: rowToApi(rows[0]) })
})

// CREATE — kicks off generation for one episode based on its latest done
// transcript. Body: { songId }
socialsRouter.post('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = String(req.body?.songId || '')
  if (!songId) { res.status(400).json({ error: 'songId required' }); return }

  // Pull song + project + brand voice config
  const sRes = await pool.query<{
    project_id: string
    song_title: string
    song_subtitle: string | null
    project_name: string
    project_subtitle: string | null
    brand_voice: string | null
    example_posts: string[] | null
    default_assignees: Record<string, string> | null
    vocabulary: string | null
  }>(
    `SELECT s.project_id, s.title AS song_title, s.subtitle AS song_subtitle,
            p.name AS project_name, p.subtitle AS project_subtitle,
            p.socials_brand_voice AS brand_voice,
            p.socials_example_posts AS example_posts,
            p.socials_default_assignees AS default_assignees,
            p.socials_vocabulary AS vocabulary
       FROM songs s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [songId],
  )
  if (sRes.rows.length === 0) { res.status(404).json({ error: 'song_not_found' }); return }
  const ctx = sRes.rows[0]

  if (!await assertWriter(user, ctx.project_id, res)) return
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'socials_unavailable: ANTHROPIC_API_KEY not configured' }); return
  }

  // Pull the latest done transcript for this song
  const tRes = await pool.query<{
    id: string
    edited_blocks: Array<{ speaker: string; text: string; start: number; end: number }> | null
  }>(
    `SELECT id, edited_blocks
       FROM transcripts
      WHERE song_id = $1 AND status = 'done'
      ORDER BY created_at DESC LIMIT 1`,
    [songId],
  )
  if (tRes.rows.length === 0) {
    res.status(400).json({ error: 'no_done_transcript_for_episode' }); return
  }
  const transcript = tRes.rows[0]
  const transcriptText = (transcript.edited_blocks ?? [])
    .map((b) => `${b.speaker}: ${b.text}`)
    .join('\n\n')
    .slice(0, MAX_TRANSCRIPT_CHARS)
  if (transcriptText.length < 100) {
    res.status(400).json({ error: 'transcript_too_short' }); return
  }

  // Insert generating row, respond immediately
  const inserted = await pool.query<PlanRow>(
    `INSERT INTO social_plans (project_id, song_id, transcript_id, status, created_by)
     VALUES ($1, $2, $3, 'generating', $4) RETURNING *`,
    [ctx.project_id, songId, transcript.id, user.id],
  )
  const planId = inserted.rows[0].id
  res.json({ plan: rowToApi(inserted.rows[0]) })

  // Fire-and-forget Claude call
  ;(async () => {
    try {
      const examplePosts = Array.isArray(ctx.example_posts)
        ? ctx.example_posts.filter((e): e is string => typeof e === 'string')
        : []
      const result = await generateSocialPlan({
        showName: ctx.project_name,
        showSubtitle: ctx.project_subtitle,
        brandVoice: ctx.brand_voice ?? '',
        examplePosts,
        vocabulary: ctx.vocabulary ?? '',
        episodeTitle: ctx.song_title,
        episodeSubtitle: ctx.song_subtitle,
        episodeTranscript: transcriptText,
        date: new Date().toISOString().slice(0, 10),
      })
      const defaults = (ctx.default_assignees ?? {}) as Record<string, string>
      const items = rawPlanToItems(result.plan, defaults)
      await pool.query(
        `UPDATE social_plans
            SET status = 'generated',
                items = $2::jsonb,
                input_tokens = $3,
                output_tokens = $4,
                cache_read_tokens = $5,
                cache_create_tokens = $6,
                updated_at = now()
          WHERE id = $1`,
        [
          planId,
          JSON.stringify(items),
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.cacheReadInputTokens,
          result.usage.cacheCreationInputTokens,
        ],
      )
      logInfo('socials: plan done', {
        planId,
        items: items.length,
        cacheRead: result.usage.cacheReadInputTokens,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError('socials: generation failed', { planId, error: msg })
      await pool.query(
        `UPDATE social_plans SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [planId, msg],
      )
    }
  })()
})

// PATCH — update one item (status, text, etc.) inside a plan.
// Body: { itemId, patch: { status?, text?, hook?, talking_points?, suggested_clip?, image_direction?, caption?, vibe? } }
socialsRouter.patch('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<PlanRow>(`SELECT * FROM social_plans WHERE id = $1`, [req.params.id])
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, rows[0].project_id, res)) return

  const { itemId, patch } = req.body as { itemId?: string; patch?: Record<string, unknown> }
  if (!itemId || !patch) { res.status(400).json({ error: 'itemId and patch required' }); return }

  const items = rows[0].items
  const idx = items.findIndex((i) => i.id === itemId)
  if (idx < 0) { res.status(404).json({ error: 'item_not_found' }); return }

  // Whitelist editable fields per kind so the model output's shape stays intact.
  const item = items[idx]
  const allowed: Record<string, string[]> = {
    text_post: ['status', 'text'],
    story_concept: ['status', 'description', 'caption', 'suggested_clip', 'image_direction', 'medium', 'assignee_user_id'],
    reel_concept: ['status', 'hook', 'talking_points', 'suggested_clip', 'assignee_user_id'],
    photo_concept: ['status', 'image_direction', 'caption', 'vibe', 'assignee_user_id'],
  }
  const fields = allowed[item.kind] ?? ['status']
  const next: SocialItem = { ...item }
  for (const k of fields) {
    if (k in patch) (next as Record<string, unknown>)[k] = patch[k]
  }
  items[idx] = next

  await pool.query(
    `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
    [req.params.id, JSON.stringify(items)],
  )
  const updated = await pool.query<PlanRow>(`SELECT * FROM social_plans WHERE id = $1`, [req.params.id])
  res.json({ plan: rowToApi(updated.rows[0]) })
})

// TXT export — dumps all "selected" text posts as plain text the producer
// can save / paste into their scheduler. Falls back to all text posts when
// nothing has been explicitly selected yet.
socialsRouter.get('/:id/text-posts.txt', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<PlanRow>(`SELECT * FROM social_plans WHERE id = $1`, [req.params.id])
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const items = rows[0].items.filter((i): i is Extract<SocialItem, { kind: 'text_post' }> => i.kind === 'text_post')
  const selectedOnly = items.filter((i) => i.status === 'selected' || i.status === 'scheduled' || i.status === 'posted')
  const toExport = selectedOnly.length > 0 ? selectedOnly : items
  const body = toExport.map((i) => i.text).join('\n\n---\n\n')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="text-posts-${rows[0].id.slice(0, 8)}.txt"`)
  res.send(body)
})

// DELETE
socialsRouter.delete('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM social_plans WHERE id = $1`, [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, rows[0].project_id, res)) return
  await pool.query(`DELETE FROM social_plans WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})
