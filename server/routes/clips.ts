// Clip generation — Slate's own ffmpeg pipeline (OpusClip removed).
//
//   POST   /api/clips                  → generate clips for an episode
//   GET    /api/clips?songId=…         → list jobs (+ their clips)
//   GET    /api/clips/:id              → one job + its clips
//   GET    /api/clips/clip/:clipId/link → fresh Dropbox link to play/DL
//   DELETE /api/clips/:id              → remove a job
//
// A "job" is one generation run: Claude picks the moments from the
// episode transcript, ffmpeg cuts each as a framed 9:16 vertical with
// burned captions, and each clip is stored as a Dropbox file. No
// external clip service, no polling.
import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { getFileMetadata, getTemporaryLink } from '../dropbox'
import { pickClipMoments } from '../anthropic'
import { logError, logInfo } from '../diag'

export const clipsRouter = Router()
clipsRouter.use(requireUser)

// Selection hints the operator can pass. Claude picks natural in/out
// points from the transcript; these just steer it.
export type ClipOptions = {
  prompt?: string | null
  clipCount?: number | null
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

type ClipJobRow = {
  id: string
  project_id: string
  song_id: string | null
  dropbox_path: string
  file_name: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  options: ClipOptions | null
  error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type CaptionLine = { startSeconds: number; endSeconds: number; text: string }

type ClipRow = {
  id: string
  job_id: string
  title: string | null
  duration_seconds: string | null
  start_seconds: string | null
  end_seconds: string | null
  dropbox_path: string | null
  vertical: boolean | null
  captioned: boolean | null
  captions: CaptionLine[] | null
}

function jobToApi(row: ClipJobRow, clips: ClipRow[] = []) {
  return {
    id: row.id,
    projectId: row.project_id,
    songId: row.song_id,
    dropboxPath: row.dropbox_path,
    fileName: row.file_name,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    options: row.options,
    clips: clips.map((c) => ({
      id: c.id,
      title: c.title,
      durationSeconds: c.duration_seconds ? Number(c.duration_seconds) : null,
      startSeconds: c.start_seconds ? Number(c.start_seconds) : null,
      endSeconds: c.end_seconds ? Number(c.end_seconds) : null,
      dropboxPath: c.dropbox_path,
      vertical: c.vertical ?? false,
      captioned: c.captioned ?? false,
      captions: c.captions ?? [],
    })),
  }
}

async function loadClips(jobId: string): Promise<ClipRow[]> {
  const { rows } = await pool.query<ClipRow>(
    `SELECT id, job_id, title, duration_seconds, start_seconds, end_seconds,
            dropbox_path, vertical, captioned, captions
       FROM clips WHERE job_id = $1 AND dropbox_path IS NOT NULL
      ORDER BY created_at ASC`,
    [jobId],
  )
  return rows
}

// The whole generation run for one episode. Loads the transcript, has
// Claude pick moments, cuts each with ffmpeg (vertical + captions), and
// records the results. Runs in the background off the initial insert.
async function runClipJob(jobId: string, songId: string, sourceDropboxPath: string): Promise<void> {
  try {
    // Need the episode's transcript both to pick moments and to caption.
    const tRes = await pool.query<{
      edited_blocks: Array<{ speaker: string; text: string; start: number; end: number }> | null
    }>(
      `SELECT edited_blocks FROM transcripts
        WHERE song_id = $1 AND status = 'done'
        ORDER BY created_at DESC LIMIT 1`,
      [songId],
    )
    const blocks = tRes.rows[0]?.edited_blocks ?? null
    if (!blocks || blocks.length === 0) {
      throw new Error('no_transcript: transcribe this episode first, then generate clips')
    }

    const jobRes = await pool.query<{ options: ClipOptions | null }>(
      `SELECT options FROM clip_jobs WHERE id = $1`, [jobId],
    )
    const options = jobRes.rows[0]?.options ?? null
    // Pull the show's description / notes + voice so selection is "based
    // on the show" — what THIS audience cares about, not generic
    // virality. All from data already on the show record; nothing to
    // fill in by hand.
    const showRes = await pool.query<{
      name: string
      subtitle: string | null
      notable_topics: string | null
      socials_brand_voice: string | null
      socials_vocabulary: string | null
      business_description: string | null
      niche: string | null
      target_audience: string | null
    }>(
      `SELECT p.name, p.subtitle, p.notable_topics,
              p.socials_brand_voice, p.socials_vocabulary,
              b.business_description, b.niche, b.target_audience
         FROM projects p
         JOIN songs s ON s.project_id = p.id
         LEFT JOIN social_strategy_briefs b ON b.project_id = p.id
        WHERE s.id = $1`,
      [songId],
    )
    const show = showRes.rows[0]
    const showName = show?.name ?? 'the show'
    // Stitch together whatever description the show already has.
    const showDescription = [
      show?.subtitle && `Description: ${show.subtitle}`,
      show?.business_description && `What the show is: ${show.business_description}`,
      show?.niche && `Niche: ${show.niche}`,
      show?.target_audience && `Audience: ${show.target_audience}`,
      show?.notable_topics && `Recurring topics: ${show.notable_topics}`,
    ].filter(Boolean).join('\n')

    const fmt = (s: number) => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
      const p2 = (n: number) => String(n).padStart(2, '0')
      return `${p2(h)}:${p2(m)}:${p2(sec)}`
    }
    const transcript = blocks
      .map((b) => `[${fmt(b.start)}] ${b.speaker}: ${b.text}`)
      .join('\n')
      .slice(0, 120_000)

    const moments = await pickClipMoments({
      showName,
      transcript,
      focus: options?.prompt ?? null,
      count: options?.clipCount ?? null,
      showDescription: showDescription || null,
      brandVoice: show?.socials_brand_voice ?? null,
      vocabulary: show?.socials_vocabulary ?? null,
    })
    if (moments.length === 0) throw new Error('no_moments_selected')
    logInfo('clip job: moments picked', { jobId, count: moments.length })

    const { extractEditableClip, chunkCaptions } = await import('../stills')
    let made = 0
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i]
      try {
        // Chunk the transcript blocks into the ~6-word lines that show on
        // screen, so the stored captions match what's rendered/editable.
        const blocksInRange = blocks
          .filter((b) => b.end > m.startSeconds && b.start < m.endSeconds)
          .map((b) => ({ startSeconds: b.start, endSeconds: b.end, text: b.text }))
        const captions = chunkCaptions(blocksInRange, m.startSeconds, m.endSeconds - m.startSeconds)
        const clip = await extractEditableClip({
          videoDropboxPath: sourceDropboxPath,
          startSeconds: m.startSeconds,
          endSeconds: m.endSeconds,
          songId,
          itemId: `${jobId}-${i}`,
          version: 0,
          captions,
        })
        await pool.query(
          `INSERT INTO clips (job_id, title, duration_seconds, start_seconds, end_seconds,
                              dropbox_path, clean_dropbox_path, captions, render_version,
                              vertical, captioned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 0, $9, $10)`,
          [jobId, m.title, clip.durationSeconds, m.startSeconds, m.endSeconds,
           clip.dropboxPath, clip.cleanDropboxPath, JSON.stringify(captions),
           clip.vertical, clip.captioned],
        )
        made++
      } catch (err) {
        // One bad moment shouldn't sink the whole job.
        logError('clip job: one clip failed', {
          jobId, index: i, error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (made === 0) throw new Error('all_clips_failed')

    await pool.query(
      `UPDATE clip_jobs SET status = 'done', updated_at = now() WHERE id = $1`, [jobId],
    )
    logInfo('clip job: done', { jobId, made, of: moments.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('clip job: failed', { jobId, error: msg })
    await pool.query(
      `UPDATE clip_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [jobId, msg.slice(0, 500)],
    )
  }
}

// Internal-callable: used by the podcast upload-and-go auto-pipeline.
export async function triggerClipJob(args: {
  projectId: string
  songId: string | null
  dropboxPath: string
  createdBy: string
  options?: ClipOptions | null
}): Promise<string> {
  if (!args.songId) throw new Error('clips_need_song: clip generation is per-episode')
  const meta = await getFileMetadata(args.dropboxPath)
  const fileName = meta.ok ? (meta.name ?? args.dropboxPath) : args.dropboxPath

  const cleanOpts: ClipOptions | null = args.options ? {
    prompt: typeof args.options.prompt === 'string' && args.options.prompt.trim()
      ? args.options.prompt.trim().slice(0, 2000) : null,
    clipCount: typeof args.options.clipCount === 'number' && args.options.clipCount > 0 && args.options.clipCount <= 20
      ? Math.round(args.options.clipCount) : null,
  } : null

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO clip_jobs (project_id, song_id, dropbox_path, file_name, status, options, created_by)
     VALUES ($1, $2, $3, $4, 'processing', $5::jsonb, $6)
     RETURNING id`,
    [args.projectId, args.songId, args.dropboxPath, fileName,
     cleanOpts ? JSON.stringify(cleanOpts) : null, args.createdBy],
  )
  const jobId = inserted.rows[0].id
  // Fire and forget — the episode page polls the job to 'done'.
  void runClipJob(jobId, args.songId, args.dropboxPath)
  return jobId
}

// LIST jobs for a song (or project)
clipsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const songId = String(req.query.songId || '')
  const projectIdQ = String(req.query.projectId || '')
  if (!songId && !projectIdQ) {
    res.status(400).json({ error: 'songId or projectId required' }); return
  }
  let projectId = projectIdQ
  if (!projectId && songId) {
    const r = await pool.query<{ project_id: string }>(
      `SELECT project_id FROM songs WHERE id = $1`, [songId],
    )
    if (r.rows.length === 0) { res.status(404).json({ error: 'song_not_found' }); return }
    projectId = r.rows[0].project_id
  }
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows: jobs } = await pool.query<ClipJobRow>(
    songId
      ? `SELECT * FROM clip_jobs WHERE song_id = $1 ORDER BY created_at DESC`
      : `SELECT * FROM clip_jobs WHERE project_id = $1 ORDER BY created_at DESC`,
    [songId || projectId],
  )
  const withClips = await Promise.all(
    jobs.map(async (j) => jobToApi(j, j.status === 'done' ? await loadClips(j.id) : [])),
  )
  res.json({ jobs: withClips })
})

// FRESH PLAYBACK/DOWNLOAD LINK for one clip. Dropbox temp links expire
// (~4h), so the UI asks for one on demand rather than us storing a
// stale URL. Three-segment path so it never collides with GET /:id.
clipsRouter.get('/clip/:clipId/link', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<{ dropbox_path: string | null; project_id: string }>(
    `SELECT c.dropbox_path, j.project_id
       FROM clips c JOIN clip_jobs j ON j.id = c.job_id
      WHERE c.id = $1`,
    [req.params.clipId],
  )
  if (rows.length === 0 || !rows[0].dropbox_path) { res.status(404).json({ error: 'clip_not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const link = await getTemporaryLink(rows[0].dropbox_path)
  if (!link.ok || !link.url) { res.status(502).json({ error: link.error || 'link_failed' }); return }
  res.json({ url: link.url })
})

// EDIT CAPTIONS — fix a misspelled name, etc. Re-burns the corrected
// text onto the stored clean (caption-free) clip; no re-cut from source.
clipsRouter.patch('/clip/:clipId/captions', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<{
    id: string; job_id: string; project_id: string; song_id: string | null
    clean_dropbox_path: string | null
    start_seconds: string | null; end_seconds: string | null; render_version: number
  }>(
    `SELECT c.id, c.job_id, j.project_id, j.song_id, c.clean_dropbox_path,
            c.start_seconds, c.end_seconds, c.render_version
       FROM clips c JOIN clip_jobs j ON j.id = c.job_id WHERE c.id = $1`,
    [req.params.clipId],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'clip_not_found' }); return }
  const c = rows[0]
  if (!await assertWriter(user, c.project_id, res)) return
  if (!c.clean_dropbox_path) {
    res.status(400).json({ error: 'not_editable', detail: 'This clip predates editable captions — regenerate clips to enable editing.' })
    return
  }
  // Validate the edited caption lines. Timings stay; only text changes,
  // but we accept the whole array back from the client for simplicity.
  const raw = req.body?.captions
  if (!Array.isArray(raw)) { res.status(400).json({ error: 'captions_required' }); return }
  const captions: CaptionLine[] = []
  for (const r of raw.slice(0, 300)) {
    const rr = (r ?? {}) as Record<string, unknown>
    const s = Number(rr.startSeconds), e = Number(rr.endSeconds)
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue
    captions.push({ startSeconds: s, endSeconds: e, text: typeof rr.text === 'string' ? rr.text.slice(0, 500) : '' })
  }

  const start = Number(c.start_seconds ?? 0)
  const end = Number(c.end_seconds ?? 0)
  const duration = end > start ? end - start : 60
  const newVersion = (c.render_version ?? 0) + 1
  try {
    const { reburnClipCaptions } = await import('../stills')
    const r = await reburnClipCaptions({
      cleanDropboxPath: c.clean_dropbox_path,
      captions,
      clipStartSeconds: start,
      clipDurationSeconds: duration,
      songId: c.song_id ?? 'unknown',
      itemId: c.id,
      version: newVersion,
    })
    await pool.query(
      `UPDATE clips SET dropbox_path = $2, captions = $3::jsonb, render_version = $4, captioned = TRUE WHERE id = $1`,
      [c.id, r.dropboxPath, JSON.stringify(captions), newVersion],
    )
    const upd = await pool.query<ClipRow>(
      `SELECT id, job_id, title, duration_seconds, start_seconds, end_seconds,
              dropbox_path, vertical, captioned, captions FROM clips WHERE id = $1`,
      [c.id],
    )
    const u = upd.rows[0]
    res.json({
      clip: {
        id: u.id,
        title: u.title,
        durationSeconds: u.duration_seconds ? Number(u.duration_seconds) : null,
        startSeconds: u.start_seconds ? Number(u.start_seconds) : null,
        endSeconds: u.end_seconds ? Number(u.end_seconds) : null,
        dropboxPath: u.dropbox_path,
        vertical: u.vertical ?? false,
        captioned: u.captioned ?? false,
        captions: u.captions ?? [],
      },
    })
  } catch (err) {
    logError('clip: caption re-burn failed', { clipId: c.id, error: err instanceof Error ? err.message : String(err) })
    res.status(502).json({ error: err instanceof Error ? err.message.slice(0, 300) : 'reburn_failed' })
  }
})

// READ ONE
clipsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<ClipJobRow>(`SELECT * FROM clip_jobs WHERE id = $1`, [req.params.id])
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const clips = rows[0].status === 'done' ? await loadClips(rows[0].id) : []
  res.json({ job: jobToApi(rows[0], clips) })
})

// CREATE — generate clips for an episode.
clipsRouter.post('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { projectId, songId, dropboxPath, options } = req.body as {
    projectId?: string
    songId?: string | null
    dropboxPath?: string
    options?: ClipOptions
  }
  if (!projectId || !dropboxPath || !songId) {
    res.status(400).json({ error: 'projectId, songId and dropboxPath required' }); return
  }
  if (!await assertWriter(user, projectId, res)) return
  try {
    const jobId = await triggerClipJob({ projectId, songId, dropboxPath, createdBy: user.id, options })
    const { rows } = await pool.query<ClipJobRow>(`SELECT * FROM clip_jobs WHERE id = $1`, [jobId])
    res.json({ job: jobToApi(rows[0]) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

// DELETE
clipsRouter.delete('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM clip_jobs WHERE id = $1`, [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  await pool.query(`DELETE FROM clip_jobs WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})
