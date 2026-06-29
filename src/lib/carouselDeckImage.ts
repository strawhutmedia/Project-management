// Per-episode social carousel renderer. Each call paints ONE
// 1080×1350 portrait slide of a multi-slide deck (e.g. 02/07).
//
// Visual system is modeled after the Soul & Science decks: dark
// background, two-color accent palette, big condensed sans display
// type with a "punchline" word in the accent color, optional concept
// diagram (heritage / momentum / bridge), small body block on the
// right, dot-wave at the bottom, show logo lockup top-left, page
// indicator top-right.
//
// Per-show config is passed in as a ShowDeckPreset so the same
// renderer serves every podcast — palette, logo lockup, fonts, and
// the available concept-icon vocabulary are all preset-driven. v0
// ships with a hardcoded Soul & Science preset so we can validate
// the look before wiring up persistence.

const DISPLAY_RATIO = 0.45
const FULL_W = 1080
const FULL_H = 1350

// ============================================================
// Public types
// ============================================================

export type ShowDeckPreset = {
  // Stable identifier (used by the server endpoint + UI selector).
  key: string
  // Display name in the show selector.
  displayName: string
  // Tagline / format like "WITH JASON HARRIS" — shown above the host
  // photo on the finale slide. Optional.
  hostTagline?: string
  // Logo lockup as a two-line word mark. "name1" sits on top in the
  // primary color, "name2" beneath it in the secondary. Renders to
  // 56pt condensed black, slight kerning. Mirrors the SOUL&/SCIENCE
  // stack from the example deck.
  logo: {
    name1: string
    name2: string
    weight?: 'black' | 'bold'
  }
  palette: {
    primary: string    // accent for headlines / punchline words / "old" diagram
    secondary: string  // accent for "new" / future / contrast
    bg: string         // background, near-black
    ink: string        // body text on bg, near-white
    inkDim: string     // muted secondary text
  }
  // Optional asset URLs. When present, the renderer overlays them in
  // the right places (host photo on finale, replacing the canvas-drawn
  // logo wordmark, etc.). Caller is responsible for preloading them.
  assets?: {
    logoLockupUrl?: string     // PNG/SVG to replace top-left wordmark
    hostPhotoUrl?: string      // square portrait, ideally transparent
    platforms?: Array<{        // shown on the finale strip
      name: string             // "Apple Podcasts" / "Spotify" / "YouTube"
      iconUrl: string          // 64×64+ icon
    }>
  }
}

export type SlideSpec =
  | { kind: 'cover'; title: string; eyebrow?: string; photoUrl?: string }
  | {
      kind: 'thesis'
      headline: string                  // main headline (will be uppercased)
      accent: string                    // suffix of headline that renders in primary accent
      body?: string                     // optional right-side / lower body paragraph(s)
      diagram?: DiagramSpec             // optional concept diagram
      brandMark?: { label: string }     // optional subject-brand logo placeholder at bottom
    }
  | {
      kind: 'callout'                   // three-icon row + 3 trait words (slide 4 in the example)
      headline: string
      accent: string                    // last segment in primary, "STARTS WITH"
      accentSecondary?: string          // last segment in secondary, "CLARITY."
      body?: string
      traits?: Array<{ icon: ConceptIconKey; word: string }>
      brandMark?: { label: string }
    }
  | { kind: 'quote'; text: string; speaker?: string }
  | {
      // Brand-callout used when an episode references a specific
      // outside brand (Tripadvisor / Lands' End / White Castle / etc.).
      // The body is a multi-paragraph "rule-separated" stack on the
      // left, with an optional collage image on the right. Two-tier
      // accent coloring on the headline.
      kind: 'brand-callout'
      headline: string                  // e.g. "MEET TRAVELERS WHERE THEY ALREADY ARE."
      accent: string                    // primary-colored chunk, e.g. "WHERE THEY"
      accentSecondary?: string          // secondary-colored chunk, e.g. "ALREADY ARE."
      bodyParagraphs: string[]          // each renders as its own block with a rule above
      finalLine?: string                // the bottom-line callout in secondary color
      collageImageKey?: string          // key into the preloaded images map
      brandLabel?: string               // text label of the brand (footer)
    }
  | {
      // Episode finale — slide 7 in the reference deck. Host photo
      // top-right inside a thin primary-colored frame, "THE LESSON:"
      // headline, body, primary-colored tagline, then a "Listen to
      // <show> wherever you stream podcasts." strip with the show
      // platforms.
      kind: 'finale'
      lessonHeadline?: string           // defaults to "THE LESSON:"
      lessonBody: string                // multi-line body paragraph
      tagline?: string                  // primary color, e.g. "Realness. Relevance. Resonance."
    }

export type ConceptIconKey =
  | 'heritage'   // castle (legacy / past)
  | 'momentum'   // chevron in circle (future / new)
  | 'bridge'     // arched bridge (the work)
  | 'voice'      // speech bubble (audience)
  | 'target'     // concentric target (resonance)
  | 'compass'    // direction
  | 'spark'      // idea / lightbulb
  | 'pulse'      // heartbeat / momentum line

export type DiagramSpec = {
  layout: 'two-circle' | 'three-stage'
  nodes: Array<{
    icon: ConceptIconKey
    label: string       // big label under the icon, e.g. "HERITAGE"
    sub?: string        // small parenthetical, e.g. "(THE PAST)"
    tone: 'primary' | 'secondary' | 'neutral'
  }>
  midpoint?: {
    label: string       // e.g. "THE CHOICE"
    sub?: string        // e.g. "(RIGHT NOW)"
  }
}

export type DeckRenderInput = {
  preset: ShowDeckPreset
  slide: SlideSpec
  index: number     // 1-based
  total: number     // total slides in the deck
  // Pre-loaded asset images keyed by URL or asset key. Renderer is
  // synchronous; caller should preloadDeckImages() before rendering.
  images?: Map<string, HTMLImageElement>
}

// ============================================================
// Hardcoded preset for v0 (Soul & Science).
// Once the preset config UI exists, this becomes a default fallback.
// ============================================================
export const SOUL_AND_SCIENCE_PRESET: ShowDeckPreset = {
  key: 'soul-and-science',
  displayName: 'Soul & Science',
  hostTagline: 'WITH JASON HARRIS',
  logo: { name1: 'SOUL&', name2: 'SCIENCE', weight: 'black' },
  palette: {
    primary:   '#E91E47',
    secondary: '#22B6D9',
    bg:        '#0A0B0F',
    ink:       '#FFFFFF',
    inkDim:    '#A0A6B0',
  },
}

// All built-in show presets. Once the preset-config UI lands, this
// becomes the seed/fallback list and per-show overrides live in the
// database.
export const BUILT_IN_PRESETS: ShowDeckPreset[] = [SOUL_AND_SCIENCE_PRESET]

export function findPreset(key: string): ShowDeckPreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.key === key)
}

