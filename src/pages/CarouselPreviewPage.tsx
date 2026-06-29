// Carousel design lab.
//
// Two modes:
//   1. SAMPLE  — renders the hardcoded sampleSoulAndScienceDeck() so
//                we can iterate on visuals without burning tokens.
//   2. GENERATE — paste an episode transcript, pick a show preset,
//                hit Generate. Claude returns a slide spec; we
//                surface the asset upload prompts it wants, the user
//                drops files in, then we render the deck and offer
//                a ZIP download.
//
// Per-show preset config lives in src/lib/carouselDeckImage.ts for
// now (BUILT_IN_PRESETS). Once the preset CRUD UI lands, this page
// will read presets from the server.
import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { api, type ApiCarouselDeckSlide, type ApiCarouselAssetRequest } from '../api'
import {
  renderDeckSlideCanvas,
  sampleSoulAndScienceDeck,
  BUILT_IN_PRESETS,
  SOUL_AND_SCIENCE_PRESET,
  findPreset,
  preloadDeckImages,
  adaptServerSlide,
  canvasToBlob,
  type ShowDeckPreset,
  type SlideSpec,
} from '../lib/carouselDeckImage'

type Mode = 'sample' | 'generate'

type UploadedAssets = {
  hostPhoto?: { url: string; file: File }
  showLogo?: { url: string; file: File }
  platformIcons: Record<string, { url: string; file: File }>  // keyed by platform name
  brandLogos: Record<number, { url: string; file: File }>     // keyed by slide index
  collageImages: Record<number, { url: string; file: File }>  // keyed by slide index
}

const EMPTY_UPLOADS: UploadedAssets = {
  platformIcons: {}, brandLogos: {}, collageImages: {},
}

export default function CarouselPreviewPage() {
  const [mode, setMode] = useState<Mode>('sample')
  const [presetKey, setPresetKey] = useState<string>(SOUL_AND_SCIENCE_PRESET.key)
  const preset = useMemo(() => findPreset(presetKey) ?? SOUL_AND_SCIENCE_PRESET, [presetKey])

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-text">Carousel design lab</h1>
        <p className="text-sm text-muted max-w-3xl">
          Build branded multi-slide Instagram carousels from a podcast transcript.
          The renderer is per-show preset-driven, so every podcast gets its own visual identity
          (palette, logo, dot-wave colors, accent rules) while sharing the same engine.
        </p>

        <details className="max-w-3xl rounded-xl border border-line/60 bg-ink/30 p-3" open>
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-stage-mastering font-bold">
            How to use this page
          </summary>
          <ol className="mt-3 space-y-2 text-xs text-muted list-decimal list-inside">
            <li>
              <span className="font-bold text-text">Sanity-check the visual first.</span>{' '}
              Click <span className="font-mono">Sample (no transcript needed)</span> and compare the
              7 sample slides to the reference Soul &amp; Science deck. If anything looks off
              (type weight, color, spacing, dot-wave shape), flag it before generating real content.
            </li>
            <li>
              <span className="font-bold text-text">Generate from a transcript.</span>{' '}
              Click <span className="font-mono">Generate from transcript</span>, paste the
              full episode transcript into the textarea, optionally fill in episode title + number,
              hit <span className="font-mono">✨ Generate carousel</span>. Claude takes ~30–60 sec
              and returns a 5–7 slide spec branded to the selected show.
            </li>
            <li>
              <span className="font-bold text-text">Upload only the assets you have.</span>{' '}
              A yellow panel will appear listing every asset the design wants (host photo,
              brand logos, etc.). Each is optional — slides render with labeled placeholders
              if you skip an upload, so you can still ship a deck text-and-diagrams-only.
            </li>
            <li>
              <span className="font-bold text-text">Review and download.</span>{' '}
              Slides preview live in Step 3. When the deck looks right, click
              <span className="font-mono"> ↓ Download all slides as ZIP</span>{' '}
              and you'll get sequentially-numbered 1080×1350 PNGs ready for Instagram upload.
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-muted/70">
            v1 caveat: only the <span className="font-bold text-text">Soul &amp; Science</span> preset
            is wired right now. Other shows will use its palette until per-show config lands.
            Expect headlines and accent-word splits to need a tweak after the first run — let us
            know what to refine.
          </p>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <ModeButton current={mode} value="sample" setMode={setMode}>
            Sample (no transcript needed)
          </ModeButton>
          <ModeButton current={mode} value="generate" setMode={setMode}>
            Generate from transcript
          </ModeButton>
          <span className="text-[10px] text-muted/60 ml-auto">
            preset:&nbsp;
            <select
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
              className="bg-ink/40 border border-line rounded px-2 py-1 text-xs text-text"
            >
              {BUILT_IN_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.displayName}</option>
              ))}
            </select>
          </span>
        </div>
      </header>

      {mode === 'sample' ? (
        <SampleDeck preset={preset} />
      ) : (
        <GenerateFlow preset={preset} />
      )}
    </div>
  )
}

