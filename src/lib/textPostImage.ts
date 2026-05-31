// Renders an Instagram-portrait (1080×1350) text-post image branded to
// the show. The cover art's dominant color fills the background; a
// second vivid color (or a luminance-derived contrast) handles the show
// name and rules. The post copy uses a high-contrast color picked from
// the bg luminance so it's always legible.
//
// Palette extraction happens asynchronously via extractCoverPalette
// below — the caller passes the result in, so rendering stays
// synchronous and matches the on-screen preview byte-for-byte.

const DISPLAY_RATIO = 0.45 // ~486×608 preview in the UI

// Warm-terracotta palette used when the cover can't be read (CORS, etc.)
const DEFAULT_PALETTE: CoverPalette = { primary: '#D9B382', secondary: '#3A2C1F' }

export type CoverPalette = {
  primary: string   // dominant color — used as background
  secondary: string // contrasting accent — used for show name + rule
}

export type PostImageInput = {
  text: string
  showName: string
  palette?: CoverPalette | null
  // Back-compat: a single accent color, applied as primary if palette
  // isn't supplied. The renderer will derive a secondary from luminance.
  accent?: string | null
}

export function renderTextPostCanvas(input: PostImageInput, opts: { fullSize: boolean } = { fullSize: false }): HTMLCanvasElement {
  const W = opts.fullSize ? 1080 : Math.round(1080 * DISPLAY_RATIO)
  const H = opts.fullSize ? 1350 : Math.round(1350 * DISPLAY_RATIO)
  const scale = W / 1080
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const palette = resolvePalette(input)
  const bg = palette.primary
  const bgRGB = hexToRgb(bg)
  const bgLuma = luminance(bgRGB)
  // Pick text color for legibility on the bg. Dark bg → cream; light
  // bg → deep ink. We anchor to fixed extremes (rather than a derived
  // shade of the bg) so contrast stays strong even on muddy covers.
  const isLightBg = bgLuma > 0.55
  const ink = isLightBg ? '#1A140C' : '#FAF7EF'
  const inkRGB = hexToRgb(ink)
  const accent = palette.secondary
  const accentRGB = hexToRgb(accent)

  // Background fill — the whole canvas takes the show's dominant color.
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Soft inner card to keep long copy readable on saturated backgrounds.
  // The card is a tinted version of the bg — slightly lighter or darker
  // than the bg depending on luminance — so the post still reads
  // "yellow show" or "blue show" at a glance.
  const cardPad = 70 * scale
  const cardX = cardPad
  const cardY = cardPad
  const cardW = W - cardPad * 2
  const cardH = H - cardPad * 2
  const cardFill = isLightBg
    ? mixWithWhite(bgRGB, 0.65)   // 65% toward white on light bgs
    : mixWithBlack(bgRGB, 0.55)   // 55% toward black on dark bgs
  ctx.fillStyle = `rgb(${cardFill.r}, ${cardFill.g}, ${cardFill.b})`
  roundedRect(ctx, cardX, cardY, cardW, cardH, 28 * scale)
  ctx.fill()

  // Decide ink for inside the card based on its own luminance, not the
  // outer bg's — the card may be much paler than the bg.
  const cardLuma = luminance(cardFill)
  const cardIsLight = cardLuma > 0.55
  const cardInk = cardIsLight ? '#1A140C' : '#FAF7EF'
  const cardInkRGB = hexToRgb(cardInk)

  // Thin accent border around the card
  ctx.strokeStyle = `rgba(${accentRGB.r}, ${accentRGB.g}, ${accentRGB.b}, 0.6)`
  ctx.lineWidth = 2 * scale
  roundedRect(ctx, cardX + 12 * scale, cardY + 12 * scale, cardW - 24 * scale, cardH - 24 * scale, 22 * scale)
  ctx.stroke()

  // Show name (small caps, kerned) — secondary/accent on the card
  ctx.fillStyle = accent
  ctx.font = `700 ${Math.round(22 * scale)}px Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const showLabel = (input.showName || 'Untitled show').toUpperCase()
  ctx.fillText(spaceForKerning(showLabel), W / 2, cardY + 80 * scale)

  // Rule under show name
  ctx.strokeStyle = `rgba(${accentRGB.r}, ${accentRGB.g}, ${accentRGB.b}, 0.75)`
  ctx.lineWidth = 1.5 * scale
  ctx.beginPath()
  ctx.moveTo(W / 2 - 50 * scale, cardY + 120 * scale)
  ctx.lineTo(W / 2 + 50 * scale, cardY + 120 * scale)
  ctx.stroke()

  // Post text — high-contrast against the card.
  ctx.fillStyle = cardInk
  const text = (input.text || '').trim()
  drawWrappedAutoFit(ctx, text, {
    x: W / 2,
    y: H / 2,
    maxWidth: W - 240 * scale,
    maxHeight: H * 0.55,
    maxFontPx: Math.round(58 * scale),
    minFontPx: Math.round(28 * scale),
    fontFamily: 'Georgia, "Playfair Display", serif',
    fontWeight: '500',
    lineHeightRatio: 1.32,
  })

  // Footer mark — small accent
  ctx.fillStyle = accent
  ctx.font = `700 ${Math.round(16 * scale)}px Georgia, serif`
  ctx.fillText('·  ·  ·', W / 2, H - cardPad - 50 * scale)

  // Silence unused warning for older flow that referenced ink/inkRGB.
  void ink; void inkRGB; void cardInkRGB

  return canvas
}

function resolvePalette(input: PostImageInput): CoverPalette {
  if (input.palette) {
    const primary = normalizeHex(input.palette.primary)
    const secondary = normalizeHex(input.palette.secondary)
    if (primary && secondary) return { primary, secondary }
  }
  const accent = normalizeHex(input.accent)
  if (accent) {
    return { primary: accent, secondary: deriveContrast(hexToRgb(accent)) }
  }
  return DEFAULT_PALETTE
}

// Pulls a primary + secondary color out of the cover art. Anonymous CORS
// so pixels are readable. Downscales to 64×64, builds a saturated-color
// histogram, picks the most-prominent vivid bucket as the primary, then
// picks the next vivid bucket that's hue-distant from the primary so
// two-tone shows (yellow background + blue title, etc.) render with
// both colors instead of just one.
export async function extractCoverPalette(coverArtUrl: string): Promise<CoverPalette | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let settled = false
    const done = (v: CoverPalette | null) => { if (!settled) { settled = true; resolve(v) } }
    setTimeout(() => done(null), 8000)
    img.onload = () => {
      try {
        const size = 64
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return done(null)
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        type Bucket = { r: number; g: number; b: number; score: number; hue: number }
        const buckets = new Map<string, Bucket>()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 200) continue
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          if (max < 30 || min > 230) continue // skip near-black / near-white
          if (max - min < 24) continue        // skip greys
          const qr = (r >> 5) << 5
          const qg = (g >> 5) << 5
          const qb = (b >> 5) << 5
          const key = `${qr}-${qg}-${qb}`
          const saturation = (max - min) / max
          const cur = buckets.get(key) ?? {
            r: qr + 16, g: qg + 16, b: qb + 16,
            score: 0,
            hue: hueOf(qr + 16, qg + 16, qb + 16),
          }
          cur.score += 1 + saturation
          buckets.set(key, cur)
        }
        const sorted = [...buckets.values()].sort((a, b) => b.score - a.score)
        const primary = sorted[0]
        if (!primary) return done(null)
        // Find a secondary that's at least 60° away in hue and still has
        // meaningful score (top 8). Falls back to a luminance-derived
        // contrast if the cover is monochromatic.
        let secondary: Bucket | null = null
        for (const cand of sorted.slice(1, 9)) {
          const d = hueDistance(primary.hue, cand.hue)
          if (d >= 60) { secondary = cand; break }
        }
        const primaryHex = rgbToHex(primary.r, primary.g, primary.b)
        const secondaryHex = secondary
          ? rgbToHex(secondary.r, secondary.g, secondary.b)
          : deriveContrast({ r: primary.r, g: primary.g, b: primary.b })
        done({ primary: primaryHex, secondary: secondaryHex })
      } catch {
        done(null)
      }
    }
    img.onerror = () => done(null)
    img.src = coverArtUrl
  })
}

// Back-compat: callers that just want a single color.
export async function extractAccentColor(coverArtUrl: string): Promise<string | null> {
  const palette = await extractCoverPalette(coverArtUrl)
  return palette?.primary ?? null
}

function normalizeHex(v?: string | null): string | null {
  if (!v) return null
  const s = v.trim()
  const m = /^#?([0-9a-f]{6})$/i.exec(s)
  if (!m) return null
  return `#${m[1].toLowerCase()}`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return { r: 139, g: 111, b: 71 }
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// Standard relative luminance (0–1). Used to decide light vs. dark ink.
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function mixWithWhite({ r, g, b }: { r: number; g: number; b: number }, t: number) {
  return { r: r + (255 - r) * t, g: g + (255 - g) * t, b: b + (255 - b) * t }
}

function mixWithBlack({ r, g, b }: { r: number; g: number; b: number }, t: number) {
  return { r: r * (1 - t), g: g * (1 - t), b: b * (1 - t) }
}

// HSL-style hue in degrees [0, 360). For palette diversity.
function hueOf(r: number, g: number, b: number): number {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  if (max === min) return 0
  const d = max - min
  let h = 0
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return h
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// When the cover is monochromatic, build a tonal secondary by darkening
// or lightening the primary so the show-name label still reads on the
// inner card.
function deriveContrast(rgb: { r: number; g: number; b: number }): string {
  const lum = luminance(rgb)
  const shifted = lum > 0.55 ? mixWithBlack(rgb, 0.7) : mixWithWhite(rgb, 0.7)
  return rgbToHex(shifted.r, shifted.g, shifted.b)
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Try sequentially smaller font sizes until the wrapped text fits the box.
function drawWrappedAutoFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: {
    x: number
    y: number
    maxWidth: number
    maxHeight: number
    maxFontPx: number
    minFontPx: number
    fontFamily: string
    fontWeight: string
    lineHeightRatio: number
  },
) {
  for (let size = opts.maxFontPx; size >= opts.minFontPx; size -= 2) {
    ctx.font = `${opts.fontWeight} ${size}px ${opts.fontFamily}`
    const lines = wrapLines(ctx, text, opts.maxWidth)
    const lineH = size * opts.lineHeightRatio
    const totalH = lines.length * lineH
    if (totalH <= opts.maxHeight) {
      const startY = opts.y - totalH / 2 + lineH / 2
      lines.forEach((line, i) => {
        ctx.fillText(line, opts.x, startY + i * lineH)
      })
      return
    }
  }
  const size = opts.minFontPx
  ctx.font = `${opts.fontWeight} ${size}px ${opts.fontFamily}`
  const lines = wrapLines(ctx, text, opts.maxWidth)
  const lineH = size * opts.lineHeightRatio
  const startY = opts.y - (lines.length * lineH) / 2 + lineH / 2
  lines.forEach((line, i) => {
    ctx.fillText(line, opts.x, startY + i * lineH)
  })
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split(/\n+/)
  const out: string[] = []
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width <= maxWidth) {
        line = next
      } else {
        if (line) out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
    out.push('')
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.length > 0 ? out : ['']
}

function spaceForKerning(s: string): string {
  return s.split('').join(' ')
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas_to_blob_failed'))
    }, type, 0.95)
  })
}

export function safeFilename(s: string, max = 60): string {
  return s
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, max)
    .toLowerCase() || 'post'
}
