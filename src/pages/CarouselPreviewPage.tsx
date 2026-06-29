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
  type ConceptIconKey,
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
// The grid keeps a local copy of the slides so individual cards can be
// edited without re-running Claude. `slides` (the prop) is the canonical
// AI version; `editedSlides` is what's rendered + downloaded. Each
// preview card has a "Reset" button that restores its slide from the
// canonical version.
function DeckGrid({ preset, slides }: { preset: ShowDeckPreset; slides: SlideSpec[] }) {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const [busy, setBusy] = useState(false)
  const [editedSlides, setEditedSlides] = useState<SlideSpec[]>(slides)
  // If the upstream slide list changes (new generation / different sample),
  // reset the local edits.
  useEffect(() => { setEditedSlides(slides) }, [slides])

  useEffect(() => {
    let cancelled = false
    preloadDeckImages(preset, editedSlides).then((m) => { if (!cancelled) setImages(m) })
    return () => { cancelled = true }
  }, [preset, editedSlides])

  function updateSlide(index: number, next: SlideSpec) {
    setEditedSlides((prev) => prev.map((s, i) => (i === index ? next : s)))
  }
  function resetSlide(index: number) {
    setEditedSlides((prev) => prev.map((s, i) => (i === index ? slides[i] : s)))
  }

  async function downloadZip() {
    setBusy(true)
    try {
      const zip = new JSZip()
      for (let i = 0; i < editedSlides.length; i++) {
        const canvas = renderDeckSlideCanvas(
          { preset, slide: editedSlides[i], index: i + 1, total: editedSlides.length, images },
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

  if (editedSlides.length === 0) {
    return <p className="text-sm text-muted italic">No renderable slides.</p>
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {editedSlides.map((slide, i) => (
          <SlidePreview
            key={i}
            slide={slide}
            originalSlide={slides[i]}
            preset={preset}
            images={images}
            index={i + 1}
            total={editedSlides.length}
            onChange={(next) => updateSlide(i, next)}
            onReset={() => resetSlide(i)}
          />
        ))}
      </div>
      <button
        onClick={() => void downloadZip()}
        disabled={busy}
        className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2.5 disabled:opacity-50"
      >
        {busy ? 'Bundling…' : `↓ Download all ${editedSlides.length} slides as ZIP`}
      </button>
    </div>
  )
}

function SlidePreview({
  slide, originalSlide, preset, images, index, total, onChange, onReset,
}: {
  slide: SlideSpec
  originalSlide?: SlideSpec  // canonical AI version, for diff/reset
  preset: ShowDeckPreset
  images: Map<string, HTMLImageElement>
  index: number; total: number
  onChange?: (next: SlideSpec) => void
  onReset?: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)
  const edited = !!originalSlide && JSON.stringify(slide) !== JSON.stringify(originalSlide)
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
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted">
          Slide {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')} — {slide.kind}
          {edited && <span className="ml-2 text-stage-mastering">· edited</span>}
        </p>
        {onChange && (
          <div className="flex items-center gap-1.5">
            {edited && onReset && (
              <button
                onClick={onReset}
                title="Restore the AI-generated version"
                className="text-[9px] uppercase tracking-wider text-muted hover:text-text border border-line rounded-full px-2 py-0.5"
              >
                ↺ Reset
              </button>
            )}
            <button
              onClick={() => setEditing(!editing)}
              className="text-[9px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-2 py-0.5 hover:bg-stage-mastering/10"
            >
              {editing ? 'Done' : '✎ Edit'}
            </button>
          </div>
        )}
      </div>
      {editing && onChange && (
        <EditSlideForm slide={slide} onChange={onChange} />
      )}
    </div>
  )
}

// ============================================================
// Per-kind edit forms
// ============================================================
// One form per slide kind, each exposing the renderer knobs the user
// is most likely to want to tweak. Live re-render is automatic because
// every onChange flows back into editedSlides → SlidePreview redraws.
function EditSlideForm({ slide, onChange }: {
  slide: SlideSpec
  onChange: (next: SlideSpec) => void
}) {
  return (
    <div className="rounded-xl border border-stage-mastering/30 bg-stage-mastering/5 p-3 space-y-2 text-xs">
      {slide.kind === 'cover' && (
        <CoverForm slide={slide} onChange={onChange} />
      )}
      {slide.kind === 'thesis' && (
        <ThesisForm slide={slide} onChange={onChange} />
      )}
      {slide.kind === 'callout' && (
        <CalloutForm slide={slide} onChange={onChange} />
      )}
      {slide.kind === 'brand-callout' && (
        <BrandCalloutForm slide={slide} onChange={onChange} />
      )}
      {slide.kind === 'finale' && (
        <FinaleForm slide={slide} onChange={onChange} />
      )}
      {slide.kind === 'quote' && (
        <QuoteForm slide={slide} onChange={onChange} />
      )}
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-muted/80 font-bold">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted/60 italic">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full bg-ink/50 border border-line rounded px-2 py-1.5 text-xs text-text focus:border-stage-mastering outline-none'
const textareaCls = inputCls + ' font-mono'
const ICON_OPTIONS: Array<{ value: ConceptIconKey; label: string }> = [
  { value: 'heritage', label: 'Heritage (castle)' },
  { value: 'momentum', label: 'Momentum (chevron)' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'voice', label: 'Voice (speech bubble)' },
  { value: 'target', label: 'Target' },
  { value: 'compass', label: 'Compass' },
  { value: 'spark', label: 'Spark / idea' },
  { value: 'pulse', label: 'Pulse / heartbeat' },
]

function CoverForm({ slide, onChange }: {
  slide: Extract<SlideSpec, { kind: 'cover' }>
  onChange: (next: SlideSpec) => void
}) {
  return (
    <>
      <Field label="Eyebrow" hint="Small line above the title — e.g. 'Episode 12'">
        <input
          className={inputCls}
          value={slide.eyebrow ?? ''}
          onChange={(e) => onChange({ ...slide, eyebrow: e.target.value })}
        />
      </Field>
      <Field label="Title">
        <textarea
          className={textareaCls}
          rows={2}
          value={slide.title}
          onChange={(e) => onChange({ ...slide, title: e.target.value })}
        />
      </Field>
    </>
  )
}

function ThesisForm({ slide, onChange }: {
  slide: Extract<SlideSpec, { kind: 'thesis' }>
  onChange: (next: SlideSpec) => void
}) {
  const layout = slide.diagram?.layout ?? 'none'
  function updateDiagram(patch: Partial<NonNullable<typeof slide.diagram>>) {
    const current = slide.diagram ?? {
      layout: 'two-circle' as const,
      nodes: [
        { icon: 'heritage' as ConceptIconKey, label: '', tone: 'primary' as const },
        { icon: 'momentum' as ConceptIconKey, label: '', tone: 'secondary' as const },
      ],
    }
    onChange({ ...slide, diagram: { ...current, ...patch } })
  }
  function updateNode(idx: 0 | 1, patch: Partial<NonNullable<typeof slide.diagram>['nodes'][0]>) {
    if (!slide.diagram) return
    const nodes = slide.diagram.nodes.map((n, i) => i === idx ? { ...n, ...patch } : n)
    onChange({ ...slide, diagram: { ...slide.diagram, nodes: nodes as typeof slide.diagram.nodes } })
  }
  return (
    <>
      <Field label="Headline" hint="The full sentence. The accent suffix below picks the colored chunk.">
        <textarea
          className={textareaCls}
          rows={2}
          value={slide.headline}
          onChange={(e) => onChange({ ...slide, headline: e.target.value })}
        />
      </Field>
      <Field label="Accent suffix" hint="MUST be the end of the headline — gets primary color">
        <input
          className={inputCls}
          value={slide.accent}
          onChange={(e) => onChange({ ...slide, accent: e.target.value })}
        />
      </Field>
      <Field label="Body (optional)">
        <textarea
          className={textareaCls}
          rows={3}
          value={slide.body ?? ''}
          onChange={(e) => onChange({ ...slide, body: e.target.value || undefined })}
        />
      </Field>
      <Field label="Diagram">
        <select
          className={inputCls}
          value={layout}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'none') onChange({ ...slide, diagram: undefined })
            else updateDiagram({ layout: v as 'two-circle' | 'three-stage' })
          }}
        >
          <option value="none">None</option>
          <option value="two-circle">Two-circle (opposed concepts)</option>
          <option value="three-stage">Three-stage (old → bridge → new)</option>
        </select>
      </Field>
      {slide.diagram && (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg bg-ink/40 p-2 space-y-1.5">
              <p className="text-[9px] uppercase tracking-wider font-bold text-muted">
                Node {i === 0 ? 'A (primary)' : 'B (secondary)'}
              </p>
              <select
                className={inputCls}
                value={slide.diagram!.nodes[i].icon}
                onChange={(e) => updateNode(i as 0 | 1, { icon: e.target.value as ConceptIconKey })}
              >
                {ICON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                className={inputCls}
                placeholder="Label"
                value={slide.diagram!.nodes[i].label}
                onChange={(e) => updateNode(i as 0 | 1, { label: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="Sub (optional, e.g. (the past))"
                value={slide.diagram!.nodes[i].sub ?? ''}
                onChange={(e) => updateNode(i as 0 | 1, { sub: e.target.value || undefined })}
              />
            </div>
          ))}
          <div className="col-span-2 rounded-lg bg-ink/40 p-2 space-y-1.5">
            <p className="text-[9px] uppercase tracking-wider font-bold text-muted">Midpoint (optional)</p>
            <input
              className={inputCls}
              placeholder="Label e.g. The Choice"
              value={slide.diagram.midpoint?.label ?? ''}
              onChange={(e) => updateDiagram({
                midpoint: e.target.value
                  ? { label: e.target.value, sub: slide.diagram?.midpoint?.sub }
                  : undefined,
              })}
            />
            <input
              className={inputCls}
              placeholder="Sub e.g. (right now)"
              value={slide.diagram.midpoint?.sub ?? ''}
              onChange={(e) => updateDiagram({
                midpoint: slide.diagram?.midpoint
                  ? { ...slide.diagram.midpoint, sub: e.target.value || undefined }
                  : undefined,
              })}
            />
          </div>
        </div>
      )}
    </>
  )
}

function CalloutForm({ slide, onChange }: {
  slide: Extract<SlideSpec, { kind: 'callout' }>
  onChange: (next: SlideSpec) => void
}) {
  function updateTrait(i: 0 | 1 | 2, patch: { icon?: ConceptIconKey; word?: string }) {
    const traits = (slide.traits ?? []).slice()
    while (traits.length < 3) traits.push({ icon: 'heritage', word: '' })
    traits[i] = { ...traits[i], ...patch }
    onChange({ ...slide, traits: traits.slice(0, 3) })
  }
  return (
    <>
      <Field label="Headline">
        <textarea className={textareaCls} rows={2}
          value={slide.headline}
          onChange={(e) => onChange({ ...slide, headline: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Accent (primary)" hint="Suffix → primary color">
          <input className={inputCls} value={slide.accent}
            onChange={(e) => onChange({ ...slide, accent: e.target.value })} />
        </Field>
        <Field label="Accent secondary" hint="Trailing suffix → secondary color">
          <input className={inputCls} value={slide.accentSecondary ?? ''}
            onChange={(e) => onChange({ ...slide, accentSecondary: e.target.value || undefined })} />
        </Field>
      </div>
      <Field label="Body (optional)">
        <textarea className={textareaCls} rows={3} value={slide.body ?? ''}
          onChange={(e) => onChange({ ...slide, body: e.target.value || undefined })} />
      </Field>
      <p className="text-[10px] uppercase tracking-wider text-muted/80 font-bold">Traits</p>
      <div className="space-y-1.5">
        {([0, 1, 2] as const).map((i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr] gap-2">
            <select className={inputCls}
              value={slide.traits?.[i]?.icon ?? 'heritage'}
              onChange={(e) => updateTrait(i, { icon: e.target.value as ConceptIconKey })}>
              {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input className={inputCls}
              placeholder="Word, e.g. Real."
              value={slide.traits?.[i]?.word ?? ''}
              onChange={(e) => updateTrait(i, { word: e.target.value })} />
          </div>
        ))}
      </div>
    </>
  )
}

function BrandCalloutForm({ slide, onChange }: {
  slide: Extract<SlideSpec, { kind: 'brand-callout' }>
  onChange: (next: SlideSpec) => void
}) {
  return (
    <>
      <Field label="Headline">
        <textarea className={textareaCls} rows={2} value={slide.headline}
          onChange={(e) => onChange({ ...slide, headline: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Accent (primary)">
          <input className={inputCls} value={slide.accent}
            onChange={(e) => onChange({ ...slide, accent: e.target.value })} />
        </Field>
        <Field label="Accent secondary">
          <input className={inputCls} value={slide.accentSecondary ?? ''}
            onChange={(e) => onChange({ ...slide, accentSecondary: e.target.value || undefined })} />
        </Field>
      </div>
      <Field label="Brand label" hint="Shown in the brand mark / placeholder">
        <input className={inputCls} value={slide.brandLabel ?? ''}
          onChange={(e) => onChange({ ...slide, brandLabel: e.target.value || undefined })} />
      </Field>
      <Field label="Body paragraphs" hint="One paragraph per line. Each gets a primary accent rule above it.">
        <textarea className={textareaCls} rows={4}
          value={slide.bodyParagraphs.join('\n')}
          onChange={(e) => onChange({ ...slide, bodyParagraphs: e.target.value.split('\n') })} />
      </Field>
      <Field label="Final line (secondary color)">
        <input className={inputCls} value={slide.finalLine ?? ''}
          onChange={(e) => onChange({ ...slide, finalLine: e.target.value || undefined })} />
      </Field>
    </>
  )
}

function FinaleForm({ slide, onChange }: {
  slide: Extract<SlideSpec, { kind: 'finale' }>
  onChange: (next: SlideSpec) => void
}) {
  return (
    <>
      <Field label="Lesson headline" hint="Ends with ':' — the colon renders in primary">
        <input className={inputCls} value={slide.lessonHeadline ?? 'The Lesson:'}
          onChange={(e) => onChange({ ...slide, lessonHeadline: e.target.value })} />
      </Field>
      <Field label="Lesson body">
        <textarea className={textareaCls} rows={4} value={slide.lessonBody}
          onChange={(e) => onChange({ ...slide, lessonBody: e.target.value })} />
      </Field>
      <Field label="Tagline (primary color)">
        <input className={inputCls} value={slide.tagline ?? ''}
          onChange={(e) => onChange({ ...slide, tagline: e.target.value || undefined })} />
      </Field>
    </>
  )
}

function QuoteForm({ slide, onChange }: {
  slide: Extract<SlideSpec, { kind: 'quote' }>
  onChange: (next: SlideSpec) => void
}) {
  return (
    <>
      <Field label="Quote text">
        <textarea className={textareaCls} rows={4} value={slide.text}
          onChange={(e) => onChange({ ...slide, text: e.target.value })} />
      </Field>
      <Field label="Speaker (optional)">
        <input className={inputCls} value={slide.speaker ?? ''}
          onChange={(e) => onChange({ ...slide, speaker: e.target.value || undefined })} />
      </Field>
    </>
  )
}
