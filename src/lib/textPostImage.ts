// Renders an Instagram-portrait (1080×1350) text-post image branded to
// the show. Picks one of five distinct layout templates based on the
// post's shape so every card in a plan reads differently — not just
// "same template, different color."
//
// Templates:
//   QUOTE     — centered serif with big quotation marks; for quoted lines
//   HEADLINE  — top-anchored left-aligned sans with a colored bar; for
//               named claims / news-style headlines with a "—"
//   STATEMENT — single huge condensed-sans phrase filling the frame;
//               for short punchy posts (< 70 chars)
//   STACK     — paragraphs stacked with thin rules between them; for
//               multi-paragraph posts
//   CALLOUT   — asymmetric: small show label top-left, body centered
//               on a half-toned color block; default fallback
//
// Palette extraction happens asynchronously via extractCoverPalette
// below — the caller passes the result in, so rendering stays
// synchronous and matches the on-screen preview byte-for-byte.

const DISPLAY_RATIO = 0.45 // ~486×608 preview in the UI

const DEFAULT_PALETTE: CoverPalette = { primary: '#D9B382', secondary: '#3A2C1F' }

export type CoverPalette = {
  primary: string
  secondary: string
}

export type PostImageInput = {
  text: string
  showName: string
  palette?: CoverPalette | null
  accent?: string | null
}

type Template = 'quote' | 'headline' | 'statement' | 'stack' | 'callout'

