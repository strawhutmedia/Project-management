// Dev / design-review page for the new podcast carousel renderer.
// Renders the sampleSoulAndScienceDeck() at full size so the team can
// confirm the visual matches the reference screenshots before we wire
// up Claude + the per-show preset config.
//
// Mounted at /carousel-preview while we iterate. Once the feature
// ships in SocialsSection, this page can stick around as the
// "design lab" view.
import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  renderDeckSlideCanvas,
  sampleSoulAndScienceDeck,
  SOUL_AND_SCIENCE_PRESET,
  canvasToBlob,
} from '../lib/carouselDeckImage'

export default function CarouselPreviewPage() {
  const slides = sampleSoulAndScienceDeck()
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-text">Carousel renderer — design preview</h1>
        <p className="text-sm text-muted">
          Sample deck for <span className="font-bold text-text">Soul &amp; Science</span>.
          Compare side-by-side with the reference screenshots — if the type and color land,
          we’ll wire the per-show preset config and the Claude transcript prompt next.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {slides.map((slide, i) => (
          <SlidePreview
            key={i}
            slide={slide}
            index={i + 1}
            total={slides.length}
          />
        ))}
      </div>

      <DownloadButton />
    </div>
  )
}

function SlidePreview({ slide, index, total }: { slide: ReturnType<typeof sampleSoulAndScienceDeck>[number]; index: number; total: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const canvas = renderDeckSlideCanvas(
      { preset: SOUL_AND_SCIENCE_PRESET, slide, index, total },
      { fullSize: false },
    )
    ref.current.innerHTML = ''
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = 'auto'
    canvas.style.borderRadius = '14px'
    ref.current.appendChild(canvas)
  }, [slide, index, total])
  return (
    <div className="space-y-2">
      <div ref={ref} className="bg-black rounded-2xl overflow-hidden shadow-lg" />
      <p className="text-[10px] uppercase tracking-wider text-muted">
        Slide {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')} — {slide.kind}
      </p>
    </div>
  )
}

function DownloadButton() {
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      const slides = sampleSoulAndScienceDeck()
      const zip = new JSZip()
      for (let i = 0; i < slides.length; i++) {
        const canvas = renderDeckSlideCanvas(
          { preset: SOUL_AND_SCIENCE_PRESET, slide: slides[i], index: i + 1, total: slides.length },
          { fullSize: true },
        )
        const blob = await canvasToBlob(canvas, 'image/png')
        zip.file(`soul-and-science-${String(i + 1).padStart(2, '0')}.png`, blob)
      }
      const out = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(out)
      const a = document.createElement('a')
      a.href = url
      a.download = 'soul-and-science-sample-carousel.zip'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={() => void download()}
      disabled={busy}
      className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[11px] px-4 py-2.5 disabled:opacity-50"
    >
      {busy ? 'Bundling…' : '↓ Download all 4 slides as ZIP (full-size 1080×1350)'}
    </button>
  )
}
