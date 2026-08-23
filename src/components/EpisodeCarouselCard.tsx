// Per-episode carousel deck card (Soul & Science-style decks for every
// show). The upload-and-go pipeline generates the deck automatically
// once the transcript lands; this card shows it, supports per-slide
// editing via the shared DeckGrid, and exports as Instagram PNGs (ZIP)
// or a LinkedIn document-post PDF. Regenerate re-runs from the latest
// transcript. A human posts it — Slate never publishes anywhere.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type ApiCarouselDeckSlide } from '../api'
import { DeckGrid } from './CarouselDeck'
import { adaptServerSlide, type ShowDeckPreset, type SlideSpec } from '../lib/carouselDeckImage'

type DeckState = Awaited<ReturnType<typeof api.episodeCarouselDeck>>

export default function EpisodeCarouselCard({ songId, canWrite }: {
  songId: string
  canWrite: boolean
}) {
  const [state, setState] = useState<DeckState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<number | null>(null)

  async function load() {
    try {
      const r = await api.episodeCarouselDeck(songId)
      setState(r)
      return r
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      return null
    }
  }

  useEffect(() => {
    void load()
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [songId])

  // Poll while a generation is in flight.
  useEffect(() => {
    if (state?.deck?.status === 'generating' && !pollRef.current) {
      pollRef.current = window.setInterval(() => {
        void load().then((r) => {
          if (r?.deck?.status !== 'generating' && pollRef.current) {
            window.clearInterval(pollRef.current)
            pollRef.current = null
          }
        })
      }, 5000)
    }
  }, [state?.deck?.status])

  async function generate() {
    setBusy(true); setError(null)
    try {
      await api.generateEpisodeCarouselDeck(songId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const slides: SlideSpec[] = useMemo(() => {
    const raw = state?.deck?.deck?.slides as ApiCarouselDeckSlide[] | undefined
    if (!raw) return []
    return raw
      .map((s) => adaptServerSlide(s as Parameters<typeof adaptServerSlide>[0]))
      .filter((x): x is SlideSpec => x !== null)
  }, [state])

  const deck = state?.deck
  const preset = state?.preset as ShowDeckPreset | null

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎠 Episode Carousel</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            5–7 slide deck in the show's own look (derived from its cover art), written from this
            episode's transcript. Export as Instagram PNGs or a LinkedIn document-post PDF —
            a human reviews and posts it.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => void generate()}
            disabled={busy || deck?.status === 'generating'}
            className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-50"
          >
            {deck?.status === 'generating' ? 'Generating…' : deck ? '↻ Regenerate' : '✨ Generate'}
          </button>
        )}
      </div>

      {error && <p className="text-urgent text-xs">{error}</p>}

      {deck?.status === 'generating' && (
        <p className="text-xs text-muted italic">Claude is writing the deck — this card refreshes itself (~1 min).</p>
      )}
      {deck?.status === 'failed' && (
        <p className="text-xs text-urgent">
          Deck generation failed: {deck.error === 'no_preset_add_cover_art'
            ? 'the show needs cover art first (the design is derived from it) — add cover art, then Regenerate.'
            : deck.error === 'no_done_transcript'
              ? 'no finished transcript for this episode yet.'
              : deck.error}
        </p>
      )}

      {deck?.status === 'generated' && preset && slides.length > 0 && (
        <DeckGrid preset={preset} slides={slides} />
      )}
      {deck?.status === 'generated' && !preset && (
        <p className="text-xs text-urgent">Deck exists but the show preset is missing — open the show page and re-derive the carousel design.</p>
      )}
      {!deck && (
        <p className="text-xs text-muted italic">
          No deck yet. New episodes get one automatically when their transcript finishes
          {canWrite ? ' — or hit Generate now.' : '.'}
        </p>
      )}
    </section>
  )
}