function ModeButton({
  current, value, setMode, children,
}: {
  current: Mode; value: Mode; setMode: (m: Mode) => void; children: React.ReactNode
}) {
  const active = current === value
  return (
    <button
      onClick={() => setMode(value)}
      className={`text-[11px] uppercase tracking-wider font-bold rounded-full px-3 py-1.5 border transition ${
        active
          ? 'bg-stage-mastering text-white border-stage-mastering'
          : 'border-line text-muted hover:text-text hover:border-stage-mastering/40'
      }`}
    >
      {children}
    </button>
  )
}

// ============================================================
// SAMPLE mode
// ============================================================
function SampleDeck({ preset }: { preset: ShowDeckPreset }) {
  const slides = sampleSoulAndScienceDeck()
  return (
    <DeckGrid preset={preset} slides={slides} />
  )
}

// ============================================================
// GENERATE mode
// ============================================================
function GenerateFlow({ preset }: { preset: ShowDeckPreset }) {
  const [transcript, setTranscript] = useState('')
  const [episodeTitle, setEpisodeTitle] = useState('')
  const [episodeNumber, setEpisodeNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawSlides, setRawSlides] = useState<ApiCarouselDeckSlide[] | null>(null)
  const [assetRequests, setAssetRequests] = useState<ApiCarouselAssetRequest[]>([])
  const [uploads, setUploads] = useState<UploadedAssets>(EMPTY_UPLOADS)

  async function generate() {
    setBusy(true)
    setError(null)
    setRawSlides(null)
    setAssetRequests([])
    try {
      const result = await api.generateCarouselDeck({
        transcript,
        showName: preset.displayName,
        hostName: preset.hostTagline?.replace(/^WITH\s+/i, '').trim() || undefined,
        presetKey: preset.key,
        episodeTitle: episodeTitle.trim() || undefined,
        episodeNumber: episodeNumber.trim() ? Number(episodeNumber) : undefined,
      })
      setRawSlides(result.deck.slides)
      setAssetRequests(result.deck.asset_requests)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  // Build the runtime preset by overlaying uploaded asset URLs.
  const runtimePreset: ShowDeckPreset = useMemo(() => ({
    ...preset,
    assets: {
      ...(preset.assets ?? {}),
      hostPhotoUrl: uploads.hostPhoto?.url ?? preset.assets?.hostPhotoUrl,
      logoLockupUrl: uploads.showLogo?.url ?? preset.assets?.logoLockupUrl,
      platforms: Object.entries(uploads.platformIcons).map(([name, v]) => ({ name, iconUrl: v.url })),
    },
  }), [preset, uploads])

  // Adapt server slides → SlideSpec[].
  const slides: SlideSpec[] = useMemo(() => {
    if (!rawSlides) return []
    return rawSlides
      .map((s, i) => {
        const adapted = adaptServerSlide(s as Parameters<typeof adaptServerSlide>[0])
        if (!adapted) return null
        // Attach uploaded collage / brand assets to the slide.
        if (adapted.kind === 'brand-callout') {
          const upload = uploads.collageImages[i + 1] ?? uploads.brandLogos[i + 1]
          if (upload) return { ...adapted, collageImageKey: upload.url }
        }
        return adapted
      })
      .filter((x): x is SlideSpec => x !== null)
  }, [rawSlides, uploads])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
        <div>
          <h2 className="text-[11px] uppercase tracking-wider text-muted font-bold">Step 1 — Paste transcript</h2>
          <p className="text-[11px] text-muted/70 mt-1">
            Either paste the full episode transcript here, or once we wire this into SocialsSection,
            it’ll pull from the existing transcripts table automatically.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Episode title (optional)</span>
            <input
              value={episodeTitle}
              onChange={(e) => setEpisodeTitle(e.target.value)}
              className="w-full bg-ink/40 border border-line rounded px-2 py-2 text-sm text-text"
              placeholder="e.g. Why Legacy Brands Win"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Episode number (optional)</span>
            <input
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(e.target.value)}
              inputMode="numeric"
              className="w-full bg-ink/40 border border-line rounded px-2 py-2 text-sm text-text"
              placeholder="e.g. 12"
            />
          </label>
        </div>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={10}
          className="w-full bg-ink/40 border border-line rounded p-3 text-xs text-text font-mono"
          placeholder="Paste transcript here…"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void generate()}
            disabled={busy || transcript.trim().length < 200}
            className="rounded-full bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2 disabled:opacity-50"
          >
            {busy ? 'Generating…' : '✨ Generate carousel'}
          </button>
          {error && <span className="text-urgent text-xs">{error}</span>}
          <span className="text-[10px] text-muted/60 ml-auto">{transcript.length.toLocaleString()} chars</span>
        </div>
      </section>

      {rawSlides && (
        <>
          <AssetPromptPanel
            preset={preset}
            requests={assetRequests}
            uploads={uploads}
            setUploads={setUploads}
          />
          <section className="space-y-3">
            <h2 className="text-[11px] uppercase tracking-wider text-muted font-bold">
              Step 3 — Preview &amp; download
            </h2>
            <DeckGrid preset={runtimePreset} slides={slides} />
          </section>
        </>
      )}
    </div>
  )
}