// ============================================================
// Render entry point
// ============================================================
export function renderDeckSlideCanvas(
  input: DeckRenderInput,
  opts: { fullSize: boolean } = { fullSize: false },
): HTMLCanvasElement {
  const W = opts.fullSize ? FULL_W : Math.round(FULL_W * DISPLAY_RATIO)
  const H = opts.fullSize ? FULL_H : Math.round(FULL_H * DISPLAY_RATIO)
  const scale = W / FULL_W
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  drawBackground(ctx, W, H, input.preset)
  drawLogoLockup(ctx, scale, input.preset, input.images)
  drawPageIndicator(ctx, W, scale, input.preset, input.index, input.total)
  drawDotWave(ctx, W, H, scale, input.preset)

  switch (input.slide.kind) {
    case 'cover':         drawCoverSlide(ctx, W, H, scale, input.slide, input.preset); break
    case 'thesis':        drawThesisSlide(ctx, W, H, scale, input.slide, input.preset); break
    case 'callout':       drawCalloutSlide(ctx, W, H, scale, input.slide, input.preset); break
    case 'quote':         drawQuoteSlide(ctx, W, H, scale, input.slide, input.preset); break
    case 'brand-callout': drawBrandCalloutSlide(ctx, W, H, scale, input.slide, input.preset, input.images); break
    case 'finale':        drawFinaleSlide(ctx, W, H, scale, input.slide, input.preset, input.images); break
  }
  return canvas
}

// Preload every asset referenced by the preset + slide list. Returns a
// Map keyed by URL → HTMLImageElement, ready to pass into render input.
// Failures resolve to a Map missing that key; renderer falls back to
// canvas-drawn placeholders.
export async function preloadDeckImages(
  preset: ShowDeckPreset, slides: SlideSpec[],
): Promise<Map<string, HTMLImageElement>> {
  const urls = new Set<string>()
  if (preset.assets?.logoLockupUrl) urls.add(preset.assets.logoLockupUrl)
  if (preset.assets?.hostPhotoUrl) urls.add(preset.assets.hostPhotoUrl)
  for (const p of preset.assets?.platforms ?? []) {
    if (p.iconUrl) urls.add(p.iconUrl)
  }
  for (const s of slides) {
    if (s.kind === 'brand-callout' && s.collageImageKey) urls.add(s.collageImageKey)
    if (s.kind === 'cover' && s.photoUrl) urls.add(s.photoUrl)
  }
  const map = new Map<string, HTMLImageElement>()
  await Promise.all(
    [...urls].map((url) => new Promise<void>((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve() } }
      setTimeout(done, 6000)
      img.onload = () => { map.set(url, img); done() }
      img.onerror = () => done()
      img.src = url
    })),
  )
  return map
}

// ============================================================
// Background, logo, page indicator, dot wave (shared chrome)
// ============================================================
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, preset: ShowDeckPreset) {
  ctx.fillStyle = preset.palette.bg
  ctx.fillRect(0, 0, W, H)
}

