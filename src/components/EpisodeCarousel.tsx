// Per-episode carousel generator. Lives inside SocialsSection so each
// episode card has a one-click "Generate carousel" button. Pulls the
// episode's transcript from the API, sends it to Claude with the
// show's preset, then renders the resulting deck inline using the
// shared DeckGrid component (the same UI the design lab uses).
//
// Asset uploads (host photo, brand logos, etc.) flow into a runtime
// preset overlay so the slides re-render with the uploads layered on
// top — no server roundtrip per upload.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type ApiCarouselDeckSlide,
  type ApiCarouselAssetRequest,
  type ApiTranscript,
} from '../api'
import {
  adaptServerSlide,
  findPreset,
  SOUL_AND_SCIENCE_PRESET,
  type ShowDeckPreset,
  type SlideSpec,
} from '../lib/carouselDeckImage'
import { DeckGrid } from './CarouselDeck'

export default function EpisodeCarousel({
  projectId,
  songId,
  showName,
  episodeTitle,
}: {
  projectId: string
  songId: string
  showName: string
  episodeTitle?: string
}) {
  const [hasTranscript, setHasTranscript] = useState<boolean | null>(null)
  const [transcriptId, setTranscriptId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawSlides, setRawSlides] = useState<ApiCarouselDeckSlide[] | null>(null)
  const [assetRequests, setAssetRequests] = useState<ApiCarouselAssetRequest[]>([])
  const [uploads, setUploads] = useState<UploadedAssets>(EMPTY_UPLOADS)

  // For v1 the preset is hardcoded to Soul & Science. Once per-show
  // preset config lands, this resolves by project/show.
  const preset = useMemo<ShowDeckPreset>(() => {
    const guess = showName.toLowerCase().includes('soul') ? 'soul-and-science' : null
    return (guess && findPreset(guess)) || SOUL_AND_SCIENCE_PRESET
  }, [showName])

  // Find the most recent "done" transcript for this episode so we
  // know whether to enable the Generate button.
  useEffect(() => {
    let cancelled = false
    api.transcripts(projectId)
      .then((r) => {
        if (cancelled) return
        const done = r.transcripts.find((t: ApiTranscript) => t.songId === songId && t.status === 'done')
        setHasTranscript(!!done)
        setTranscriptId(done?.id ?? null)
      })
      .catch(() => { if (!cancelled) setHasTranscript(false) })
    return () => { cancelled = true }
  }, [projectId, songId])

  async function generate() {
    if (!transcriptId) return
    setBusy(true)
    setError(null)
    setRawSlides(null)
    setAssetRequests([])
    try {
      // Fetch the full transcript and stitch its blocks into one
      // plain-text body the Claude prompt can read.
      const full = await api.transcript(transcriptId)
      const text = (full.transcript.editedBlocks ?? [])
        .map((b) => (b.speaker ? `${b.speaker}: ${b.text}` : b.text))
        .join('\n')
        .trim()
      if (text.length < 200) {
        throw new Error('Transcript is too short — re-transcribe and try again.')
      }
      const result = await api.generateCarouselDeck({
        transcript: text,
        showName,
        presetKey: preset.key,
        episodeTitle,
      })
      setRawSlides(result.deck.slides)
      setAssetRequests(result.deck.asset_requests)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  // Layer uploaded URLs onto the preset so the renderer picks them up.
  const runtimePreset: ShowDeckPreset = useMemo(() => ({
    ...preset,
    assets: {
      ...(preset.assets ?? {}),
      hostPhotoUrl: uploads.hostPhoto?.url ?? preset.assets?.hostPhotoUrl,
      logoLockupUrl: uploads.showLogo?.url ?? preset.assets?.logoLockupUrl,
      platforms: Object.entries(uploads.platformIcons).map(([name, v]) => ({ name, iconUrl: v.url })),
    },
  }), [preset, uploads])

  // Adapt + attach per-slide assets.
  const slides: SlideSpec[] = useMemo(() => {
    if (!rawSlides) return []
    return rawSlides
      .map((s, i) => {
        const adapted = adaptServerSlide(s as Parameters<typeof adaptServerSlide>[0])
        if (!adapted) return null
        if (adapted.kind === 'brand-callout') {
          const upload = uploads.collageImages[i + 1] ?? uploads.brandLogos[i + 1]
          if (upload) return { ...adapted, collageImageKey: upload.url }
        }
        return adapted
      })
      .filter((x): x is SlideSpec => x !== null)
  }, [rawSlides, uploads])

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🎴 Branded carousel</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            7-slide Instagram carousel generated from this episode's transcript, branded to {preset.displayName}.
            Edit any slide and download as a ZIP for upload.
          </p>
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy || !hasTranscript}
          title={hasTranscript ? 'Generate a carousel from this episode' : 'Transcribe the episode first'}
          className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
        >
          {busy ? 'Generating…' : (rawSlides ? '↻ Regenerate' : '✨ Generate carousel')}
        </button>
      </div>

      {hasTranscript === false && (
        <p className="text-[11px] text-muted/70 italic">
          Add + transcribe the episode media first. The carousel needs the episode's words to write the headlines.
        </p>
      )}
      {error && <p className="text-urgent text-xs">{error}</p>}

      {rawSlides && (
        <>
          <AssetPromptPanel
            preset={preset}
            requests={assetRequests}
            uploads={uploads}
            setUploads={setUploads}
          />
          <DeckGrid preset={runtimePreset} slides={slides} />
        </>
      )}
    </section>
  )
}

