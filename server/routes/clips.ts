// Clip-job REST endpoints. Phase-1 polling architecture:
//
//   POST   /api/clips                   → kick off a clip-generation job
//   GET    /api/clips?songId=…          → list jobs for an episode (with
//                                         opportunistic refresh of any
//                                         processing jobs)
//   GET    /api/clips/:id               → one job + its clips (also
//                                         opportunistically refreshes)
//   DELETE /api/clips/:id               → remove
//
// Webhooks (Phase 2) will eventually replace the opportunistic polling.
import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { getFileMetadata, getTemporaryLink } from '../dropbox'
import { hasOpusKey, createOpusProject, fetchOpusClips, fetchOpusAccountInfo, exportOpusClip, type OpusClip, type OpusCreateOptions } from '../opusclip'
import { logError, logInfo } from '../diag'

export const clipsRouter = Router()
clipsRouter.use(requireUser)

const MAX_FILE_BYTES = 30 * 1024 * 1024 * 1024 // 30 GB per OpusClip spec

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
  opus_project_id: string | null
  opus_org_id: string | null
  options: { prompt?: string | null; clipCount?: number | null; minDuration?: number | null; maxDuration?: number | null } | null
  error: string | null
  last_polled_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type ClipRow = {
  id: string
  job_id: string
  opus_clip_id: string | null
  title: string | null
  duration_seconds: string | null
  preview_url: string | null
  download_url: string | null
  thumbnail_url: string | null
  score: string | null
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
    // Exposing the OpusClip project id lets the UI show an "Open in
    // OpusClip" link as an escape hatch while in-app previews aren't
    // reliable.
    opusProjectId: row.opus_project_id,
    options: row.options,
    clips: clips.map((c) => ({
      id: c.id,
      title: c.title,
      durationSeconds: c.duration_seconds ? Number(c.duration_seconds) : null,
      previewUrl: c.preview_url,
      downloadUrl: c.download_url,
      thumbnailUrl: c.thumbnail_url,
      score: c.score ? Number(c.score) : null,
    })),
  }
}

// Opportunistic poll: if a job is still processing, hit OpusClip and
// update DB. Cap polls to once every 20s per job so a hot GET endpoint
// doesn't spam OpusClip into rate-limiting us (30 req/min).
async function maybeRefreshJob(job: ClipJobRow): Promise<ClipJobRow> {
  if (job.status === 'done' || job.status === 'failed') return job
  if (!job.opus_project_id) return job
  if (!hasOpusKey()) return job
  if (job.last_polled_at) {
    const since = Date.now() - new Date(job.last_polled_at).getTime()
    if (since < 20_000) return job
  }
  try {
    const result = await fetchOpusClips(job.opus_project_id, job.opus_org_id)
    // Stash the raw response on every poll so the admin inspector can
    // see exactly what OpusClip returned the last time we asked.
    await pool.query(
      `UPDATE clip_jobs SET last_polled_at = now(), raw_poll_response = $2::jsonb WHERE id = $1`,
      [job.id, JSON.stringify(result.raw)],
    )
    if (result.ready) {
      // Insert/upsert clips, then mark job done
      for (const c of result.clips) {
        await upsertClip(job.id, c)
      }
      const updated = await pool.query<ClipJobRow>(
        `UPDATE clip_jobs SET status = 'done', updated_at = now() WHERE id = $1 RETURNING *`,
        [job.id],
      )
      logInfo('clip job: done', { id: job.id, clipCount: result.clips.length })
      return updated.rows[0]
    }
  } catch (err) {
    logError('clip job: poll failed', { id: job.id, error: err instanceof Error ? err.message : String(err) })
  }
  return job
}