function drawLogoLockup(
  ctx: CanvasRenderingContext2D, s: number, preset: ShowDeckPreset,
  images?: Map<string, HTMLImageElement>,
) {
  const x = 70 * s
  const y = 70 * s
  // If the show uploaded a real wordmark asset, prefer that — better
  // edges and exact kerning than Helvetica Black.
  const logoUrl = preset.assets?.logoLockupUrl
  const img = logoUrl ? images?.get(logoUrl) : null
  if (img) {
    const h = 130 * s
    const w = (img.width / img.height) * h
    ctx.drawImage(img, x, y, w, h)
    return
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const size = 52 * s
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  ctx.font = `900 ${size}px ${family}`
  ctx.fillStyle = preset.palette.primary
  ctx.fillText(preset.logo.name1, x, y)
  ctx.fillStyle = preset.palette.secondary
  ctx.fillText(preset.logo.name2, x, y + size * 0.95)
}

function drawPageIndicator(
  ctx: CanvasRenderingContext2D, W: number, s: number,
  preset: ShowDeckPreset, index: number, total: number,
) {
  const right = W - 70 * s
  const top = 80 * s
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const txt = `${String(index).padStart(2, '0')}/${String(total).padStart(2, '0')}`
  ctx.font = `700 ${28 * s}px ${family}`
  ctx.fillStyle = preset.palette.ink
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(txt, right, top)
  ctx.strokeStyle = preset.palette.primary
  ctx.lineWidth = 4 * s
  ctx.beginPath()
  ctx.moveTo(right - 50 * s, top + 38 * s)
  ctx.lineTo(right, top + 38 * s)
  ctx.stroke()
}

// Two clouds of dots curving up from the bottom corners — primary on
// the left, secondary on the right. Mirrors the wave at the bottom of
// every Soul & Science slide.
function drawDotWave(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number, preset: ShowDeckPreset,
) {
  const dotR = 3 * s
  const gap = 14 * s
  const rows = 6
  const cols = Math.floor(W / gap) + 2
  const baseY = H - 30 * s
  // Compute each dot's row offset so the whole field curves down from
  // the centerline outward (like the Soul & Science wave).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * gap
      const dx = (x - W / 2) / (W / 2)
      const curve = Math.pow(Math.abs(dx), 2.2) * 80 * s
      const y = baseY - r * gap - curve
      // Skip dots above a threshold so the wave fades vertically.
      if (y < H - 230 * s + r * 4 * s) continue
      ctx.fillStyle = dx < 0 ? preset.palette.primary : preset.palette.secondary
      ctx.globalAlpha = 1 - r / (rows + 2)
      ctx.beginPath()
      ctx.arc(x, y, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

// ============================================================
// Slide: COVER
// ============================================================
function drawCoverSlide(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  slide: Extract<SlideSpec, { kind: 'cover' }>, preset: ShowDeckPreset,
) {
  // Big eyebrow → title block, left-aligned, vertically centered.
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const x = 70 * s
  if (slide.eyebrow) {
    ctx.font = `700 ${28 * s}px ${family}`
    ctx.fillStyle = preset.palette.primary
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(slide.eyebrow.toUpperCase(), x, H * 0.38)
  }
  ctx.fillStyle = preset.palette.ink
  ctx.textAlign = 'left'
  drawWrappedAutoFit(ctx, slide.title.toUpperCase(), {
    x: x + (W - x * 2) / 2,
    y: H * 0.55,
    maxWidth: W - x * 2,
    maxHeight: H * 0.4,
    maxFontPx: 140 * s,
    minFontPx: 64 * s,
    fontFamily: family,
    fontWeight: '900',
    lineHeightRatio: 0.98,
    alignLeft: true,
    letterSpacing: -0.02,
  })
}

// ============================================================
// Slide: THESIS (main slide kind — slides 2 + 3 of the example deck)
// ============================================================
function drawThesisSlide(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  slide: Extract<SlideSpec, { kind: 'thesis' }>, preset: ShowDeckPreset,
) {
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const padX = 70 * s

  // Headline takes the upper half. Body + diagram share the lower
  // half. The accent suffix renders in the primary color; everything
  // before it renders in white.
  const head = slide.headline.toUpperCase()
  const acc = slide.accent.toUpperCase()
  // Try to split: if head ends with acc, the prefix gets white & acc gets red.
  const prefix = head.endsWith(acc) ? head.slice(0, head.length - acc.length).trimEnd() : head
  const suffix = head.endsWith(acc) ? acc : ''

  const headlineTop = 200 * s
  const headlineBottom = slide.body || slide.diagram ? H * 0.58 : H - 200 * s
  const headlineMax = headlineBottom - headlineTop

  // Word-wrap both parts as a single block, but recolor when we hit
  // the suffix words. Implementation: compute font size that fits the
  // whole combined string, then redraw line-by-line with per-word
  // color.
  const combined = prefix + (suffix ? ' ' + suffix : '')
  const sized = sizeForWrap(ctx, combined, {
    maxWidth: W - padX * 2,
    maxHeight: headlineMax,
    maxFontPx: 130 * s,
    minFontPx: 60 * s,
    fontFamily: family,
    fontWeight: '900',
    lineHeightRatio: 0.98,
  })
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lineH = sized.fontPx * 0.98
  const suffixWords = new Set(suffix.split(/\s+/).filter(Boolean))
  let cursorY = headlineTop
  for (const line of sized.lines) {
    let cursorX = padX
    const words = line.split(' ')
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      ctx.font = `900 ${sized.fontPx}px ${family}`
      ctx.fillStyle = suffixWords.has(w) ? preset.palette.primary : preset.palette.ink
      ctx.fillText(w, cursorX, cursorY)
      cursorX += ctx.measureText(w).width + ctx.measureText(' ').width
    }
    cursorY += lineH
  }

  // Body block — right column under the headline (slide 3 style) OR
  // bottom-left (slide 2 style).
  const bodyY = headlineBottom + 20 * s
  if (slide.body) {
    const bodyText = slide.body.trim()
    const isShortLayout = bodyText.length < 120 && !slide.diagram
    ctx.fillStyle = preset.palette.ink
    ctx.textAlign = 'left'
    drawWrappedAutoFit(ctx, bodyText, {
      x: padX + (W - padX * 2) / 2,
      y: bodyY + 80 * s,
      maxWidth: isShortLayout ? W - padX * 2 : (W - padX * 2) * 0.45,
      maxHeight: 200 * s,
      maxFontPx: 28 * s,
      minFontPx: 18 * s,
      fontFamily: family,
      fontWeight: '500',
      lineHeightRatio: 1.3,
      alignLeft: true,
    })
    // Thin accent rule above the body
    ctx.strokeStyle = preset.palette.primary
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(padX, bodyY + 30 * s)
    ctx.lineTo(padX + 50 * s, bodyY + 30 * s)
    ctx.stroke()
  }

  // Diagram, if present — anchored bottom-right of the body half, or
  // full-width for "three-stage" layouts.
  if (slide.diagram) {
    drawDiagram(ctx, W, H, s, slide.diagram, preset)
  }

  // Optional subject-brand mark at the bottom-center (e.g. White Castle)
  if (slide.brandMark) {
    drawBrandMark(ctx, W, H, s, slide.brandMark.label, preset)
  }
}

// ============================================================
// Slide: CALLOUT (icon-row trait list, slide 4 of the example)
// ============================================================
function drawCalloutSlide(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  slide: Extract<SlideSpec, { kind: 'callout' }>, preset: ShowDeckPreset,
) {
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const padX = 70 * s
  const head = slide.headline.toUpperCase()
  const acc = slide.accent.toUpperCase()
  const acc2 = (slide.accentSecondary ?? '').toUpperCase()
  // Slice off accent2 first, then accent.
  let body = head
  let lastChunkColor: string | null = null
  if (acc2 && body.endsWith(acc2)) { body = body.slice(0, body.length - acc2.length).trimEnd(); lastChunkColor = preset.palette.secondary }
  let secondChunkColor: string | null = null
  if (acc && body.endsWith(acc)) { body = body.slice(0, body.length - acc.length).trimEnd(); secondChunkColor = preset.palette.primary }
  const headlineTop = 200 * s
  const combined = [body, acc, acc2].filter(Boolean).join(' ')
  const sized = sizeForWrap(ctx, combined, {
    maxWidth: (W - padX * 2) * 0.55,
    maxHeight: H * 0.5,
    maxFontPx: 110 * s,
    minFontPx: 56 * s,
    fontFamily: family,
    fontWeight: '900',
    lineHeightRatio: 0.98,
  })
  const accWords = new Set(acc.split(/\s+/).filter(Boolean))
  const acc2Words = new Set(acc2.split(/\s+/).filter(Boolean))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lineH = sized.fontPx * 0.98
  let cursorY = headlineTop
  for (const line of sized.lines) {
    let cursorX = padX
    const words = line.split(' ')
    for (const w of words) {
      ctx.font = `900 ${sized.fontPx}px ${family}`
      ctx.fillStyle =
        acc2Words.has(w) ? (lastChunkColor ?? preset.palette.secondary) :
        accWords.has(w)  ? (secondChunkColor ?? preset.palette.primary) :
        preset.palette.ink
      ctx.fillText(w, cursorX, cursorY)
      cursorX += ctx.measureText(w).width + ctx.measureText(' ').width
    }
    cursorY += lineH
  }

  // Right column body
  if (slide.body) {
    const colX = padX + (W - padX * 2) * 0.6
    ctx.strokeStyle = preset.palette.primary
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(colX, headlineTop)
    ctx.lineTo(colX + 60 * s, headlineTop)
    ctx.stroke()
    ctx.fillStyle = preset.palette.ink
    ctx.textAlign = 'left'
    drawWrappedAutoFit(ctx, slide.body, {
      x: colX + (W - colX - padX) / 2,
      y: headlineTop + 130 * s,
      maxWidth: W - colX - padX,
      maxHeight: 260 * s,
      maxFontPx: 32 * s,
      minFontPx: 20 * s,
      fontFamily: family,
      fontWeight: '500',
      lineHeightRatio: 1.35,
      alignLeft: true,
    })
  }

  // Trait row (icon → word, primary first, secondary second, etc.)
  if (slide.traits && slide.traits.length > 0) {
    const startY = H * 0.62
    const iconCol = padX + 280 * s
    const wordCol = padX + 380 * s
    const rowH = 100 * s
    for (let i = 0; i < slide.traits.length; i++) {
      const t = slide.traits[i]
      const cy = startY + i * rowH
      // Connection line between icons (vertical dotted)
      if (i > 0) {
        ctx.strokeStyle = preset.palette.inkDim
        ctx.lineWidth = 2 * s
        ctx.setLineDash([2 * s, 4 * s])
        ctx.beginPath()
        ctx.moveTo(iconCol, cy - rowH + 40 * s)
        ctx.lineTo(iconCol, cy - 30 * s)
        ctx.stroke()
        ctx.setLineDash([])
      }
      const tone = i === 0 ? preset.palette.primary : i === 1 ? preset.palette.secondary : preset.palette.primary
      drawConceptIcon(ctx, iconCol, cy, 36 * s, t.icon, tone, preset)
      ctx.fillStyle = preset.palette.primary
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `900 ${56 * s}px ${family}`
      ctx.fillText(t.word, wordCol, cy)
    }
  }

  if (slide.brandMark) {
    drawBrandMark(ctx, W, H, s, slide.brandMark.label, preset)
  }
}

// ============================================================
// Slide: QUOTE
// ============================================================
function drawQuoteSlide(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  slide: Extract<SlideSpec, { kind: 'quote' }>, preset: ShowDeckPreset,
) {
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const padX = 100 * s
  // Big opening quote glyph
  ctx.font = `900 ${260 * s}px Georgia, "Playfair Display", serif`
  ctx.fillStyle = preset.palette.primary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('“', padX - 20 * s, 180 * s)

  ctx.fillStyle = preset.palette.ink
  ctx.textAlign = 'left'
  drawWrappedAutoFit(ctx, slide.text, {
    x: padX + (W - padX * 2) / 2,
    y: H / 2 + 40 * s,
    maxWidth: W - padX * 2,
    maxHeight: H * 0.5,
    maxFontPx: 64 * s,
    minFontPx: 32 * s,
    fontFamily: family,
    fontWeight: '700',
    lineHeightRatio: 1.18,
    alignLeft: true,
  })
  if (slide.speaker) {
    ctx.strokeStyle = preset.palette.primary
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(padX, H - 160 * s)
    ctx.lineTo(padX + 40 * s, H - 160 * s)
    ctx.stroke()
    ctx.font = `700 ${24 * s}px ${family}`
    ctx.fillStyle = preset.palette.inkDim
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(slide.speaker.toUpperCase(), padX, H - 140 * s)
  }
}

// ============================================================
// Slide: BRAND-CALLOUT (subject-brand episode anchor — slide 5 in ref)
// ============================================================
function drawBrandCalloutSlide(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  slide: Extract<SlideSpec, { kind: 'brand-callout' }>, preset: ShowDeckPreset,
  images?: Map<string, HTMLImageElement>,
) {
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const padX = 70 * s

  // 3-line headline with two-tier accent (white prefix, primary mid, secondary suffix).
  const head = slide.headline.toUpperCase()
  const acc = slide.accent.toUpperCase()
  const acc2 = (slide.accentSecondary ?? '').toUpperCase()
  let body = head
  if (acc2 && body.endsWith(acc2)) body = body.slice(0, body.length - acc2.length).trimEnd()
  if (acc && body.endsWith(acc)) body = body.slice(0, body.length - acc.length).trimEnd()
  const combined = [body, acc, acc2].filter(Boolean).join(' ')

  const headlineTop = 220 * s
  const leftColW = (W - padX * 2) * 0.55
  const sized = sizeForWrap(ctx, combined, {
    maxWidth: leftColW,
    maxHeight: H * 0.32,
    maxFontPx: 100 * s,
    minFontPx: 54 * s,
    fontFamily: family,
    fontWeight: '900',
    lineHeightRatio: 0.98,
  })
  const accWords = new Set(acc.split(/\s+/).filter(Boolean))
  const acc2Words = new Set(acc2.split(/\s+/).filter(Boolean))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lineH = sized.fontPx * 0.98
  let cursorY = headlineTop
  for (const line of sized.lines) {
    let cursorX = padX
    for (const w of line.split(' ')) {
      ctx.font = `900 ${sized.fontPx}px ${family}`
      ctx.fillStyle =
        acc2Words.has(w) ? preset.palette.secondary :
        accWords.has(w)  ? preset.palette.primary :
        preset.palette.ink
      ctx.fillText(w, cursorX, cursorY)
      cursorX += ctx.measureText(w).width + ctx.measureText(' ').width
    }
    cursorY += lineH
  }

  // Left-column body stack: each paragraph gets a thin primary rule
  // above it. The "finalLine" gets secondary color treatment.
  const bodyTop = headlineTop + sized.lines.length * lineH + 40 * s
  let by = bodyTop
  const colW = leftColW
  for (let i = 0; i < slide.bodyParagraphs.length; i++) {
    // accent rule
    ctx.strokeStyle = preset.palette.primary
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(padX, by - 14 * s)
    ctx.lineTo(padX + 40 * s, by - 14 * s)
    ctx.stroke()
    // paragraph text
    ctx.fillStyle = preset.palette.ink
    ctx.textAlign = 'left'
    const para = slide.bodyParagraphs[i]
    const paraSize = sizeForWrap(ctx, para, {
      maxWidth: colW, maxHeight: 100 * s,
      maxFontPx: 26 * s, minFontPx: 18 * s,
      fontFamily: family, fontWeight: '500', lineHeightRatio: 1.3,
    })
    ctx.font = `500 ${paraSize.fontPx}px ${family}`
    const plh = paraSize.fontPx * 1.3
    paraSize.lines.forEach((ln, li) => {
      ctx.fillText(ln, padX, by + li * plh)
    })
    by += paraSize.lines.length * plh + 30 * s
  }
  if (slide.finalLine) {
    ctx.fillStyle = preset.palette.secondary
    ctx.font = `700 ${28 * s}px ${family}`
    ctx.textAlign = 'left'
    ctx.fillText(slide.finalLine, padX, by)
  }

  // Right column: collage image OR a typographic placeholder card.
  const colX = padX + leftColW + 30 * s
  const colTop = headlineTop
  const colW2 = W - colX - padX
  const colH = H - colTop - 240 * s
  const img = slide.collageImageKey ? images?.get(slide.collageImageKey) : null
  if (img) {
    const aspect = img.width / img.height
    let drawW = colW2, drawH = drawW / aspect
    if (drawH > colH) { drawH = colH; drawW = drawH * aspect }
    const dx = colX + (colW2 - drawW) / 2
    const dy = colTop + (colH - drawH) / 2
    ctx.drawImage(img, dx, dy, drawW, drawH)
  } else {
    // No asset yet → draw a thin-bordered placeholder card hinting at
    // the slot ("BRAND ASSET / [brandLabel]") so the user can see
    // where the upload will land.
    ctx.strokeStyle = `rgba(${hexRgbStr(preset.palette.primary)}, 0.4)`
    ctx.lineWidth = 2 * s
    ctx.setLineDash([10 * s, 8 * s])
    roundRectPath(ctx, colX, colTop, colW2, colH, 20 * s)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = preset.palette.inkDim
    ctx.font = `700 ${16 * s}px ${family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('[ BRAND ASSET ]', colX + colW2 / 2, colTop + colH / 2 - 12 * s)
    if (slide.brandLabel) {
      ctx.font = `900 ${30 * s}px ${family}`
      ctx.fillStyle = preset.palette.ink
      ctx.fillText(slide.brandLabel.toUpperCase(), colX + colW2 / 2, colTop + colH / 2 + 20 * s)
    }
  }
}

// ============================================================
// Slide: FINALE (host headshot + lesson + platforms — slide 7 in ref)
// ============================================================
function drawFinaleSlide(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  slide: Extract<SlideSpec, { kind: 'finale' }>, preset: ShowDeckPreset,
  images?: Map<string, HTMLImageElement>,
) {
  const family = '"Helvetica Neue", "Inter", Arial, sans-serif'
  const padX = 70 * s
  // Frame the upper portion: bordered rect containing the show
  // wordmark (left) and host photo (right).
  const frameY = 180 * s
  const frameH = 440 * s
  const frameW = W - padX * 2
  ctx.strokeStyle = preset.palette.primary
  ctx.lineWidth = 3 * s
  roundRectPath(ctx, padX, frameY, frameW, frameH, 12 * s)
  ctx.stroke()

  // Left half of the frame: big show wordmark + tagline
  const lockupX = padX + 40 * s
  ctx.fillStyle = preset.palette.primary
  ctx.font = `900 ${72 * s}px ${family}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(preset.logo.name1, lockupX, frameY + 80 * s)
  ctx.fillStyle = preset.palette.secondary
  ctx.fillText(preset.logo.name2, lockupX, frameY + 80 * s + 72 * s)
  if (preset.hostTagline) {
    ctx.fillStyle = preset.palette.ink
    ctx.font = `700 ${22 * s}px ${family}`
    ctx.fillText(preset.hostTagline.toUpperCase(), lockupX, frameY + 80 * s + 72 * s * 2 + 18 * s)
  }

  // Right half of the frame: host headshot (preserves aspect, anchored
  // to the right edge, vertically centered).
  const photoUrl = preset.assets?.hostPhotoUrl
  const photoImg = photoUrl ? images?.get(photoUrl) : null
  const photoW = frameW * 0.45
  if (photoImg) {
    const aspect = photoImg.width / photoImg.height
    let dw = photoW, dh = dw / aspect
    if (dh > frameH - 6 * s) { dh = frameH - 6 * s; dw = dh * aspect }
    const dx = padX + frameW - dw - 3 * s
    const dy = frameY + (frameH - dh) / 2
    ctx.save()
    roundRectPath(ctx, padX + 3 * s, frameY + 3 * s, frameW - 6 * s, frameH - 6 * s, 10 * s)
    ctx.clip()
    ctx.drawImage(photoImg, dx, dy, dw, dh)
    ctx.restore()
  } else {
    // Placeholder for the host photo slot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
    const phX = padX + frameW - photoW - 3 * s
    const phY = frameY + 3 * s
    ctx.fillRect(phX, phY, photoW, frameH - 6 * s)
    ctx.fillStyle = preset.palette.inkDim
    ctx.font = `700 ${16 * s}px ${family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('[ HOST PHOTO ]', phX + photoW / 2, phY + (frameH - 6 * s) / 2)
  }

  // "THE LESSON:" headline
  const lessonY = frameY + frameH + 60 * s
  const lessonHead = (slide.lessonHeadline ?? 'THE LESSON:').toUpperCase()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = `900 ${90 * s}px ${family}`
  const colonIdx = lessonHead.lastIndexOf(':')
  if (colonIdx >= 0) {
    const main = lessonHead.slice(0, colonIdx)
    const tail = lessonHead.slice(colonIdx) // ':'
    ctx.fillStyle = preset.palette.ink
    ctx.fillText(main, padX, lessonY)
    const mainW = ctx.measureText(main).width
    ctx.fillStyle = preset.palette.primary
    ctx.fillText(tail, padX + mainW, lessonY)
  } else {
    ctx.fillStyle = preset.palette.ink
    ctx.fillText(lessonHead, padX, lessonY)
  }

  // Thin accent rule under the lesson headline
  ctx.strokeStyle = preset.palette.primary
  ctx.lineWidth = 3 * s
  ctx.beginPath()
  ctx.moveTo(padX, lessonY + 100 * s)
  ctx.lineTo(padX + 50 * s, lessonY + 100 * s)
  ctx.stroke()

  // Lesson body
  ctx.fillStyle = preset.palette.ink
  ctx.font = `500 ${28 * s}px ${family}`
  const bodyLines = wrapLines(ctx, slide.lessonBody, W - padX * 2)
  const bodyLh = 28 * s * 1.35
  ctx.textBaseline = 'top'
  bodyLines.forEach((ln, i) => ctx.fillText(ln, padX, lessonY + 130 * s + i * bodyLh))

  // Tagline (primary)
  if (slide.tagline) {
    const tagY = lessonY + 130 * s + bodyLines.length * bodyLh + 30 * s
    ctx.fillStyle = preset.palette.primary
    ctx.font = `700 ${26 * s}px ${family}`
    ctx.fillText(slide.tagline, padX, tagY)
  }

  // Footer strip: "Listen to <show> wherever you stream podcasts." + platforms
  const footerY = H - 130 * s
  ctx.strokeStyle = preset.palette.inkDim
  ctx.lineWidth = 1 * s
  ctx.globalAlpha = 0.3
  ctx.beginPath()
  ctx.moveTo(padX, footerY - 20 * s)
  ctx.lineTo(W - padX, footerY - 20 * s)
  ctx.stroke()
  ctx.globalAlpha = 1

  // Headphone icon (canvas-drawn)
  drawHeadphoneIcon(ctx, padX + 30 * s, footerY + 28 * s, 28 * s, preset.palette.primary)

  ctx.fillStyle = preset.palette.ink
  ctx.font = `700 ${22 * s}px ${family}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const showWord = preset.displayName
  const intro = 'Listen to '
  const outro = ' wherever you stream podcasts.'
  const introX = padX + 80 * s
  ctx.fillText(intro, introX, footerY + 14 * s)
  const showX = introX + ctx.measureText(intro).width
  ctx.fillStyle = preset.palette.primary
  // Split on '&' to mirror the show palette
  const amp = showWord.indexOf('&')
  if (amp > 0) {
    const left = showWord.slice(0, amp).trim()
    const right = showWord.slice(amp + 1).trim()
    ctx.fillStyle = preset.palette.primary
    ctx.fillText(left, showX, footerY + 14 * s)
    const leftW = ctx.measureText(left).width
    ctx.fillStyle = preset.palette.ink
    ctx.fillText(' & ', showX + leftW, footerY + 14 * s)
    const ampW = ctx.measureText(' & ').width
    ctx.fillStyle = preset.palette.secondary
    ctx.fillText(right, showX + leftW + ampW, footerY + 14 * s)
    const rightW = ctx.measureText(right).width
    ctx.fillStyle = preset.palette.inkDim
    ctx.font = `500 ${20 * s}px ${family}`
    ctx.fillText(outro, showX + leftW + ampW + rightW, footerY + 14 * s)
    // Second line — "wherever you stream podcasts."
  } else {
    ctx.fillText(showWord, showX, footerY + 14 * s)
    ctx.fillStyle = preset.palette.inkDim
    ctx.font = `500 ${20 * s}px ${family}`
    ctx.fillText(outro, showX + ctx.measureText(showWord).width, footerY + 14 * s)
  }

  // Platform icons on the right
  const platforms = preset.assets?.platforms ?? []
  const iconSize = 56 * s
  const iconGap = 16 * s
  let px = W - padX - iconSize
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i]
    const pImg = images?.get(p.iconUrl)
    if (pImg) {
      ctx.drawImage(pImg, px, footerY - iconSize / 2 + 14 * s, iconSize, iconSize)
    } else {
      // Round placeholder
      ctx.fillStyle = preset.palette.inkDim
      ctx.beginPath()
      ctx.arc(px + iconSize / 2, footerY + 14 * s, iconSize / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = preset.palette.bg
      ctx.font = `900 ${10 * s}px ${family}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.name.slice(0, 3).toUpperCase(), px + iconSize / 2, footerY + 14 * s)
    }
    px -= iconSize + iconGap
  }
}

function drawHeadphoneIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = size * 0.12
  ctx.lineCap = 'round'
  // Arc band over the top
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.7, Math.PI, 0)
  ctx.stroke()
  // Two ear cups
  ctx.beginPath()
  roundRectPath(ctx, cx - size * 0.85, cy - size * 0.1, size * 0.35, size * 0.55, size * 0.15)
  ctx.fill()
  ctx.beginPath()
  roundRectPath(ctx, cx + size * 0.5, cy - size * 0.1, size * 0.35, size * 0.55, size * 0.15)
  ctx.fill()
  ctx.restore()
}

function hexRgbStr(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '255, 255, 255'
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`
}

// ============================================================
// Concept diagrams
// ============================================================
function drawDiagram(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number,
  diagram: DiagramSpec, preset: ShowDeckPreset,
) {
  if (diagram.layout === 'two-circle') {
    // Right-anchored: two circles side by side connected by a dotted
    // arc with a midpoint marker (slide 2 style).
    const cy = H * 0.78
    const padX = 70 * s
    const colStart = padX + (W - padX * 2) * 0.55
    const span = W - padX - colStart
    const node1X = colStart + span * 0.25
    const node2X = colStart + span * 0.85
    drawDiagramNode(ctx, node1X, cy, s, diagram.nodes[0], preset)
    drawDiagramNode(ctx, node2X, cy, s, diagram.nodes[1], preset)
    // Connector
    ctx.strokeStyle = preset.palette.primary
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(node1X + 80 * s, cy)
    ctx.lineTo((node1X + node2X) / 2 - 8 * s, cy)
    ctx.stroke()
    ctx.strokeStyle = preset.palette.secondary
    ctx.beginPath()
    ctx.moveTo((node1X + node2X) / 2 + 8 * s, cy)
    ctx.lineTo(node2X - 80 * s, cy)
    ctx.stroke()
    // Midpoint dot
    ctx.fillStyle = preset.palette.ink
    ctx.beginPath()
    ctx.arc((node1X + node2X) / 2, cy, 8 * s, 0, Math.PI * 2)
    ctx.fill()
    if (diagram.midpoint) {
      ctx.font = `800 ${18 * s}px "Helvetica Neue", Inter, sans-serif`
      ctx.fillStyle = preset.palette.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(diagram.midpoint.label.toUpperCase(), (node1X + node2X) / 2, cy + 80 * s)
      if (diagram.midpoint.sub) {
        ctx.font = `500 ${14 * s}px "Helvetica Neue", Inter, sans-serif`
        ctx.fillStyle = preset.palette.inkDim
        ctx.fillText(diagram.midpoint.sub, (node1X + node2X) / 2, cy + 104 * s)
      }
    }
  } else if (diagram.layout === 'three-stage') {
    // Full-width: node — bridge arc — node (slide 3 style).
    const cy = H * 0.78
    const padX = 130 * s
    const left = padX
    const right = W - padX
    const mid = (left + right) / 2
    drawDiagramNode(ctx, left, cy, s, diagram.nodes[0], preset)
    drawDiagramNode(ctx, right, cy, s, diagram.nodes[1], preset)
    // Bridge arc above the line
    ctx.strokeStyle = preset.palette.ink
    ctx.lineWidth = 2 * s
    ctx.beginPath()
    const archW = (right - left) * 0.5
    const archCx = mid
    const archR = archW / 2
    ctx.arc(archCx, cy, archR, Math.PI, 0)
    ctx.stroke()
    // Bridge "spokes" — vertical lines from the arc to the baseline
    const spokeCount = 8
    for (let i = 1; i < spokeCount; i++) {
      const t = i / spokeCount
      const ax = archCx - archR + 2 * archR * t
      const ay = cy - Math.sin(Math.PI * t) * archR
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax, cy)
      ctx.stroke()
    }
    // Connector line baseline
    ctx.strokeStyle = preset.palette.primary
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(left + 80 * s, cy)
    ctx.lineTo(mid - 4 * s, cy)
    ctx.stroke()
    ctx.strokeStyle = preset.palette.secondary
    ctx.beginPath()
    ctx.moveTo(mid + 4 * s, cy)
    ctx.lineTo(right - 80 * s, cy)
    ctx.stroke()
    // Midpoint marker
    ctx.fillStyle = preset.palette.ink
    ctx.beginPath()
    ctx.arc(mid, cy, 8 * s, 0, Math.PI * 2)
    ctx.fill()
    if (diagram.midpoint) {
      ctx.font = `800 ${18 * s}px "Helvetica Neue", Inter, sans-serif`
      ctx.fillStyle = preset.palette.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(diagram.midpoint.label.toUpperCase(), mid, cy + 80 * s)
      if (diagram.midpoint.sub) {
        ctx.font = `500 ${14 * s}px "Helvetica Neue", Inter, sans-serif`
        ctx.fillStyle = preset.palette.inkDim
        ctx.fillText(diagram.midpoint.sub, mid, cy + 104 * s)
      }
    }
  }
}

function drawDiagramNode(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number,
  node: { icon: ConceptIconKey; label: string; sub?: string; tone: 'primary' | 'secondary' | 'neutral' },
  preset: ShowDeckPreset,
) {
  const color = node.tone === 'primary' ? preset.palette.primary
              : node.tone === 'secondary' ? preset.palette.secondary
              : preset.palette.ink
  // Concentric ring
  ctx.strokeStyle = color
  ctx.lineWidth = 2 * s
  ctx.globalAlpha = 0.3
  ctx.beginPath()
  ctx.arc(cx, cy, 80 * s, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  // Filled inner disk
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, 56 * s, 0, Math.PI * 2)
  ctx.fill()
  // Icon
  drawConceptIcon(ctx, cx, cy, 40 * s, node.icon, '#fff', preset)
  // Label above
  ctx.font = `800 ${20 * s}px "Helvetica Neue", Inter, sans-serif`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(node.label.toUpperCase(), cx, cy - 100 * s)
  if (node.sub) {
    ctx.font = `500 ${14 * s}px "Helvetica Neue", Inter, sans-serif`
    ctx.fillStyle = preset.palette.inkDim
    ctx.fillText(node.sub, cx, cy - 80 * s)
  }
}

// ============================================================
// Concept-icon vocabulary
// ============================================================
function drawConceptIcon(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number,
  key: ConceptIconKey, color: string, _preset: ShowDeckPreset,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = size * 0.06
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  const r = size

  switch (key) {
    case 'heritage': {
      // Castle / chess rook silhouette
      ctx.beginPath()
      const w = r * 0.9, h = r * 0.95
      // crenellation top
      const cx0 = -w / 2, cy0 = -h / 2
      const crenH = h * 0.18
      const towerW = w / 5
      ctx.moveTo(cx0, cy0 + crenH)
      ctx.lineTo(cx0, cy0)
      ctx.lineTo(cx0 + towerW, cy0)
      ctx.lineTo(cx0 + towerW, cy0 + crenH * 0.6)
      ctx.lineTo(cx0 + towerW * 2, cy0 + crenH * 0.6)
      ctx.lineTo(cx0 + towerW * 2, cy0)
      ctx.lineTo(cx0 + towerW * 3, cy0)
      ctx.lineTo(cx0 + towerW * 3, cy0 + crenH * 0.6)
      ctx.lineTo(cx0 + towerW * 4, cy0 + crenH * 0.6)
      ctx.lineTo(cx0 + towerW * 4, cy0)
      ctx.lineTo(cx0 + w, cy0)
      ctx.lineTo(cx0 + w, cy0 + crenH)
      // body
      ctx.lineTo(cx0 + w * 0.95, cy0 + crenH)
      ctx.lineTo(cx0 + w * 0.95, cy0 + h)
      ctx.lineTo(cx0 + w * 0.05, cy0 + h)
      ctx.lineTo(cx0 + w * 0.05, cy0 + crenH)
      ctx.closePath()
      ctx.fill()
      // Door arch
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      ctx.moveTo(-r * 0.12, h / 2)
      ctx.lineTo(-r * 0.12, h / 2 - r * 0.28)
      ctx.arc(0, h / 2 - r * 0.28, r * 0.12, Math.PI, 0)
      ctx.lineTo(r * 0.12, h / 2)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'momentum': {
      // Double chevron (»)
      ctx.lineWidth = size * 0.18
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(-r * 0.45, -r * 0.4)
      ctx.lineTo(-r * 0.05, 0)
      ctx.lineTo(-r * 0.45, r * 0.4)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(r * 0.0, -r * 0.4)
      ctx.lineTo(r * 0.4, 0)
      ctx.lineTo(r * 0.0, r * 0.4)
      ctx.stroke()
      break
    }
    case 'bridge': {
      // Simple arched bridge with deck line
      ctx.lineWidth = size * 0.1
      ctx.beginPath()
      ctx.arc(0, r * 0.1, r * 0.55, Math.PI, 0)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r * 0.7, r * 0.1)
      ctx.lineTo(r * 0.7, r * 0.1)
      ctx.stroke()
      break
    }
    case 'voice': {
      // Speech bubble
      ctx.lineWidth = size * 0.1
      ctx.beginPath()
      const w = r * 0.9, h = r * 0.7
      roundRectPath(ctx, -w / 2, -h / 2, w, h, r * 0.18)
      ctx.stroke()
      // Tail
      ctx.beginPath()
      ctx.moveTo(-r * 0.1, h / 2)
      ctx.lineTo(-r * 0.3, h / 2 + r * 0.2)
      ctx.lineTo(-r * 0.05, h / 2 - r * 0.05)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'target': {
      // Concentric circles
      ctx.lineWidth = size * 0.08
      for (const f of [0.9, 0.6, 0.3]) {
        ctx.beginPath()
        ctx.arc(0, 0, r * f, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'compass': {
      ctx.lineWidth = size * 0.08
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.6)
      ctx.lineTo(r * 0.18, 0)
      ctx.lineTo(0, r * 0.6)
      ctx.lineTo(-r * 0.18, 0)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'spark': {
      // 4-point star
      ctx.beginPath()
      const arms = [[0, -r], [r * 0.18, -r * 0.18], [r, 0], [r * 0.18, r * 0.18], [0, r], [-r * 0.18, r * 0.18], [-r, 0], [-r * 0.18, -r * 0.18]]
      ctx.moveTo(arms[0][0], arms[0][1])
      for (const [x, y] of arms.slice(1)) ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'pulse': {
      ctx.lineWidth = size * 0.1
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(-r, 0)
      ctx.lineTo(-r * 0.3, 0)
      ctx.lineTo(-r * 0.1, -r * 0.7)
      ctx.lineTo(r * 0.1, r * 0.7)
      ctx.lineTo(r * 0.3, 0)
      ctx.lineTo(r, 0)
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

// ============================================================
// Brand-mark placeholder (subject brand at slide bottom)
// ============================================================
function drawBrandMark(
  ctx: CanvasRenderingContext2D, W: number, H: number, s: number, label: string, preset: ShowDeckPreset,
) {
  // Render the brand name as a faux-shield placeholder. Real logos
  // would come from an uploaded PNG in a future pass.
  const cx = W / 2
  const cy = H - 110 * s
  const w = 200 * s
  const h = 56 * s
  ctx.fillStyle = preset.palette.ink
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, 14 * s)
  ctx.fill()
  ctx.fillStyle = preset.palette.bg
  ctx.font = `900 ${22 * s}px "Helvetica Neue", Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.toUpperCase(), cx, cy)
}

// ============================================================
// Text layout helpers
// ============================================================
function sizeForWrap(
  ctx: CanvasRenderingContext2D, text: string,
  opts: {
    maxWidth: number; maxHeight: number;
    maxFontPx: number; minFontPx: number;
    fontFamily: string; fontWeight: string;
    lineHeightRatio: number;
  },
): { fontPx: number; lines: string[] } {
  for (let size = opts.maxFontPx; size >= opts.minFontPx; size -= 2) {
    ctx.font = `${opts.fontWeight} ${size}px ${opts.fontFamily}`
    const lines = wrapLines(ctx, text, opts.maxWidth)
    const lineH = size * opts.lineHeightRatio
    const totalH = lines.length * lineH
    if (totalH <= opts.maxHeight) return { fontPx: size, lines }
  }
  ctx.font = `${opts.fontWeight} ${opts.minFontPx}px ${opts.fontFamily}`
  return { fontPx: opts.minFontPx, lines: wrapLines(ctx, text, opts.maxWidth) }
}

function drawWrappedAutoFit(
  ctx: CanvasRenderingContext2D, text: string,
  opts: {
    x: number; y: number;
    maxWidth: number; maxHeight: number;
    maxFontPx: number; minFontPx: number;
    fontFamily: string; fontWeight: string;
    lineHeightRatio: number;
    alignLeft?: boolean;
    letterSpacing?: number;
  },
) {
  const prevAlign = ctx.textAlign
  if (opts.alignLeft) ctx.textAlign = 'left'
  const sized = sizeForWrap(ctx, text, opts)
  ctx.font = `${opts.fontWeight} ${sized.fontPx}px ${opts.fontFamily}`
  const lineH = sized.fontPx * opts.lineHeightRatio
  const totalH = sized.lines.length * lineH
  const startY = opts.y - totalH / 2 + lineH / 2
  const startX = opts.alignLeft ? opts.x - opts.maxWidth / 2 : opts.x
  sized.lines.forEach((line, i) => {
    ctx.fillText(line, startX, startY + i * lineH)
  })
  ctx.textAlign = prevAlign
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\n+/)) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (ctx.measureText(next).width <= maxWidth) line = next
      else {
        if (line) out.push(line)
        line = w
      }
    }
    if (line) out.push(line)
  }
  return out.length > 0 ? out : ['']
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ============================================================
// Convenience: a sample deck for the user to preview / verify
// ============================================================
export function sampleSoulAndScienceDeck(): SlideSpec[] {
  return [
    { kind: 'cover', title: 'Why Legacy Brands Win', eyebrow: 'Episode 12' },
    {
      kind: 'thesis',
      headline: 'Legacy brands have an ADVANTAGE.',
      accent: 'ADVANTAGE.',
      body: 'People know them.\nPeople remember them.\nPeople grew up with them.\n\nBut memory alone doesn’t create momentum.',
      diagram: {
        layout: 'two-circle',
        nodes: [
          { icon: 'heritage', label: 'Heritage', sub: '(the past)', tone: 'primary' },
          { icon: 'momentum', label: 'Momentum', sub: '(the future)', tone: 'secondary' },
        ],
        midpoint: { label: 'The Choice', sub: '(right now)' },
      },
    },
    {
      kind: 'thesis',
      headline: 'The challenge isn’t OLD VS. NEW.',
      accent: 'OLD VS. NEW.',
      body: 'The challenge is not choosing between old and new. It’s learning how to speak to the people who built the brand… and the people discovering it for the first time.',
      diagram: {
        layout: 'three-stage',
        nodes: [
          { icon: 'heritage', label: 'Old', sub: '(the past)', tone: 'primary' },
          { icon: 'momentum', label: 'New', sub: '(the future)', tone: 'secondary' },
        ],
        midpoint: { label: 'The Bridge', sub: '(the work)' },
      },
    },
    {
      kind: 'callout',
      headline: 'For White Castle, modernization STARTS WITH CLARITY.',
      accent: 'STARTS WITH',
      accentSecondary: 'CLARITY.',
      body: 'Know your audience.\n\nSpeak their language.\n\nAnd keep the idea consistent.',
      traits: [
        { icon: 'heritage', word: 'Real.' },
        { icon: 'voice',    word: 'Relevant.' },
        { icon: 'target',   word: 'Resonant.' },
      ],
      brandMark: { label: 'White Castle' },
    },
    {
      kind: 'brand-callout',
      headline: 'Meet travelers WHERE THEY ALREADY ARE.',
      accent: 'WHERE THEY',
      accentSecondary: 'ALREADY ARE.',
      bodyParagraphs: [
        'For Tripadvisor, the answer is not just more media.',
        'It’s meeting travelers where they already are.',
        'Sometimes the future of search doesn’t start on your website.',
      ],
      finalLine: 'It starts in the feed.',
      brandLabel: 'Tripadvisor',
    },
    {
      kind: 'brand-callout',
      headline: 'HERITAGE IS NOT SOMETHING TO HIDE. IT’S SOMETHING TO REFRAME.',
      accent: 'SOMETHING TO HIDE.',
      accentSecondary: 'TO REFRAME.',
      bodyParagraphs: [
        'A mistake became part of the brand.',
        'A catalog became a modern channel.',
        'A legacy became a personality.',
      ],
      brandLabel: 'Lands’ End',
    },
    {
      kind: 'finale',
      lessonHeadline: 'The Lesson:',
      lessonBody:
        'Legacy brands don’t stay relevant by living in the past. They stay modern by keeping what made them matter… and having the courage to evolve what comes next.',
      tagline: 'Realness. Relevance. Resonance.',
    },
  ]
}

// Adapter: take a flat server-shape slide (from Claude) and produce
// the discriminated-union SlideSpec the renderer wants. Skips malformed
// slides (returns null) — caller filters them out.
export function adaptServerSlide(s: {
  kind: string
  title?: string; eyebrow?: string
  headline?: string; accent?: string; accentSecondary?: string; body?: string; brandLabel?: string
  diagramLayout?: string
  diagramNodeAIcon?: string; diagramNodeALabel?: string; diagramNodeASub?: string
  diagramNodeBIcon?: string; diagramNodeBLabel?: string; diagramNodeBSub?: string
  diagramMidpointLabel?: string; diagramMidpointSub?: string
  trait1Icon?: string; trait1Word?: string
  trait2Icon?: string; trait2Word?: string
  trait3Icon?: string; trait3Word?: string
  bodyParagraphs?: string[]; finalLine?: string
  lessonHeadline?: string; lessonBody?: string; tagline?: string
  quoteText?: string; quoteSpeaker?: string
}): SlideSpec | null {
  switch (s.kind) {
    case 'cover':
      if (!s.title) return null
      return { kind: 'cover', title: s.title, eyebrow: s.eyebrow }
    case 'thesis': {
      if (!s.headline || !s.accent) return null
      const diagram: DiagramSpec | undefined =
        s.diagramLayout && s.diagramLayout !== 'none' && s.diagramNodeAIcon && s.diagramNodeBIcon
          ? {
              layout: s.diagramLayout as DiagramSpec['layout'],
              nodes: [
                { icon: s.diagramNodeAIcon as ConceptIconKey, label: s.diagramNodeALabel ?? '', sub: s.diagramNodeASub, tone: 'primary' },
                { icon: s.diagramNodeBIcon as ConceptIconKey, label: s.diagramNodeBLabel ?? '', sub: s.diagramNodeBSub, tone: 'secondary' },
              ],
              midpoint: s.diagramMidpointLabel ? { label: s.diagramMidpointLabel, sub: s.diagramMidpointSub } : undefined,
            }
          : undefined
      return {
        kind: 'thesis',
        headline: s.headline, accent: s.accent, body: s.body, diagram,
        brandMark: s.brandLabel ? { label: s.brandLabel } : undefined,
      }
    }
    case 'callout': {
      if (!s.headline || !s.accent) return null
      const traits: Array<{ icon: ConceptIconKey; word: string }> = []
      if (s.trait1Icon && s.trait1Word) traits.push({ icon: s.trait1Icon as ConceptIconKey, word: s.trait1Word })
      if (s.trait2Icon && s.trait2Word) traits.push({ icon: s.trait2Icon as ConceptIconKey, word: s.trait2Word })
      if (s.trait3Icon && s.trait3Word) traits.push({ icon: s.trait3Icon as ConceptIconKey, word: s.trait3Word })
      return {
        kind: 'callout',
        headline: s.headline, accent: s.accent, accentSecondary: s.accentSecondary,
        body: s.body, traits: traits.length > 0 ? traits : undefined,
        brandMark: s.brandLabel ? { label: s.brandLabel } : undefined,
      }
    }
    case 'brand-callout': {
      if (!s.headline || !s.accent || !s.bodyParagraphs) return null
      return {
        kind: 'brand-callout',
        headline: s.headline, accent: s.accent, accentSecondary: s.accentSecondary,
        bodyParagraphs: s.bodyParagraphs, finalLine: s.finalLine,
        brandLabel: s.brandLabel,
      }
    }
    case 'finale': {
      if (!s.lessonBody) return null
      return {
        kind: 'finale',
        lessonHeadline: s.lessonHeadline,
        lessonBody: s.lessonBody,
        tagline: s.tagline,
      }
    }
    case 'quote': {
      if (!s.quoteText) return null
      return { kind: 'quote', text: s.quoteText, speaker: s.quoteSpeaker }
    }
    default:
      return null
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('canvas_to_blob_failed')) }, type, 0.95)
  })
}