// ============================================================
// Asset prompt panel — surfaces the upload slots Claude asked for
// ============================================================
function AssetPromptPanel({
  preset, requests, uploads, setUploads,
}: {
  preset: ShowDeckPreset
  requests: ApiCarouselAssetRequest[]
  uploads: UploadedAssets
  setUploads: React.Dispatch<React.SetStateAction<UploadedAssets>>
}) {
  // De-dupe slot kinds so we show ONE upload row per category, plus
  // per-slide brand/collage slots.
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

  return (
    <section className="rounded-2xl border border-stage-mastering/40 bg-stage-mastering/5 p-5 space-y-4">
      <div>
        <h2 className="text-[11px] uppercase tracking-wider text-stage-mastering font-bold">
          Step 2 — Upload assets the design needs
        </h2>
        <p className="text-[11px] text-muted mt-1">
          Claude flagged these slots. Each is optional — slides render with placeholders if you skip an upload.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {wantsHost && (
          <UploadRow
            label={`Host headshot${preset.hostTagline ? ` · ${preset.hostTagline}` : ''}`}
            hint="Torso-up portrait. Any background — we’ll crop on the finale slide."
            current={uploads.hostPhoto?.file.name}
            onFile={(f) => onFile('hostPhoto', 'host', f)}
          />
        )}
        {wantsLogo && (
          <UploadRow
            label="Show logo lockup"
            hint="The two-line wordmark as PNG/SVG. Replaces the Canvas-drawn type."
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
        {requests.length === 0 && (
          <p className="text-xs text-muted italic">Claude didn’t request any external assets for this episode.</p>
        )}
      </div>
    </section>
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

// ============================================================
// Deck grid — renders all slides with preloaded assets
// ============================================================
function DeckGrid({ preset, slides }: { preset: ShowDeckPreset; slides: SlideSpec[] }) {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    preloadDeckImages(preset, slides).then((m) => { if (!cancelled) setImages(m) })
    return () => { cancelled = true }
  }, [preset, slides])

  async function downloadZip() {
    setBusy(true)
    try {
      const zip = new JSZip()
      for (let i = 0; i < slides.length; i++) {
        const canvas = renderDeckSlideCanvas(
          { preset, slide: slides[i], index: i + 1, total: slides.length, images },
          { fullSize: true },
        )
        const blob = await canvasToBlob(canvas, 'image/png')
        zip.file(`${preset.key}-${String(i + 1).padStart(2, '0')}.png`, blob)
      }
      const out = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(out)
      const a = document.createElement('a')
      a.href = url
      a.download = `${preset.key}-carousel.zip`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  if (slides.length === 0) {
    return <p className="text-sm text-muted italic">No renderable slides.</p>
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {slides.map((slide, i) => (
          <SlidePreview
            key={i}
            slide={slide}
            preset={preset}
            images={images}
            index={i + 1}
            total={slides.length}
          />
        ))}
      </div>
      <button
        onClick={() => void downloadZip()}
        disabled={busy}
        className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2.5 disabled:opacity-50"
      >
        {busy ? 'Bundling…' : `↓ Download all ${slides.length} slides as ZIP`}
      </button>
    </div>
  )
}

function SlidePreview({ slide, preset, images, index, total }: {
  slide: SlideSpec; preset: ShowDeckPreset
  images: Map<string, HTMLImageElement>
  index: number; total: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const canvas = renderDeckSlideCanvas(
      { preset, slide, index, total, images },
      { fullSize: false },
    )
    ref.current.innerHTML = ''
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = 'auto'
    canvas.style.borderRadius = '14px'
    ref.current.appendChild(canvas)
  }, [slide, preset, images, index, total])
  return (
    <div className="space-y-2">
      <div ref={ref} className="bg-black rounded-2xl overflow-hidden shadow-lg" />
      <p className="text-[10px] uppercase tracking-wider text-muted">
        Slide {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')} — {slide.kind}
      </p>
    </div>
  )
}