// ============================================================
// Asset upload panel (mirrors the design-lab page so behavior matches)
// ============================================================
type UploadedAssets = {
  hostPhoto?: { url: string; file: File }
  showLogo?: { url: string; file: File }
  platformIcons: Record<string, { url: string; file: File }>
  brandLogos: Record<number, { url: string; file: File }>
  collageImages: Record<number, { url: string; file: File }>
}
const EMPTY_UPLOADS: UploadedAssets = {
  platformIcons: {}, brandLogos: {}, collageImages: {},
}

function AssetPromptPanel({
  preset, requests, uploads, setUploads,
}: {
  preset: ShowDeckPreset
  requests: ApiCarouselAssetRequest[]
  uploads: UploadedAssets
  setUploads: React.Dispatch<React.SetStateAction<UploadedAssets>>
}) {
  const wantsHost  = requests.some((r) => r.slot === 'host_photo')
  const wantsLogo  = requests.some((r) => r.slot === 'show_logo')
  const platforms  = requests.filter((r) => r.slot === 'platform_icons')
  const brandLogos = requests.filter((r) => r.slot === 'brand_logo')
  const collages   = requests.filter((r) => r.slot === 'collage_image')

  function onFile(slot: keyof UploadedAssets | 'platform', key: string | number, file: File | null) {
    if (!file) return
    const url = URL.createObjectURL(file)
    setUploads((prev) => {
      const next = { ...prev }
      if (slot === 'hostPhoto') next.hostPhoto = { url, file }
      else if (slot === 'showLogo') next.showLogo = { url, file }
      else if (slot === 'platformIcons') next.platformIcons = { ...next.platformIcons, [String(key)]: { url, file } }
      else if (slot === 'brandLogos') next.brandLogos = { ...next.brandLogos, [Number(key)]: { url, file } }
      else if (slot === 'collageImages') next.collageImages = { ...next.collageImages, [Number(key)]: { url, file } }
      return next
    })
  }

  if (requests.length === 0) return null

  return (
    <div className="rounded-2xl border border-stage-mastering/40 bg-stage-mastering/5 p-4 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-stage-mastering font-bold">
          Assets the design wants
        </p>
        <p className="text-[10px] text-muted mt-0.5">
          All optional — slides render with placeholders if you skip an upload.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {wantsHost && (
          <UploadRow
            label={`Host headshot${preset.hostTagline ? ` · ${preset.hostTagline}` : ''}`}
            hint="Torso-up portrait. Any background — drawn inside the finale frame."
            current={uploads.hostPhoto?.file.name}
            onFile={(f) => onFile('hostPhoto', 'host', f)}
          />
        )}
        {wantsLogo && (
          <UploadRow
            label="Show logo lockup"
            hint="Two-line wordmark PNG/SVG."
            current={uploads.showLogo?.file.name}
            onFile={(f) => onFile('showLogo', 'logo', f)}
          />
        )}
        {platforms.map((p, i) => (
          <UploadRow
            key={`p-${i}`}
            label={`Platform icon — ${p.description}`}
            hint="Round PNG, 96×96 or larger."
            current={uploads.platformIcons[p.description]?.file.name}
            onFile={(f) => onFile('platformIcons', p.description, f)}
          />
        ))}
        {brandLogos.map((b) => (
          <UploadRow
            key={`b-${b.slide_index}`}
            label={`Slide ${b.slide_index} brand logo`}
            hint={b.description}
            current={uploads.brandLogos[b.slide_index]?.file.name}
            onFile={(f) => onFile('brandLogos', b.slide_index, f)}
          />
        ))}
        {collages.map((c) => (
          <UploadRow
            key={`c-${c.slide_index}`}
            label={`Slide ${c.slide_index} image / collage`}
            hint={c.description}
            current={uploads.collageImages[c.slide_index]?.file.name}
            onFile={(f) => onFile('collageImages', c.slide_index, f)}
          />
        ))}
      </div>
    </div>
  )
}

function UploadRow({ label, hint, current, onFile }: {
  label: string; hint: string; current?: string | null
  onFile: (file: File | null) => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <div className="rounded-xl border border-line/60 bg-ink/30 p-3 space-y-2">
      <div>
        <p className="text-xs font-bold text-text">{label}</p>
        <p className="text-[10px] text-muted/70 mt-0.5">{hint}</p>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <button
        onClick={() => ref.current?.click()}
        className="text-[10px] uppercase tracking-wider font-bold text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10"
      >
        {current ? `↻ ${current}` : '↑ Upload'}
      </button>
    </div>
  )
}
