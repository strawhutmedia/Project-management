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
import { requireUser, type SessionUser } from '../auth'
import { hasAnthropicKey, generateCarouselDeck } from '../anthropic'
import { logError } from '../diag'

export const carouselRouter = Router()
carouselRouter.use(requireUser)

const MAX_TRANSCRIPT_CHARS = 200_000

carouselRouter.post('/preview', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  // Admin-gated since each call burns tokens. We can relax to
  // project-writer later when we wire it into a project context.
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'anthropic_key_missing' })
    return
  }
  const {
    transcript, showName, hostName, presetKey,
    episodeTitle, episodeNumber,
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
    const result = await generateCarouselDeck({
      showName: showName.trim(),
      hostName: typeof hostName === 'string' && hostName.trim() ? hostName.trim() : undefined,
      presetKey: presetKey.trim(),
      episodeTitle: typeof episodeTitle === 'string' && episodeTitle.trim() ? episodeTitle.trim() : null,
      episodeNumber: typeof episodeNumber === 'number' ? episodeNumber : null,
      episodeTranscript: transcript,
    })
    res.json(result)
  } catch (err) {
    logError('carousel route: generation failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: 'generation_failed' })
  }
})
