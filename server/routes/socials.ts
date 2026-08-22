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
import { hasAnthropicKey, generateSocialPlan, regenerateSocialItem, type RawSocialPlan, type StrategyDocsInput } from '../anthropic'
import { logError, logInfo } from '../diag'

export const socialsRouter = Router()
socialsRouter.use(requireUser)

const MAX_TRANSCRIPT_CHARS = 200_000

// Load the strategy docs Slate has generated for this show, packaged
// into the shape Claude's prompt block expects. Returns an empty
// object if nothing has been generated yet — the block is a no-op in
// that case, so generators keep working for shows that haven't done
// the strategy pass.
export async function loadShowStrategyDocs(projectId: string): Promise<StrategyDocsInput> {
  const { rows } = await pool.query<{ kind: string; content: Record<string, unknown> }>(
    `SELECT kind, content FROM social_strategy_documents
       WHERE project_id = $1 AND status = 'generated'
         AND kind IN ('strategy', 'audience', 'authority', 'pillars', 'monetization', 'winners')`,
    [projectId],
  )
  const out: StrategyDocsInput = {}
  for (const r of rows) {
    (out as Record<string, unknown>)[r.kind] = r.content
  }
  return out
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

// Internal-callable: same logic as the public POST handler, minus the
// Express layer. Returns the new plan id; throws on validation errors.
export async function triggerSocialPlanGeneration(args: {
  songId: string
  createdBy: string
}): Promise<string> {
  const sRes = await pool.query<{
    project_id: string
    song_title: string
    song_subtitle: string | null
    source_file_path: string | null
    project_name: string
    project_subtitle: string | null
    brand_voice: string | null
    example_posts: string[] | null
    default_assignees: Record<string, string> | null
    vocabulary: string | null
    brand_assets_folder: string | null
  }>(
    `SELECT s.project_id, s.title AS song_title, s.subtitle AS song_subtitle,
            s.source_file_path,
            p.name AS project_name, p.subtitle AS project_subtitle,
            p.socials_brand_voice AS brand_voice,
            p.socials_example_posts AS example_posts,
            p.socials_default_assignees AS default_assignees,
            p.socials_vocabulary AS vocabulary,
            p.brand_assets_folder AS brand_assets_folder
       FROM songs s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [args.songId],
  )
  if (sRes.rows.length === 0) throw new Error('song_not_found')
  const ctx = sRes.rows[0]
  if (!hasAnthropicKey()) throw new Error('socials_unavailable: ANTHROPIC_API_KEY not configured')

  // List any brand assets the team has curated in Dropbox so Claude
  // can reference real filenames instead of inventing shoot directions.
  // Failures here are non-fatal — Claude just gets an empty list and
  // proceeds with shoot-style image_direction values.
  let brandAssets: Array<{ name: string; dropboxPath: string }> = []
  if (ctx.brand_assets_folder) {
    try {
      const { listFolder } = await import('../dropbox')
      const r = await listFolder(ctx.brand_assets_folder)
      if (r.ok) {
        brandAssets = r.entries
          .filter((e) => e.type === 'file' && /\.(jpe?g|png|webp|gif|heic)$/i.test(e.name))
          .map((e) => ({ name: e.name, dropboxPath: e.path }))
      }
    } catch {
      // ignore — generate the plan without assets
    }
  }

  const tRes = await pool.query<{
    id: string
    edited_blocks: Array<{ speaker: string; text: string; start: number; end: number }> | null
  }>(
    `SELECT id, edited_blocks FROM transcripts
      WHERE song_id = $1 AND status = 'done'
      ORDER BY created_at DESC LIMIT 1`,
    [args.songId],
  )
  if (tRes.rows.length === 0) throw new Error('no_done_transcript_for_episode')
  const transcript = tRes.rows[0]
  const transcriptText = (transcript.edited_blocks ?? [])
    .map((b) => `[${fmtTimecode(b.start)}] ${b.speaker}: ${b.text}`)
    .join('\n\n')
    .slice(0, MAX_TRANSCRIPT_CHARS)
  if (transcriptText.length < 100) throw new Error('transcript_too_short')

  const inserted = await pool.query<PlanRow>(
    `INSERT INTO social_plans (project_id, song_id, transcript_id, status, created_by)
     VALUES ($1, $2, $3, 'generating', $4) RETURNING *`,
    [ctx.project_id, args.songId, transcript.id, args.createdBy],
  )
  const planId = inserted.rows[0].id

  // Fire-and-forget Claude call
  ;(async () => {
    try {
      const examplePosts = Array.isArray(ctx.example_posts)
        ? ctx.example_posts.filter((e): e is string => typeof e === 'string')
        : []
      // Pull the show's strategy docs so Claude aligns the plan with
      // the actual brand positioning, pillars, and audience psychology
      // instead of drifting into generic podcast promo territory.
      const strategyDocs = await loadShowStrategyDocs(ctx.project_id)
      const result = await generateSocialPlan({
        showName: ctx.project_name,
        showSubtitle: ctx.project_subtitle,
        brandVoice: ctx.brand_voice ?? '',
        examplePosts,
        vocabulary: ctx.vocabulary ?? '',
        brandAssets,
        strategyDocs,
        episodeTitle: ctx.song_title,
        episodeSubtitle: ctx.song_subtitle,
        episodeTranscript: transcriptText,
        date: new Date().toISOString().slice(0, 10),
      })
      const defaults = (ctx.default_assignees ?? {}) as Record<string, string>
      let items = rawPlanToItems(result.plan, defaults)

      // Save items first so the plan appears in the UI even if stills
      // extraction is slow / fails. We then attempt to attach stills,
      // and re-save items if any landed.
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
        [planId, JSON.stringify(items),
         result.usage.inputTokens, result.usage.outputTokens,
         result.usage.cacheReadInputTokens, result.usage.cacheCreationInputTokens],
      )
      logInfo('socials: plan done', { planId, items: items.length })

      // ----- Still + clip extraction -----
      // Pull frames + cut clips from the source MP4 for every item with
      // a [HH:MM:SS] timecode. Fire-and-forget: failures are logged but
      // never block plan use.
      //
      // Audio-only podcasts have no video stream to sample — skip the
      // entire ffmpeg pass with a single info log instead of letting
      // ffmpeg fail per-frame and spam the admin inbox.
      const isAudioOnlySource = (() => {
        const p = (ctx.source_file_path ?? '').toLowerCase()
        return /\.(mp3|wav|m4a|aac|flac|ogg|opus|aiff?|wma)$/.test(p)
      })()
      if (ctx.source_file_path && isAudioOnlySource) {
        logInfo('socials: audio-only source — skipping stills/clips', {
          planId, source: ctx.source_file_path,
        })
      }
      if (ctx.source_file_path && !isAudioOnlySource) {
        ;(async () => {
          try {
            const { extractStillsForItem, extractClipForItem, parseTimecode, parseTimecodeRange, isFfmpegAvailable, probeMediaStreams } = await import('../stills')
            if (!(await isFfmpegAvailable())) {
              logInfo('socials: skipping ffmpeg work (ffmpeg not available)', { planId })
              return
            }
            // Belt-and-suspenders for the audio-only case: even if the
            // extension didn't tell us (e.g. an MP4 that's actually
            // audio-only with album art baked in), ffprobe will. Skip
            // the ENTIRE stills/clips pass with one log line instead of
            // letting ffmpeg burn through every frame request and
            // generate a stack of admin alerts.
            const { getTemporaryLink } = await import('../dropbox')
            const link = await getTemporaryLink(ctx.source_file_path!)
            if (link.ok && link.url) {
              const probe = await probeMediaStreams(link.url)
              if (probe && !probe.hasVideo) {
                logInfo('socials: source has no video stream — skipping stills/clips', {
                  planId, source: ctx.source_file_path, probe,
                })
                return
              }
            }
            let touched = false
            for (let i = 0; i < items.length; i++) {
              const it = items[i]
              // Stills anchor — center timecode from suggested_clip
              // (story/reel) or image_direction (photo).
              const tc =
                it.kind === 'story_concept' || it.kind === 'reel_concept'
                  ? parseTimecode((it as { suggested_clip?: string }).suggested_clip)
                  : it.kind === 'photo_concept'
                    ? parseTimecode((it as { image_direction?: string }).image_direction)
                    : null
              if (tc != null) {
                try {
                  const stills = await extractStillsForItem({
                    videoDropboxPath: ctx.source_file_path!,
                    centerSeconds: tc,
                    songId: args.songId,
                    itemId: it.id,
                    version: 0,
                  })
                  if (stills.paths.length > 0) {
                    ;(items[i] as unknown as Record<string, unknown>).still_paths = stills.paths
                    ;(items[i] as unknown as Record<string, unknown>).still_center_s = stills.centerSeconds
                    ;(items[i] as unknown as Record<string, unknown>).still_window_s = stills.windowSeconds
                    ;(items[i] as unknown as Record<string, unknown>).still_version = stills.version
                    touched = true
                  }
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : String(err)
                  // Escalate permission errors to ERROR level so admins
                  // get notified to reconnect Dropbox. Other failures
                  // are recoverable and stay at INFO to avoid spam.
                  if (errMsg.includes('no_write_permission')) {
                    logError('socials: stills blocked by missing Dropbox permission', {
                      planId, itemId: it.id, error: errMsg,
                    })
                  } else {
                    logInfo('socials: stills for item skipped', {
                      planId, itemId: it.id, error: errMsg,
                    })
                  }
                }
              }
              // Video clip extraction — story (video medium) + reel
              // items get the actual mp4 cut at their [start - end] range.
              const isVideo =
                (it.kind === 'story_concept' && (it as { medium?: string }).medium === 'video') ||
                it.kind === 'reel_concept'
              if (isVideo) {
                const range = parseTimecodeRange((it as { suggested_clip?: string }).suggested_clip)
                if (range) {
                  try {
                    // Transcript blocks overlapping this clip → burned-in
                    // captions. Rendered as a framed 9:16 vertical.
                    const clipCaptions = (transcript.edited_blocks ?? [])
                      .filter((b) => b.end > range.startSeconds && b.start < range.endSeconds)
                      .map((b) => ({ startSeconds: b.start, endSeconds: b.end, text: b.text }))
                    const clip = await extractClipForItem({
                      videoDropboxPath: ctx.source_file_path!,
                      startSeconds: range.startSeconds,
                      endSeconds: range.endSeconds,
                      songId: args.songId,
                      itemId: it.id,
                      version: 0,
                      vertical: true,
                      captions: clipCaptions,
                    })
                    ;(items[i] as unknown as Record<string, unknown>).clip_dropbox_path = clip.dropboxPath
                    ;(items[i] as unknown as Record<string, unknown>).clip_duration_s = clip.durationSeconds
                    ;(items[i] as unknown as Record<string, unknown>).clip_start_s = range.startSeconds
                    ;(items[i] as unknown as Record<string, unknown>).clip_end_s = range.endSeconds
                    ;(items[i] as unknown as Record<string, unknown>).clip_version = clip.version
                    touched = true
                  } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err)
                    // Escalate permission errors to ERROR level so admins
                    // get notified to reconnect Dropbox. Other failures
                    // are recoverable and stay at INFO to avoid spam.
                    if (errMsg.includes('no_write_permission')) {
                      logError('socials: clip blocked by missing Dropbox permission', {
                        planId, itemId: it.id, error: errMsg,
                      })
                    } else {
                      logInfo('socials: clip for item skipped', {
                        planId, itemId: it.id, error: errMsg,
                      })
                    }
                  }
                }
              }
            }
            if (touched) {
              await pool.query(
                `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
                [planId, JSON.stringify(items)],
              )
              logInfo('socials: ffmpeg assets attached', { planId, items: items.length })
            }
          } catch (err) {
            logError('socials: ffmpeg batch failed', {
              planId, error: err instanceof Error ? err.message : String(err),
            })
          }
        })()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError('socials: generation failed', { planId, error: msg })
      await pool.query(
        `UPDATE social_plans SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [planId, msg],
      )
    }
  })()
  return planId
}

// CREATE — kicks off generation for one episode based on its latest done
// transcript. Body: { songId }
socialsRouter.post('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = String(req.body?.songId || '')
  if (!songId) { res.status(400).json({ error: 'songId required' }); return }
  // Auth pre-check — pull the project id so assertWriter can run.
  const pCheck = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM songs WHERE id = $1`, [songId],
  )
  if (pCheck.rows.length === 0) { res.status(404).json({ error: 'song_not_found' }); return }
  if (!await assertWriter(user, pCheck.rows[0].project_id, res)) return
  try {
    const planId = await triggerSocialPlanGeneration({ songId, createdBy: user.id })
    const { rows } = await pool.query<PlanRow>(`SELECT * FROM social_plans WHERE id = $1`, [planId])
    res.json({ plan: rowToApi(rows[0]) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('unavailable') ? 503 :
                   msg === 'song_not_found' ? 404 :
                   400
    res.status(status).json({ error: msg })
  }
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

// POST /:planId/regenerate-item — single-item replacement. One Claude
// call, one fresh alternative for the given itemId, swapped in-place
// so the rest of the plan stays.
// POST /:planId/regenerate-stills — pulls a fresh batch of 5 frames
// around the item's timecode, with the center shifted by shiftSeconds
// (so the user can nudge forward or back if Claude's pick was an
// awkward moment). Existing still_paths get overwritten.
socialsRouter.post('/:planId/regenerate-stills', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { itemId, shiftSeconds } = req.body as { itemId?: string; shiftSeconds?: number }
  if (!itemId) { res.status(400).json({ error: 'itemId required' }); return }

  const planRes = await pool.query<PlanRow & { source_file_path: string | null; song_id_actual: string }>(
    `SELECT sp.*, s.source_file_path, s.id AS song_id_actual
       FROM social_plans sp JOIN songs s ON s.id = sp.song_id
      WHERE sp.id = $1`,
    [req.params.planId],
  )
  if (planRes.rows.length === 0) { res.status(404).json({ error: 'plan_not_found' }); return }
  const plan = planRes.rows[0]
  if (!await assertWriter(user, plan.project_id, res)) return
  if (!plan.source_file_path) { res.status(400).json({ error: 'no_source_video' }); return }

  const items = plan.items
  const idx = items.findIndex((i) => i.id === itemId)
  if (idx < 0) { res.status(404).json({ error: 'item_not_found' }); return }
  const it = items[idx]

  // Pull existing center (set on first extraction) or re-parse from
  // the timecode string if this item never had stills before.
  const { extractStillsForItem, parseTimecode } = await import('../stills')
  const existing = it as unknown as { still_center_s?: number; still_version?: number }
  const baseCenter = typeof existing.still_center_s === 'number'
    ? existing.still_center_s
    : parseTimecode(
        it.kind === 'story_concept' || it.kind === 'reel_concept'
          ? (it as { suggested_clip?: string }).suggested_clip
          : it.kind === 'photo_concept'
            ? (it as { image_direction?: string }).image_direction
            : undefined,
      )
  if (baseCenter == null) {
    res.status(400).json({ error: 'no_timecode_to_anchor_stills' }); return
  }
  const shift = typeof shiftSeconds === 'number' ? shiftSeconds : 5
  const nextVersion = (existing.still_version ?? 0) + 1
  const nextCenter = Math.max(0, baseCenter + shift)

  try {
    const stills = await extractStillsForItem({
      videoDropboxPath: plan.source_file_path,
      centerSeconds: nextCenter,
      songId: plan.song_id_actual,
      itemId: it.id,
      version: nextVersion,
    })
    ;(items[idx] as unknown as Record<string, unknown>).still_paths = stills.paths
    ;(items[idx] as unknown as Record<string, unknown>).still_center_s = stills.centerSeconds
    ;(items[idx] as unknown as Record<string, unknown>).still_window_s = stills.windowSeconds
    ;(items[idx] as unknown as Record<string, unknown>).still_version = stills.version
    await pool.query(
      `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
      [plan.id, JSON.stringify(items)],
    )
    res.json({ ok: true, item: items[idx] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Return a more helpful status code for permission errors so the UI
    // can display a reconnect prompt instead of a generic "Bad Gateway".
    const status = msg.includes('no_write_permission') ? 403 : 502
    logError('socials: regenerate-stills failed', { planId: plan.id, itemId, error: msg })
    res.status(status).json({ error: msg.slice(0, 400) })
  }
})

socialsRouter.post('/:planId/regenerate-item', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { itemId } = req.body as { itemId?: string }
  if (!itemId) { res.status(400).json({ error: 'itemId required' }); return }

  const planRes = await pool.query<PlanRow & {
    project_name: string
    project_subtitle: string | null
    song_title: string
    brand_voice: string | null
    example_posts: string[] | null
    vocabulary: string | null
  }>(
    `SELECT sp.*, p.name AS project_name, p.subtitle AS project_subtitle,
            s.title AS song_title,
            p.socials_brand_voice AS brand_voice,
            p.socials_example_posts AS example_posts,
            p.socials_vocabulary AS vocabulary
       FROM social_plans sp
       JOIN projects p ON p.id = sp.project_id
       JOIN songs s ON s.id = sp.song_id
      WHERE sp.id = $1`,
    [req.params.planId],
  )
  if (planRes.rows.length === 0) { res.status(404).json({ error: 'plan_not_found' }); return }
  const plan = planRes.rows[0]
  if (!await assertWriter(user, plan.project_id, res)) return
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' }); return
  }

  const items = plan.items
  const idx = items.findIndex((i) => i.id === itemId)
  if (idx < 0) { res.status(404).json({ error: 'item_not_found' }); return }
  const existing = items[idx]

  // Pull the latest done transcript for context. Same flow as the full
  // plan generator so the regen has identical signal.
  const tRes = await pool.query<{
    edited_blocks: Array<{ speaker: string; text: string; start: number; end: number }> | null
  }>(
    `SELECT edited_blocks FROM transcripts
      WHERE song_id = $1 AND status = 'done'
      ORDER BY created_at DESC LIMIT 1`,
    [plan.song_id],
  )
  const transcriptText = (tRes.rows[0]?.edited_blocks ?? [])
    .map((b) => `[${fmtTimecode(b.start)}] ${b.speaker}: ${b.text}`)
    .join('\n\n')
    .slice(0, MAX_TRANSCRIPT_CHARS)

  // Build a verbatim string representation of the existing item so
  // Claude knows exactly what to NOT repeat.
  const existingStr = (() => {
    switch (existing.kind) {
      case 'text_post':     return existing.text || existing.ai_text
      case 'story_concept': return `medium: ${existing.medium}\ndescription: ${existing.description}\ncaption: ${existing.caption}\nsuggested_clip: ${existing.suggested_clip}\nimage_direction: ${existing.image_direction}`
      case 'reel_concept':  return `hook: ${existing.hook}\ntalking_points: ${existing.talking_points.join(' | ')}\nsuggested_clip: ${existing.suggested_clip}`
      case 'photo_concept': return `image_direction: ${existing.image_direction}\ncaption: ${existing.caption}\nvibe: ${existing.vibe}`
    }
  })()

  let result
  try {
    result = await regenerateSocialItem({
      kind: existing.kind,
      showName: plan.project_name,
      showSubtitle: plan.project_subtitle,
      brandVoice: plan.brand_voice ?? '',
      examplePosts: Array.isArray(plan.example_posts) ? plan.example_posts.filter((e): e is string => typeof e === 'string') : [],
      vocabulary: plan.vocabulary ?? '',
      episodeTitle: plan.song_title,
      episodeTranscript: transcriptText,
      existing: existingStr,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('socials: regen failed', { planId: plan.id, itemId, error: msg })
    res.status(502).json({ error: msg.slice(0, 400) }); return
  }

  // Splice the new content into the existing item, preserving id,
  // status, pushed_to_scheduler_at, assignee, etc.
  const fresh: SocialItem = (() => {
    switch (existing.kind) {
      case 'text_post': {
        const i = result.item as { text: string }
        return { ...existing, ai_text: i.text, text: i.text }
      }
      case 'story_concept': {
        const i = result.item as { medium: 'video' | 'photo'; description: string; caption: string; suggested_clip: string; image_direction: string }
        return { ...existing, ...i }
      }
      case 'reel_concept': {
        const i = result.item as { hook: string; talking_points: string[]; suggested_clip: string }
        return { ...existing, ...i }
      }
      case 'photo_concept': {
        const i = result.item as { image_direction: string; caption: string; vibe: string }
        return { ...existing, ...i }
      }
    }
  })()
  items[idx] = fresh

  await pool.query(
    `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
    [plan.id, JSON.stringify(items)],
  )
  res.json({ ok: true, item: fresh })
})

// ─────────────────────────────────────────────────────────────────────
// Autopilot admin endpoints
// ─────────────────────────────────────────────────────────────────────
// The daily loop itself lives in ../socials_autopilot and runs on the
// server clock. These endpoints let the admin fire a run on demand (to
// test, or to retry a failed morning) and inspect run history. The
// toggle + hour live on the project PATCH like the other socials config.

// POST /api/socials/autopilot/:projectId/run — admin-only, on demand.
// { force?: true } retries over a failed/stuck run; a completed run for
// today is never overwritten.
socialsRouter.post('/autopilot/:projectId/run', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (user.role !== 'admin') { res.status(403).json({ error: 'admin_only' }); return }
  if (!hasAnthropicKey()) { res.status(503).json({ error: 'anthropic_key_missing' }); return }
  const projectId = req.params.projectId
  const force = req.body?.force === true
  const { nowPTDate, runAutopilotForProject } = await import('../socials_autopilot')
  const result = await runAutopilotForProject(projectId, nowPTDate(), { force })
  if (!result.ok) { res.status(500).json({ error: 'run_failed', detail: result.skipped }); return }
  res.json({ ok: true, skipped: result.skipped ?? null, itemCount: result.itemCount ?? 0 })
})

// GET /api/socials/autopilot/:projectId/runs — recent run history.
socialsRouter.get('/autopilot/:projectId/runs', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query(
    `SELECT id, run_date::text, status, error, calendar_day,
            jsonb_array_length(item_ids) AS item_count,
            input_tokens, output_tokens, created_at
       FROM socials_autopilot_runs
      WHERE project_id = $1
      ORDER BY run_date DESC LIMIT 30`,
    [projectId],
  )
  res.json({ runs: rows })
})

// HH:MM:SS — used to anchor every Claude clip suggestion to a real
// timecode the editor or ffmpeg clip cutter can act on.
function fmtTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
