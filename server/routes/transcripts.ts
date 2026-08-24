// Transcript REST endpoints.
//
//   POST   /api/transcripts                 → start a new transcription
//   GET    /api/transcripts?projectId=…     → list for a project
//   GET    /api/transcripts/:id             → single (with edited_blocks)
//   PATCH  /api/transcripts/:id             → save edits / settings
//   DELETE /api/transcripts/:id             → remove
//   GET    /api/transcripts/:id/srt         → export SRT
//
// Phase 1: synchronous Deepgram call from the POST route (Deepgram's
// pre-recorded API blocks until the result is ready, typically <2 min for
// a 1-hour file). Status flips queued → transcribing → done|failed in one
// request. A future phase can move this to a background worker if we want
// to free up the HTTP connection.
import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { getFileMetadata, getTemporaryLink } from '../dropbox'
import { hasDeepgramKey, paragraphsToBlocks, transcribeUrl, type EditedBlock } from '../deepgram'
import { hasAnthropicKey, correctTranscript } from '../anthropic'
import { logError, logInfo } from '../diag'

export const transcriptsRouter = Router()
transcriptsRouter.use(requireUser)

const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB — Deepgram bills by

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

type TranscriptRow = {
  id: string
  project_id: string
  song_id: string | null
  dropbox_path: string
  file_name: string
  file_size_bytes: string | null
  duration_seconds: string | null
  status: 'queued' | 'transcribing' | 'done' | 'failed'
  deepgram_request_id: string | null
  language: string
  raw_json: unknown
  edited_blocks: EditedBlock[] | null
  start_offset_ms: number
  frame_rate: string
  drop_frame: boolean
  error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function rowToApi(row: TranscriptRow, includeBlocks = false) {
  const out: Record<string, unknown> = {
    id: row.id,
    projectId: row.project_id,
    songId: row.song_id,
    dropboxPath: row.dropbox_path,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : null,
    status: row.status,
    language: row.language,
    startOffsetMs: row.start_offset_ms,
    frameRate: Number(row.frame_rate),
    dropFrame: row.drop_frame,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (includeBlocks) out.editedBlocks = row.edited_blocks ?? []
  return out
}

// LIST
transcriptsRouter.get('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = String(req.query.projectId || '')
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' }); return
  }
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  )
  res.json({ transcripts: rows.map((r) => rowToApi(r)) })
})

// READ ONE
transcriptsRouter.get('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  res.json({ transcript: rowToApi(rows[0], true) })
})

