// Podcast carousel deck generator.
//
//   POST /api/carousel/preview   { transcript, showName, hostName, presetKey,
//                                  episodeTitle?, episodeNumber? }
//     → { deck: { slides, asset_requests }, usage }
//
// Synchronous (we just await Claude). Used by the /carousel-preview
// page for now; the production flow will move this to a fire-and-
// forget job once we wire it into SocialsSection.
import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { hasAnthropicKey, generateCarouselDeck } from '../anthropic'
import { loadShowStrategyDocs } from './socials'
import { logError } from '../diag'

export const carouselRouter = Router()
carouselRouter.use(requireUser)

const MAX_TRANSCRIPT_CHARS = 200_000

carouselRouter.post('/preview', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  // Any logged-in user can generate. Each call burns Claude tokens,
  // so we log who's calling and how big the transcript was — that's
  // enough to spot abuse without locking out Caroline / the social team.
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'anthropic_key_missing' })
    return
  }
  const {
    transcript, showName, hostName, presetKey,
    episodeTitle, episodeNumber, projectId,
  } = (req.body ?? {}) as Record<string, unknown>

  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    res.status(400).json({ error: 'transcript_required' })
    return
  }
  if (typeof showName !== 'string' || !showName.trim()) {
    res.status(400).json({ error: 'showName_required' })
    return
  }
  if (typeof presetKey !== 'string' || !presetKey.trim()) {
    res.status(400).json({ error: 'presetKey_required' })
    return
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    res.status(400).json({
      error: 'transcript_too_long',
      maxChars: MAX_TRANSCRIPT_CHARS,
      gotChars: transcript.length,
    })
    return
  }

  try {
    // If the caller passed a projectId, verify they can access that
    // project BEFORE we load its strategy docs — otherwise any logged-in
    // user could pass a projectId they don't belong to and have that
    // project's brand positioning baked into a deck. If access is
    // denied, ignore the projectId silently and generate from the
    // transcript alone (deck still returns, just without strategy
    // context).
    let strategyDocs
    if (typeof projectId === 'string' && projectId.trim()) {
      const projRes = await pool.query(
        `SELECT 1 FROM projects p
           LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
          WHERE p.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)
          LIMIT 1`,
        [user.id, projectId.trim(), user.role],
      )
      if (projRes.rows.length > 0) {
        strategyDocs = await loadShowStrategyDocs(projectId.trim())
      }
    }
    const result = await generateCarouselDeck({
      showName: showName.trim(),
      hostName: typeof hostName === 'string' && hostName.trim() ? hostName.trim() : undefined,
      presetKey: presetKey.trim(),
      episodeTitle: typeof episodeTitle === 'string' && episodeTitle.trim() ? episodeTitle.trim() : null,
      episodeNumber: typeof episodeNumber === 'number' ? episodeNumber : null,
      episodeTranscript: transcript,
      strategyDocs,
    })
    // Audit trail so we know who's burning tokens.
    // eslint-disable-next-line no-console
    console.log(
      `[carousel] generated · user=${user.id} show=${showName} chars=${transcript.length} ` +
      `slides=${result.deck.slides.length} input_tokens=${result.usage.inputTokens} ` +
      `output_tokens=${result.usage.outputTokens}`,
    )
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('carousel route: generation failed', { error: msg, transcriptChars: transcript.length })
    // Surface the actual reason so the UI can show "claude returned no
    // text block" / "invalid JSON" / "anthropic 400 ..." instead of an
    // opaque "generation_failed". Truncate so we never leak a 50KB
    // stack trace into the JSON response.
    res.status(500).json({ error: 'generation_failed', detail: msg.slice(0, 600) })
  }
})