async function upsertClip(jobId: string, c: OpusClip): Promise<void> {
  if (!c.id) return
  await pool.query(
    `INSERT INTO clips (job_id, opus_clip_id, title, duration_seconds,
                        preview_url, download_url, thumbnail_url, score, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      jobId,
      c.id,
      c.title,
      c.durationSeconds,
      c.previewUrl,
      c.downloadUrl,
      c.thumbnailUrl,
      c.score,
      JSON.stringify(c.raw),
    ],
  )
}

async function loadClips(jobId: string): Promise<ClipRow[]> {
  const { rows } = await pool.query<ClipRow>(
    `SELECT * FROM clips WHERE job_id = $1 ORDER BY score DESC NULLS LAST, created_at ASC`,
    [jobId],
  )
  return rows
}

// LIST jobs for a song
// GET /api/clips/account — must come BEFORE /:id (otherwise the
// dynamic-id route matches /account and tries to look up a clip job
// with id "account", which fails).
clipsRouter.get('/account', async (_req, res) => {
  if (!hasOpusKey()) { res.status(503).json({ error: 'OPUSCLIP_API_KEY not configured' }); return }
  const info = await fetchOpusAccountInfo()
  if (!info) {
    res.json({ available: false })
    return
  }
  res.json({
    available: true,
    endpoint: info.endpoint,
    planName: info.planName,
    creditsRemaining: info.creditsRemaining,
    creditsTotal: info.creditsTotal,
    minutesRemaining: info.minutesRemaining,
    minutesTotal: info.minutesTotal,
  })
})

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
  // Opportunistic refresh on processing jobs
  const refreshed = await Promise.all(jobs.map((j) => maybeRefreshJob(j)))
  const withClips = await Promise.all(
    refreshed.map(async (j) => jobToApi(j, j.status === 'done' ? await loadClips(j.id) : [])),
  )
  res.json({ jobs: withClips })
})

// READ ONE
clipsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<ClipJobRow>(`SELECT * FROM clip_jobs WHERE id = $1`, [req.params.id])
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const refreshed = await maybeRefreshJob(rows[0])
  const clips = refreshed.status === 'done' ? await loadClips(refreshed.id) : []
  res.json({ job: jobToApi(refreshed, clips) })
})

// Internal-callable: same core as the public POST handler. Used by
// the podcast upload-and-go auto-pipeline.
export async function triggerClipJob(args: {
  projectId: string
  songId: string | null
  dropboxPath: string
  createdBy: string
  options?: OpusCreateOptions | null
}): Promise<string> {
  if (!hasOpusKey()) throw new Error('clips_unavailable: OPUSCLIP_API_KEY not configured')
  const meta = await getFileMetadata(args.dropboxPath)
  if (!meta.ok) throw new Error(meta.error || 'dropbox_metadata_failed')
  if (meta.size && meta.size > MAX_FILE_BYTES) {
    throw new Error(`file_too_large: ${(meta.size / 1024 / 1024 / 1024).toFixed(2)}GB exceeds 30GB`)
  }
  const cleanOpts: OpusCreateOptions | null = args.options ? {
    prompt: typeof args.options.prompt === 'string' && args.options.prompt.trim() ? args.options.prompt.trim().slice(0, 1000) : null,
    clipCount: typeof args.options.clipCount === 'number' && args.options.clipCount > 0 && args.options.clipCount <= 50 ? Math.round(args.options.clipCount) : null,
    minDuration: typeof args.options.minDuration === 'number' && args.options.minDuration > 0 ? Math.round(args.options.minDuration) : null,
    maxDuration: typeof args.options.maxDuration === 'number' && args.options.maxDuration > 0 ? Math.round(args.options.maxDuration) : null,
  } : null

  const inserted = await pool.query<ClipJobRow>(
    `INSERT INTO clip_jobs (project_id, song_id, dropbox_path, file_name, status, options, created_by)
     VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6)
     RETURNING *`,
    [args.projectId, args.songId, args.dropboxPath, meta.name ?? args.dropboxPath, cleanOpts ? JSON.stringify(cleanOpts) : null, args.createdBy],
  )
  const jobId = inserted.rows[0].id

  ;(async () => {
    try {
      const link = await getTemporaryLink(args.dropboxPath)
      if (!link.ok || !link.url) throw new Error(link.error || 'temporary_link_failed')
      const opus = await createOpusProject(link.url, cleanOpts ?? undefined)
      await pool.query(
        `UPDATE clip_jobs SET status = 'processing',
                              opus_project_id = $2,
                              opus_org_id = $3,
                              raw_create_response = $4::jsonb,
                              updated_at = now()
         WHERE id = $1`,
        [jobId, opus.projectId, opus.orgId, JSON.stringify(opus.raw)],
      )
      logInfo('clip job: submitted', { id: jobId, opusProjectId: opus.projectId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError('clip job: submit failed', { id: jobId, error: msg })
      await pool.query(
        `UPDATE clip_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [jobId, msg],
      )
    }
  })()
  return jobId
}

