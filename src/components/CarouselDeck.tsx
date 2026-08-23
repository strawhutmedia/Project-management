// Reusable deck-rendering UI for the carousel feature. Used by:
//   - /carousel-preview (design lab page)
//   - SocialsSection (per-episode "Generate carousel" flow)
//
// Drop in `<DeckGrid preset={...} slides={...} />` with the AI-
// generated slides + the show's brand preset. The grid renders every
// slide as a live <canvas>, supports per-slide editing via an ✎ Edit
// button, and offers a "Download ZIP" of all slides at full 1080×1350
// resolution.
//
// Code moved verbatim from src/pages/CarouselPreviewPage.tsx so both
// surfaces share the same edit + render behavior. Future changes go
// here, not duplicated in either caller.
import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import {
  renderDeckSlideCanvas,
  preloadDeckImages,
  canvasToBlob,
  type ShowDeckPreset,
  type SlideSpec,
  type ConceptIconKey,
} from '../lib/carouselDeckImage'

export function DeckGrid({ preset, slides }: { preset: ShowDeckPreset; slides: SlideSpec[] }) {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const [busy, setBusy] = useState(false)
  const [editedSlides, setEditedSlides] = useState<SlideSpec[]>(slides)
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

  // LinkedIn carousels are DOCUMENT posts — one multi-page PDF, not a
  // set of images. Same 1080×1350 slides, bundled as PDF pages (JPEG
  // inside to keep the file well under LinkedIn's 100MB cap).
  async function downloadLinkedInPdf() {
    setBusy(true)
    try {
      const pdf = new jsPDF({ unit: 'px', format: [1080, 1350], orientation: 'portrait' })
      for (let i = 0; i < editedSlides.length; i++) {
        const canvas = renderDeckSlideCanvas(
          { preset, slide: editedSlides[i], index: i + 1, total: editedSlides.length, images },
          { fullSize: true },
        )
        if (i > 0) pdf.addPage([1080, 1350], 'portrait')
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1080, 1350)
      }
      pdf.save(`${preset.key}-carousel-linkedin.pdf`)
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void downloadZip()}
          disabled={busy}
          className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2.5 disabled:opacity-50"
        >
          {busy ? 'Bundling…' : `↓ ${editedSlides.length} PNGs as ZIP (Instagram)`}
        </button>
        <button
          onClick={() => void downloadLinkedInPdf()}
          disabled={busy}
          className="rounded-lg bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2.5 disabled:opacity-50"
        >
          {busy ? 'Bundling…' : '↓ One PDF (LinkedIn document post)'}
        </button>
      </div>
    </div>
  )
}

function SlidePreview({
  slide, originalSlide, preset, images, index, total, onChange, onReset,
}: {
  slide: SlideSpec
  originalSlide?: SlideSpec
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

function EditSlideForm({ slide, onChange }: {
  slide: SlideSpec
  onChange: (next: SlideSpec) => void
}) {
  return (
    <div className="rounded-xl border border-stage-mastering/30 bg-stage-mastering/5 p-3 space-y-2 text-xs">
      {slide.kind === 'cover'         && <CoverForm        slide={slide} onChange={onChange} />}
      {slide.kind === 'thesis'        && <ThesisForm       slide={slide} onChange={onChange} />}
      {slide.kind === 'callout'       && <CalloutForm      slide={slide} onChange={onChange} />}
      {slide.kind === 'brand-callout' && <BrandCalloutForm slide={slide} onChange={onChange} />}
      {slide.kind === 'finale'        && <FinaleForm       slide={slide} onChange={onChange} />}
      {slide.kind === 'quote'         && <QuoteForm        slide={slide} onChange={onChange} />}
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
        <textarea className={textareaCls} rows={2} value={slide.headline}
          onChange={(e) => onChange({ ...slide, headline: e.target.value })} />
      </Field>
      <Field label="Accent suffix" hint="MUST be the end of the headline — gets primary color">
        <input className={inputCls} value={slide.accent}
          onChange={(e) => onChange({ ...slide, accent: e.target.value })} />
      </Field>
      <Field label="Body (optional)">
        <textarea className={textareaCls} rows={3} value={slide.body ?? ''}
          onChange={(e) => onChange({ ...slide, body: e.target.value || undefined })} />
      </Field>
      <Field label="Diagram">
        <select className={inputCls} value={layout}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'none') onChange({ ...slide, diagram: undefined })
            else updateDiagram({ layout: v as 'two-circle' | 'three-stage' })
          }}>
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
              <select className={inputCls}
                value={slide.diagram!.nodes[i].icon}
                onChange={(e) => updateNode(i as 0 | 1, { icon: e.target.value as ConceptIconKey })}>
                {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input className={inputCls} placeholder="Label"
                value={slide.diagram!.nodes[i].label}
                onChange={(e) => updateNode(i as 0 | 1, { label: e.target.value })} />
              <input className={inputCls} placeholder="Sub (optional, e.g. (the past))"
                value={slide.diagram!.nodes[i].sub ?? ''}
                onChange={(e) => updateNode(i as 0 | 1, { sub: e.target.value || undefined })} />
            </div>
          ))}
          <div className="col-span-2 rounded-lg bg-ink/40 p-2 space-y-1.5">
            <p className="text-[9px] uppercase tracking-wider font-bold text-muted">Midpoint (optional)</p>
            <input className={inputCls} placeholder="Label e.g. The Choice"
              value={slide.diagram.midpoint?.label ?? ''}
              onChange={(e) => updateDiagram({
                midpoint: e.target.value
                  ? { label: e.target.value, sub: slide.diagram?.midpoint?.sub }
                  : undefined,
              })} />
            <input className={inputCls} placeholder="Sub e.g. (right now)"
              value={slide.diagram.midpoint?.sub ?? ''}
              onChange={(e) => updateDiagram({
                midpoint: slide.diagram?.midpoint
                  ? { ...slide.diagram.midpoint, sub: e.target.value || undefined }
                  : undefined,
              })} />
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
        <textarea className={textareaCls} rows={2} value={slide.headline}
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
            <input className={inputCls} placeholder="Word, e.g. Real."
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