// Shared core: creates a transcript row, kicks off Deepgram, and on
// success / failure updates the row. Returns the inserted id. Used by
// both the public POST endpoint and the podcast upload-and-go pipeline
// in projects.ts.
//
// chainAutopipeline=true wires the post-transcript chain that flips
// the parent song through processing → ready, triggers the social
// plan, and (for video) starts a clip job.
export async function createInternalTranscriptJob(args: {
  projectId: string
  songId: string | null
  dropboxPath: string
  createdBy: string
  language?: string
  chainAutopipeline?: boolean
}): Promise<string> {
  if (!hasDeepgramKey()) throw new Error('transcription_unavailable: DEEPGRAM_API_KEY not configured')
  const meta = await getFileMetadata(args.dropboxPath)
  if (!meta.ok) throw new Error(meta.error || 'dropbox_metadata_failed')
  if (meta.size && meta.size > MAX_FILE_BYTES) {
    throw new Error(`file_too_large: ${(meta.size / 1024 / 1024 / 1024).toFixed(2)}GB exceeds 10GB cap`)
  }
  const inserted = await pool.query<TranscriptRow>(
    `INSERT INTO transcripts (project_id, song_id, dropbox_path, file_name, file_size_bytes, language, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'transcribing', $7)
     RETURNING *`,
    [args.projectId, args.songId, args.dropboxPath, meta.name ?? args.dropboxPath, meta.size ?? null, args.language ?? 'en', args.createdBy],
  )
  const id = inserted.rows[0].id

  // Fire-and-forget background work.
  ;(async () => {
    try {
      const link = await getTemporaryLink(args.dropboxPath)
      if (!link.ok || !link.url) throw new Error(link.error || 'temporary_link_failed')
      const result = await transcribeUrl(link.url, args.language ?? 'en')
      const blocks = paragraphsToBlocks(result)
      await pool.query(
        `UPDATE transcripts
         SET status = 'done',
             raw_json = $2::jsonb,
             edited_blocks = $3::jsonb,
             deepgram_request_id = $4,
             duration_seconds = $5,
             updated_at = now()
         WHERE id = $1`,
        [id, JSON.stringify(result), JSON.stringify(blocks), result.request_id ?? null, result.duration_seconds ?? null],
      )
      logInfo('transcript: done', { id, duration: result.duration_seconds, blocks: blocks.length })

      if (args.chainAutopipeline && args.songId) {
        await runPostTranscriptAutopipeline({
          projectId: args.projectId,
          songId: args.songId,
          dropboxPath: args.dropboxPath,
          createdBy: args.createdBy,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError('transcript: failed', { id, error: msg })
      await pool.query(
        `UPDATE transcripts SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [id, msg],
      )
      if (args.chainAutopipeline && args.songId) {
        await pool.query(
          `UPDATE songs SET autopipeline_error = $2 WHERE id = $1`,
          [args.songId, msg.slice(0, 500)],
        )
      }
    }
  })()
  return id
}

// After Deepgram succeeds on an autopipeline transcript, chain into:
//   1. Social plan generation (via existing /api/socials handler logic)
//   2. Clip generation (Slate's own ffmpeg cutter)
//   3. Flip song.processing_state to 'ready' once everything's queued.
//
// We don't wait for the social plan or clip job to FINISH — both run
// async themselves. "Ready" here means the autopipeline has fired off
// every job it intended to.
async function runPostTranscriptAutopipeline(args: {
  projectId: string
  songId: string
  dropboxPath: string
  createdBy: string
}): Promise<void> {
  try {
    // Social plan: same shape as the existing socialsRouter.post('/')
    // handler but called directly so no HTTP round-trip is needed.
    const { triggerSocialPlanGeneration } = await import('./socials')
    await triggerSocialPlanGeneration({
      songId: args.songId,
      createdBy: args.createdBy,
    })
  } catch (err) {
    logError('autopipeline: social plan trigger failed', {
      songId: args.songId, error: err instanceof Error ? err.message : String(err),
    })
  }

  // Carousel deck — the per-episode Soul&Science-style deck, saved so
  // the team can review / edit / export (IG ZIP or LinkedIn PDF) from
  // the episode page. Fire-and-forget like the others.
  try {
    const { generateAndSaveCarouselDeck } = await import('./carousel')
    void generateAndSaveCarouselDeck({
      songId: args.songId,
      createdBy: args.createdBy,
    }).catch((err) => {
      logError('autopipeline: carousel deck failed', {
        songId: args.songId, error: err instanceof Error ? err.message : String(err),
      })
    })
  } catch (err) {
    logError('autopipeline: carousel trigger failed', {
      songId: args.songId, error: err instanceof Error ? err.message : String(err),
    })
  }

  // Clip job — Slate's ffmpeg cutter (Claude picks moments, ffmpeg cuts
  // vertical captioned clips). The transcript is done by this point, so
  // clip selection has what it needs.
  try {
    const { triggerClipJob } = await import('./clips')
    await triggerClipJob({
      projectId: args.projectId,
      songId: args.songId,
      dropboxPath: args.dropboxPath,
      createdBy: args.createdBy,
    })
  } catch (err) {
    logError('autopipeline: clip job trigger failed', {
      songId: args.songId, error: err instanceof Error ? err.message : String(err),
    })
  }

  await pool.query(
    `UPDATE songs
        SET processing_state = 'ready',
            autopipeline_ready_at = now()
      WHERE id = $1`,
    [args.songId],
  )
  logInfo('autopipeline: episode ready', { songId: args.songId })
}

// CREATE — kicks off transcription. Body: { projectId, dropboxPath, songId?, language? }
transcriptsRouter.post('/', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { projectId, dropboxPath, songId, language } = req.body as {
    projectId?: string
    dropboxPath?: string
    songId?: string | null
    language?: string
  }
  if (!projectId || !dropboxPath) {
    res.status(400).json({ error: 'projectId and dropboxPath required' }); return
  }
  if (!await assertWriter(user, projectId, res)) return
  try {
    const id = await createInternalTranscriptJob({
      projectId, songId: songId ?? null, dropboxPath,
      createdBy: user.id, language,
    })
    const { rows } = await pool.query<TranscriptRow>(`SELECT * FROM transcripts WHERE id = $1`, [id])
    res.json({ transcript: rowToApi(rows[0]) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(msg.startsWith('file_too_large') ? 413 : msg.includes('unavailable') ? 503 : 400).json({ error: msg })
  }
})

// UPDATE — patch edited_blocks and/or settings.
transcriptsRouter.patch('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows: existing } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE id = $1`,
    [req.params.id],
  )
  if (existing.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, existing[0].project_id, res)) return
  const { editedBlocks, startOffsetMs, frameRate, dropFrame } = req.body as {
    editedBlocks?: EditedBlock[]
    startOffsetMs?: number
    frameRate?: number
    dropFrame?: boolean
  }
  const updates: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (editedBlocks !== undefined) {
    updates.push(`edited_blocks = $${i++}::jsonb`); vals.push(JSON.stringify(editedBlocks))
  }
  if (startOffsetMs !== undefined) { updates.push(`start_offset_ms = $${i++}`); vals.push(startOffsetMs) }
  if (frameRate !== undefined) { updates.push(`frame_rate = $${i++}`); vals.push(frameRate) }
  if (dropFrame !== undefined) { updates.push(`drop_frame = $${i++}`); vals.push(dropFrame) }
  if (updates.length === 0) { res.json({ transcript: rowToApi(existing[0], true) }); return }
  vals.push(req.params.id)
  const { rows } = await pool.query<TranscriptRow>(
    `UPDATE transcripts SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    vals,
  )
  res.json({ transcript: rowToApi(rows[0], true) })
})

// CLAUDE PASS — runs the correction + speaker-ID pass against the
// current edited_blocks and returns the proposal (does NOT save). The
// frontend shows the diff; on accept it PATCHes editedBlocks via the
// existing endpoint above.
transcriptsRouter.post('/:id/claude-pass', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow & {
    project_name: string
    project_vocabulary: string | null
    song_title: string | null
  }>(
    `SELECT t.*, p.name AS project_name, p.socials_vocabulary AS project_vocabulary,
            s.title AS song_title
       FROM transcripts t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN songs s ON s.id = t.song_id
      WHERE t.id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const t = rows[0]
  if (!await assertWriter(user, t.project_id, res)) return
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' }); return
  }
  if (t.status !== 'done') {
    res.status(400).json({ error: 'transcript_not_ready' }); return
  }
  const blocks = (t.edited_blocks ?? []) as EditedBlock[]
  if (blocks.length === 0) {
    res.status(400).json({ error: 'no_blocks_to_correct' }); return
  }

  try {
    const result = await correctTranscript({
      showName: t.project_name,
      episodeTitle: t.song_title ?? '(unknown episode)',
      vocabulary: t.project_vocabulary ?? '',
      blocks: blocks.map((b) => ({ speaker: b.speaker, text: b.text, start: b.start, end: b.end })),
    })

    logInfo('transcript correction: done', {
      transcriptId: t.id,
      speakerCount: result.speakerCount,
      vocabApplied: result.vocabularyChangesApplied,
      suggestions: result.suggestedChanges.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    })

    // Stitch corrected speaker/text back onto the original blocks so the
    // word-level `words` field is preserved. The frontend uses block ids
    // to apply the patch.
    const corrected = blocks.map((b, i) => {
      const c = result.correctedBlocks[i]
      return c ? { ...b, speaker: c.speaker, text: c.text } : b
    })

    res.json({
      summary: result.summary,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      vocabularyChangesApplied: result.vocabularyChangesApplied,
      suggestedChanges: result.suggestedChanges,
      correctedBlocks: corrected,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('transcript correction: failed', { transcriptId: t.id, error: msg })
    res.status(502).json({ error: msg.slice(0, 400) })
  }
})

// DELETE
transcriptsRouter.delete('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT project_id FROM transcripts WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, rows[0].project_id, res)) return
  await pool.query(`DELETE FROM transcripts WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})

// SRT export. Uses edited_blocks + start_offset_ms. Splits long blocks
// into ~42-char lines with a 7-second max duration per cue (broadcast
// safety standard).
// Get a fresh Dropbox temp link to stream the source media in the editor.
// Temp links expire after 4 hours so the client should call this each time
// it loads the editor (we don't persist the URL).
transcriptsRouter.get('/:id/media-url', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE id = $1`, [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const link = await getTemporaryLink(rows[0].dropbox_path)
  if (!link.ok || !link.url) {
    res.status(502).json({ error: link.error || 'temporary_link_failed' }); return
  }
  res.json({ url: link.url, fileName: rows[0].file_name })
})

transcriptsRouter.get('/:id/srt', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const t = rows[0]
  const blocks = t.edited_blocks ?? []
  const offsetSec = t.start_offset_ms / 1000
  const srt = blocksToSrt(blocks, offsetSec)
  const filename = `${t.file_name.replace(/\.[^.]+$/, '')}.srt`
  res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(srt)
})

// WebVTT export. Same as SRT but with WEBVTT header and "." for ms.
// Preferred by DaVinci Resolve, YouTube web upload, HTML5 <track>.
transcriptsRouter.get('/:id/vtt', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const t = rows[0]
  const blocks = t.edited_blocks ?? []
  const offsetSec = t.start_offset_ms / 1000
  const vtt = blocksToVtt(blocks, offsetSec)
  const filename = `${t.file_name.replace(/\.[^.]+$/, '')}.vtt`
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(vtt)
})

// Plain-text export. One paragraph per block, prefixed with the speaker.
// Useful for show notes, blog posts, AI summarisation.
transcriptsRouter.get('/:id/txt', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { rows } = await pool.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, rows[0].project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const t = rows[0]
  const blocks = t.edited_blocks ?? []
  const txt = blocksToTxt(blocks)
  const filename = `${t.file_name.replace(/\.[^.]+$/, '')}.txt`
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(txt)
})

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function srtTimecode(totalSeconds: number): string {
  if (totalSeconds < 0) totalSeconds = 0
  const ms = Math.round((totalSeconds % 1) * 1000)
  const total = Math.floor(totalSeconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

function vttTimecode(totalSeconds: number): string {
  return srtTimecode(totalSeconds).replace(',', '.')
}

function blocksToVtt(blocks: EditedBlock[], offsetSec: number): string {
  const lines: string[] = ['WEBVTT', '']
  for (const b of blocks) {
    const start = b.start + offsetSec
    const end = b.end + offsetSec
    lines.push(`${vttTimecode(start)} --> ${vttTimecode(end)}`)
    lines.push(wrapForCaption(b.text.trim()))
    lines.push('')
  }
  return lines.join('\n')
}

function blocksToTxt(blocks: EditedBlock[]): string {
  const out: string[] = []
  let lastSpeaker = ''
  for (const b of blocks) {
    if (b.speaker !== lastSpeaker) {
      if (out.length > 0) out.push('')
      out.push(`${b.speaker}:`)
      lastSpeaker = b.speaker
    }
    out.push(b.text.trim())
  }
  return out.join('\n')
}

function blocksToSrt(blocks: EditedBlock[], offsetSec: number): string {
  let cueIndex = 1
  const lines: string[] = []
  for (const b of blocks) {
    const start = b.start + offsetSec
    const end = b.end + offsetSec
    lines.push(String(cueIndex++))
    lines.push(`${srtTimecode(start)} --> ${srtTimecode(end)}`)
    // Two-line cap with ~42 chars per line (broadcast safe area)
    const text = b.text.trim()
    lines.push(wrapForCaption(text))
    lines.push('')
  }
  return lines.join('\n')
}

function wrapForCaption(text: string, maxLen = 42, maxLines = 2): string {
  const words = text.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if (out.length >= maxLines) {
      cur = cur ? `${cur} ${w}` : w
      continue
    }
    if (cur.length === 0) { cur = w; continue }
    if (`${cur} ${w}`.length <= maxLen) {
      cur = `${cur} ${w}`
    } else {
      out.push(cur); cur = w
    }
  }
  if (cur) {
    if (out.length < maxLines) out.push(cur)
    else out[out.length - 1] = `${out[out.length - 1]} ${cur}`
  }
  return out.join('\n')
}
