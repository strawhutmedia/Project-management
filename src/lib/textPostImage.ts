// Renders an Instagram-portrait (1080×1350) text-post image with the
// post copy laid out over a warm cream background, the show name in
// small caps at the top, and a thin rule between them. Returns the
// canvas — caller can display it directly or convert to a Blob for
// download.
//
// Future work: per-project template config (background color, accent
// color, font, optional logo). For now this is one good-looking
// default that reads as editorial / podcast-y, not generic AI slop.

const DISPLAY_RATIO = 0.45 // ~486×608 preview in the UI

export type PostImageInput = {
  text: string
  showName: string
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

  // Subtle texture rectangle border
  ctx.strokeStyle = 'rgba(139, 111, 71, 0.18)'
  ctx.lineWidth = 1 * scale
  ctx.strokeRect(40 * scale, 40 * scale, W - 80 * scale, H - 80 * scale)

  // Show name (small caps, kerned, terracotta)
  ctx.fillStyle = '#8B6F47'
  ctx.font = `600 ${Math.round(22 * scale)}px Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const showLabel = (input.showName || 'Untitled show').toUpperCase()
  ctx.fillText(spaceForKerning(showLabel), W / 2, 110 * scale)

  // Thin rule under show name
  ctx.strokeStyle = 'rgba(139, 111, 71, 0.45)'
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
  ctx.fillStyle = '#8B6F47'
  ctx.font = `400 ${Math.round(14 * scale)}px Georgia, serif`
  ctx.fillText('·', W / 2, H - 90 * scale)

  return canvas
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