// CREATE
clipsRouter.post('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { projectId, songId, dropboxPath, options } = req.body as {
    projectId?: string
    songId?: string | null
    dropboxPath?: string
    options?: OpusCreateOptions
  }
  if (!projectId || !dropboxPath) {
    res.status(400).json({ error: 'projectId and dropboxPath required' }); return
  }
  if (!await assertWriter(user, projectId, res)) return
  try {
    const jobId = await triggerClipJob({
      projectId,
      songId: songId ?? null,
      dropboxPath,
      createdBy: user.id,
      options,
    })
    const { rows } = await pool.query<ClipJobRow>(`SELECT * FROM clip_jobs WHERE id = $1`, [jobId])
    res.json({ job: jobToApi(rows[0]) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.startsWith('file_too_large') ? 413 : msg.includes('unavailable') ? 503 : 400
    res.status(status).json({ error: msg })
    return
  }
})

// GET /api/clips/:id/raw — admin/writer only inspector. Returns the
// raw OpusClip create + poll responses so we can refine the parser.
clipsRouter.get('/:id/raw', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<{
    project_id: string
    raw_create_response: unknown
    raw_poll_response: unknown
  }>(
    `SELECT project_id, raw_create_response, raw_poll_response FROM clip_jobs WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, rows[0].project_id, res)) return
  res.json({
    createResponse: rows[0].raw_create_response,
    pollResponse: rows[0].raw_poll_response,
  })
})

// POST /api/clips/clips/:clipId/render — asks OpusClip to actually
// render the MP4 for a single clip (their /exportable-clips endpoint
// returns metadata only; the playable URL requires a separate render
// call). Probes a handful of candidate endpoints in opusclip.ts since
// their API isn't publicly documented for this; first 2xx wins.
//
// On success: persists the harvested URLs onto the clip row and
// returns them; UI re-renders with a playable video.
clipsRouter.post('/clips/:clipId/render', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const clipRes = await pool.query<{
    id: string
    job_id: string
    opus_clip_id: string | null
    project_id: string
    opus_project_id: string | null
    opus_org_id: string | null
  }>(
    `SELECT c.id, c.job_id, c.opus_clip_id,
            j.project_id, j.opus_project_id, j.opus_org_id
       FROM clips c JOIN clip_jobs j ON j.id = c.job_id
      WHERE c.id = $1`,
    [req.params.clipId],
  )
  if (clipRes.rows.length === 0) { res.status(404).json({ error: 'clip_not_found' }); return }
  const c = clipRes.rows[0]
  if (!await assertWriter(user, c.project_id, res)) return
  if (!hasOpusKey()) { res.status(503).json({ error: 'OPUSCLIP_API_KEY not configured' }); return }
  if (!c.opus_clip_id || !c.opus_project_id) {
    res.status(400).json({ error: 'clip_missing_opus_ids' }); return
  }

  try {
    const result = await exportOpusClip({
      clipId: c.opus_clip_id,
      projectId: c.opus_project_id,
      orgId: c.opus_org_id,
    })
    if (result.videoUrl || result.thumbnailUrl) {
      await pool.query(
        `UPDATE clips
            SET preview_url = COALESCE(preview_url, $2),
                download_url = COALESCE(download_url, $3),
                thumbnail_url = COALESCE(thumbnail_url, $4)
          WHERE id = $1`,
        [c.id, result.videoUrl, result.downloadUrl, result.thumbnailUrl],
      )
    }
    res.json({
      ok: true,
      endpoint: result.endpoint,
      videoUrl: result.videoUrl,
      downloadUrl: result.downloadUrl,
      thumbnailUrl: result.thumbnailUrl,
      raw: result.raw,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('clip render failed', { clipId: c.id, error: msg })
    res.status(502).json({ error: msg.slice(0, 600) })
  }
})

// DELETE
clipsRouter.delete('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<ClipJobRow>(
    `SELECT project_id FROM clip_jobs WHERE id = $1`, [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  await pool.query(`DELETE FROM clip_jobs WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})
