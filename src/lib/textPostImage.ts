// Renders an Instagram-portrait (1080×1350) text-post image with the
// post copy laid out over a warm cream background, the show name in
// small caps at the top, and a thin rule between them.
//
// Accent color is pulled from the podcast's cover art when available, so
// every show's text posts feel on-brand. Cover-art extraction happens
// asynchronously via extractAccentColor() below — the caller passes the
// extracted accent in, so rendering itself stays synchronous and matches
// the on-screen preview byte-for-byte.

const DISPLAY_RATIO = 0.45 // ~486×608 preview in the UI

const DEFAULT_ACCENT = '#8B6F47'

export type PostImageInput = {
  text: string
  showName: string
  // Hex like '#RRGGBB'. Optional — defaults to a warm terracotta.
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

  // Background
  ctx.fillStyle = '#F4F1EA'
  ctx.fillRect(0, 0, W, H)

  const accent = normalizeHex(input.accent) ?? DEFAULT_ACCENT
  const accentRGB = hexToRgb(accent)

  // Subtle texture rectangle border in the accent color
  ctx.strokeStyle = `rgba(${accentRGB.r}, ${accentRGB.g}, ${accentRGB.b}, 0.22)`
  ctx.lineWidth = 1 * scale
  ctx.strokeRect(40 * scale, 40 * scale, W - 80 * scale, H - 80 * scale)

  // Show name (small caps, kerned, in the show's accent)
  ctx.fillStyle = accent
  ctx.font = `600 ${Math.round(22 * scale)}px Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const showLabel = (input.showName || 'Untitled show').toUpperCase()
  ctx.fillText(spaceForKerning(showLabel), W / 2, 110 * scale)

  // Thin rule under show name
  ctx.strokeStyle = `rgba(${accentRGB.r}, ${accentRGB.g}, ${accentRGB.b}, 0.55)`
  ctx.lineWidth = 1 * scale
  ctx.beginPath()
  ctx.moveTo(W / 2 - 40 * scale, 150 * scale)
  ctx.lineTo(W / 2 + 40 * scale, 150 * scale)
  ctx.stroke()

  // Post text — auto-sized so longer posts shrink to fit
  ctx.fillStyle = '#1F1A14'
  const text = (input.text || '').trim()
  drawWrappedAutoFit(ctx, text, {
    x: W / 2,
    y: H / 2,
    maxWidth: W - 200 * scale,
    maxHeight: H * 0.6,
    maxFontPx: Math.round(58 * scale),
    minFontPx: Math.round(28 * scale),
    fontFamily: 'Georgia, "Playfair Display", serif',
    fontWeight: '500',
    lineHeightRatio: 1.32,
  })

  // Footer mark — a small accent on the bottom
  ctx.fillStyle = accent
  ctx.font = `400 ${Math.round(14 * scale)}px Georgia, serif`
  ctx.fillText('·', W / 2, H - 90 * scale)

  return canvas
}

// Loads the cover art (anonymous CORS so the image is "tainted-free" and
// pixels can be read), downscales to 64×64, builds a histogram of
// quantized colors, ignores near-blacks / near-whites / near-greys, and
// returns the most-prominent saturated color as #RRGGBB. Falls back to
// null on CORS errors or load failures — caller uses the default accent.
export async function extractAccentColor(coverArtUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let settled = false
    const done = (v: string | null) => { if (!settled) { settled = true; resolve(v) } }
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
        const buckets = new Map<string, { r: number; g: number; b: number; score: number }>()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 200) continue
          // Skip near-black, near-white, low-saturation greys
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          if (max < 30 || min > 230) continue
          if (max - min < 24) continue
          // Quantize to 32-step buckets to group similar shades together
          const qr = (r >> 5) << 5
          const qg = (g >> 5) << 5
          const qb = (b >> 5) << 5
          const key = `${qr}-${qg}-${qb}`
          // Score = vote count weighted by saturation so a vivid teal beats
          // a more numerous beige.
          const saturation = (max - min) / max
          const cur = buckets.get(key) ?? { r: qr + 16, g: qg + 16, b: qb + 16, score: 0 }
          cur.score += 1 + saturation
          buckets.set(key, cur)
        }
        const sorted = [...buckets.values()].sort((a, b) => b.score - a.score)
        const top = sorted[0]
        if (!top) return done(null)
        done(rgbToHex(top.r, top.g, top.b))
      } catch {
        done(null)
      }
    }
    img.onerror = () => done(null)
    img.src = coverArtUrl
  })
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
  if (!m) return { r: 139, g: 111, b: 71 } // fallback
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
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
  // Last resort: use min size and clip
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
    out.push('') // paragraph spacer
  }
  // Drop trailing empties
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.length > 0 ? out : ['']
}

// Adds hair spaces between letters for the "tracked-out small caps" feel
// on the show-name label.
function spaceForKerning(s: string): string {
  return s.split('').join(' ')
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