// Decides which template fits this post. Deterministic so the same
// text always renders the same way (no flicker between previews and
// downloads).
function pickTemplate(text: string): Template {
  const t = text.trim()
  if (!t) return 'callout'
  // Quoted: starts with " and has a closing " in the first 200 chars
  const startsWithQuote = /^["'“‘]/.test(t)
  const hasMatchingClose = startsWithQuote && /["'”’]/.test(t.slice(1, 220))
  if (startsWithQuote && hasMatchingClose) return 'quote'
  // Short and punchy
  if (t.length <= 70) return 'statement'
  // Multiple paragraphs → STACK
  const paraCount = t.split(/\n\s*\n/).filter((p) => p.trim()).length
  if (paraCount >= 3) return 'stack'
  // Em-dash attribution (e.g. "X just changed Y — Person, Role at Place")
  if (/—|--/.test(t.slice(0, 200))) return 'headline'
  return 'callout'
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
  const text = (input.text || '').trim()
  const showName = (input.showName || 'Untitled show').toUpperCase()
  const template = pickTemplate(text)

  switch (template) {
    case 'quote':     drawQuote(ctx, W, H, scale, text, showName, palette); break
    case 'headline':  drawHeadline(ctx, W, H, scale, text, showName, palette); break
    case 'statement': drawStatement(ctx, W, H, scale, text, showName, palette); break
    case 'stack':     drawStack(ctx, W, H, scale, text, showName, palette); break
    case 'callout':   drawCallout(ctx, W, H, scale, text, showName, palette); break
  }
  return canvas
}

// ============================================================
// Template renderers
// ============================================================

// QUOTE — classic editorial: solid color bg, big serif quote text
// centered, small attribution dot below.
function drawQuote(
  ctx: CanvasRenderingContext2D, W: number, H: number, scale: number,
  text: string, showName: string, palette: CoverPalette,
) {
  const bg = palette.primary
  const accent = palette.secondary
  const bgRGB = hexToRgb(bg)
  const isLightBg = luminance(bgRGB) > 0.55
  const ink = isLightBg ? '#1A140C' : '#FAF7EF'

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Show label top
  ctx.fillStyle = accent
  ctx.font = `700 ${Math.round(22 * scale)}px Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(spaceForKerning(showName), W / 2, 120 * scale)

  // Big opening quotation mark behind text (decorative)
  ctx.fillStyle = `rgba(${hexToRgb(accent).r}, ${hexToRgb(accent).g}, ${hexToRgb(accent).b}, 0.18)`
  ctx.font = `700 ${Math.round(400 * scale)}px Georgia, serif`
  ctx.textBaseline = 'top'
  ctx.fillText('“', W / 2 - 200 * scale, 180 * scale)

  // Quote text
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'
  drawWrappedAutoFit(ctx, text, {
    x: W / 2, y: H / 2 + 40 * scale,
    maxWidth: W - 180 * scale, maxHeight: H * 0.55,
    maxFontPx: Math.round(64 * scale), minFontPx: Math.round(30 * scale),
    fontFamily: 'Georgia, "Playfair Display", serif',
    fontWeight: '500', lineHeightRatio: 1.3,
  })

  // Bottom attribution rule + show name
  ctx.strokeStyle = accent
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  ctx.moveTo(W / 2 - 40 * scale, H - 130 * scale)
  ctx.lineTo(W / 2 + 40 * scale, H - 130 * scale)
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.font = `600 ${Math.round(18 * scale)}px Georgia, serif`
  ctx.textBaseline = 'middle'
  ctx.fillText(showName, W / 2, H - 90 * scale)
}

// HEADLINE — magazine-style: thick color bar across the top, big bold
// sans headline left-aligned beneath it, show name in the bar.
function drawHeadline(
  ctx: CanvasRenderingContext2D, W: number, H: number, scale: number,
  text: string, showName: string, palette: CoverPalette,
) {
  const bg = palette.primary
  const accent = palette.secondary
  const bgRGB = hexToRgb(bg)
  const isLightBg = luminance(bgRGB) > 0.55
  // Use a near-white card area below the colored bar.
  const cardFill = isLightBg ? mixWithWhite(bgRGB, 0.8) : mixWithWhite(bgRGB, 0.92)
  const cardInk = '#161210'

  // Full bg
  ctx.fillStyle = `rgb(${cardFill.r}, ${cardFill.g}, ${cardFill.b})`
  ctx.fillRect(0, 0, W, H)

  // Top color band
  const bandH = 200 * scale
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, W, bandH)
  // Show name in band
  ctx.fillStyle = '#FAF7EF'
  ctx.font = `800 ${Math.round(28 * scale)}px Inter, "Helvetica Neue", sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(showName, 70 * scale, bandH / 2)

  // Big sans headline, left-aligned
  ctx.fillStyle = cardInk
  ctx.textAlign = 'left'
  drawWrappedAutoFit(ctx, text, {
    x: 70 * scale + ((W - 140 * scale) / 2), // center within left-aligned bounds
    y: bandH + (H - bandH) / 2,
    maxWidth: W - 140 * scale, maxHeight: H - bandH - 200 * scale,
    maxFontPx: Math.round(78 * scale), minFontPx: Math.round(32 * scale),
    fontFamily: 'Inter, "Helvetica Neue", sans-serif',
    fontWeight: '800', lineHeightRatio: 1.15,
    alignLeft: true,
  })

  // Thin colored rule near bottom + small "swipe / link in bio" style mark
  ctx.strokeStyle = accent
  ctx.lineWidth = 3 * scale
  ctx.beginPath()
  ctx.moveTo(70 * scale, H - 90 * scale)
  ctx.lineTo(170 * scale, H - 90 * scale)
  ctx.stroke()
}

// STATEMENT — huge bold condensed sans, centered, fills most of the
// frame. Bg is the show's primary color (no card). For short punchy posts.
function drawStatement(
  ctx: CanvasRenderingContext2D, W: number, H: number, scale: number,
  text: string, showName: string, palette: CoverPalette,
) {
  const bg = palette.primary
  const accent = palette.secondary
  const bgRGB = hexToRgb(bg)
  const isLightBg = luminance(bgRGB) > 0.55
  const ink = isLightBg ? '#1A140C' : '#FAF7EF'

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Top show label, small
  ctx.fillStyle = accent
  ctx.font = `800 ${Math.round(20 * scale)}px Inter, "Helvetica Neue", sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(showName, 80 * scale, 80 * scale)
  ctx.strokeStyle = accent
  ctx.lineWidth = 4 * scale
  ctx.beginPath()
  ctx.moveTo(80 * scale, 122 * scale)
  ctx.lineTo(80 * scale + 60 * scale, 122 * scale)
  ctx.stroke()

  // Huge body — fills as much vertical space as possible
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  drawWrappedAutoFit(ctx, text, {
    x: 80 * scale + ((W - 160 * scale) / 2),
    y: H / 2 + 40 * scale,
    maxWidth: W - 160 * scale, maxHeight: H * 0.7,
    maxFontPx: Math.round(160 * scale), minFontPx: Math.round(60 * scale),
    fontFamily: '"Bebas Neue", "Oswald", Impact, sans-serif',
    fontWeight: '900', lineHeightRatio: 1.02,
    alignLeft: true,
  })
}

// STACK — multi-paragraph posts. Each paragraph in its own band with
// a thin colored rule. Varies font size by paragraph so it reads more
// like an article than a wall of text.
function drawStack(
  ctx: CanvasRenderingContext2D, W: number, H: number, scale: number,
  text: string, showName: string, palette: CoverPalette,
) {
  const bg = palette.primary
  const accent = palette.secondary
  const bgRGB = hexToRgb(bg)
  const isLightBg = luminance(bgRGB) > 0.55
  const cardFill = isLightBg ? mixWithWhite(bgRGB, 0.7) : mixWithBlack(bgRGB, 0.6)
  const cardInk = isLightBg ? '#1A140C' : '#FAF7EF'

  ctx.fillStyle = `rgb(${cardFill.r}, ${cardFill.g}, ${cardFill.b})`
  ctx.fillRect(0, 0, W, H)

  // Side stripe in accent color
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, 30 * scale, H)

  // Show name top
  ctx.fillStyle = accent
  ctx.font = `700 ${Math.round(20 * scale)}px Georgia, serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(spaceForKerning(showName), 80 * scale, 90 * scale)

  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const top = 160 * scale
  const bottom = H - 100 * scale
  const totalH = bottom - top
  const gap = 28 * scale
  const slotH = (totalH - gap * (paras.length - 1)) / paras.length

  ctx.fillStyle = cardInk
  ctx.textAlign = 'left'
  for (let i = 0; i < paras.length; i++) {
    const y = top + i * (slotH + gap) + slotH / 2
    // First paragraph slightly larger / bolder than the rest.
    const big = i === 0
    drawWrappedAutoFit(ctx, paras[i], {
      x: 80 * scale + ((W - 160 * scale) / 2),
      y,
      maxWidth: W - 160 * scale, maxHeight: slotH,
      maxFontPx: Math.round((big ? 56 : 40) * scale),
      minFontPx: Math.round(22 * scale),
      fontFamily: big ? 'Georgia, "Playfair Display", serif' : 'Inter, "Helvetica Neue", sans-serif',
      fontWeight: big ? '700' : '500',
      lineHeightRatio: 1.25,
      alignLeft: true,
    })
    // Thin separator below each para except the last
    if (i < paras.length - 1) {
      ctx.strokeStyle = `rgba(${hexToRgb(accent).r}, ${hexToRgb(accent).g}, ${hexToRgb(accent).b}, 0.4)`
      ctx.lineWidth = 1.5 * scale
      ctx.beginPath()
      ctx.moveTo(80 * scale, top + i * (slotH + gap) + slotH + gap / 2)
      ctx.lineTo(W - 80 * scale, top + i * (slotH + gap) + slotH + gap / 2)
      ctx.stroke()
    }
  }
}

// CALLOUT — asymmetric: a vertical accent column on the left holding
// the show name (rotated 90°), big serif body filling the right.
// Default fallback for medium-length posts that don't fit other shapes.
function drawCallout(
  ctx: CanvasRenderingContext2D, W: number, H: number, scale: number,
  text: string, showName: string, palette: CoverPalette,
) {
  const bg = palette.primary
  const accent = palette.secondary
  const bgRGB = hexToRgb(bg)
  const isLightBg = luminance(bgRGB) > 0.55
  const cardFill = isLightBg ? mixWithWhite(bgRGB, 0.85) : mixWithWhite(bgRGB, 0.92)
  const cardInk = '#1A140C'

  // Right portion = card
  ctx.fillStyle = `rgb(${cardFill.r}, ${cardFill.g}, ${cardFill.b})`
  ctx.fillRect(0, 0, W, H)
  // Left band in accent — narrow column with rotated show name
  const bandW = 180 * scale
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, bandW, H)
  // Rotated show name on band
  ctx.save()
  ctx.translate(bandW / 2, H / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = '#FAF7EF'
  ctx.font = `800 ${Math.round(34 * scale)}px Inter, "Helvetica Neue", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(spaceForKerning(showName), 0, 0)
  ctx.restore()

  // Body text — big serif filling right side
  ctx.fillStyle = cardInk
  ctx.textAlign = 'left'
  drawWrappedAutoFit(ctx, text, {
    x: bandW + 60 * scale + (W - bandW - 120 * scale) / 2,
    y: H / 2,
    maxWidth: W - bandW - 120 * scale, maxHeight: H * 0.75,
    maxFontPx: Math.round(58 * scale), minFontPx: Math.round(26 * scale),
    fontFamily: 'Georgia, "Playfair Display", serif',
    fontWeight: '500', lineHeightRatio: 1.3,
    alignLeft: true,
  })
}

// ============================================================
// Shared helpers
// ============================================================

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
          if (max < 30 || min > 230) continue
          if (max - min < 24) continue
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

function deriveContrast(rgb: { r: number; g: number; b: number }): string {
  const lum = luminance(rgb)
  const shifted = lum > 0.55 ? mixWithBlack(rgb, 0.7) : mixWithWhite(rgb, 0.7)
  return rgbToHex(shifted.r, shifted.g, shifted.b)
}

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
    alignLeft?: boolean
  },
) {
  const prevAlign = ctx.textAlign
  if (opts.alignLeft) ctx.textAlign = 'left'
  for (let size = opts.maxFontPx; size >= opts.minFontPx; size -= 2) {
    ctx.font = `${opts.fontWeight} ${size}px ${opts.fontFamily}`
    const lines = wrapLines(ctx, text, opts.maxWidth)
    const lineH = size * opts.lineHeightRatio
    const totalH = lines.length * lineH
    if (totalH <= opts.maxHeight) {
      const startY = opts.y - totalH / 2 + lineH / 2
      const startX = opts.alignLeft ? opts.x - opts.maxWidth / 2 : opts.x
      lines.forEach((line, i) => {
        ctx.fillText(line, startX, startY + i * lineH)
      })
      ctx.textAlign = prevAlign
      return
    }
  }
  const size = opts.minFontPx
  ctx.font = `${opts.fontWeight} ${size}px ${opts.fontFamily}`
  const lines = wrapLines(ctx, text, opts.maxWidth)
  const lineH = size * opts.lineHeightRatio
  const startY = opts.y - (lines.length * lineH) / 2 + lineH / 2
  const startX = opts.alignLeft ? opts.x - opts.maxWidth / 2 : opts.x
  lines.forEach((line, i) => {
    ctx.fillText(line, startX, startY + i * lineH)
  })
  ctx.textAlign = prevAlign
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

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
void roundedRect

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
