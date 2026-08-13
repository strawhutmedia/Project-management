// Invoice PDF renderer. Produces a clean, branded one-page invoice for a
// contractor, matching the on-screen preview. Returns a Buffer so the same
// output can be streamed for download OR attached to a Resend email.
import PDFDocument from 'pdfkit'

export type InvoiceLineItem = {
  desc: string
  hours: number
  rateCents: number
  amountCents: number
}

export type InvoiceForPdf = {
  number: string
  contractor_name: string
  contractor_email: string
  contractor_address: string
  pay_method: string
  period: string
  issue_date: string
  line_items: InvoiceLineItem[]
  total_cents: number
  notes: string
}

export type InvoiceSettingsForPdf = {
  company_name: string
  company_email: string
  company_address: string
  logo_data_url: string | null
}

const ACCENT = '#A96B12'
const INK = '#1a1a1a'
const MUTED = '#666666'
const LINE = '#e5e0d6'

function money(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Only raster logos (PNG/JPEG) can embed in a PDF; pdfkit can't rasterize SVG.
function logoBuffer(dataUrl: string | null): Buffer | null {
  if (!dataUrl) return null
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!m) return null
  try {
    return Buffer.from(m[2], 'base64')
  } catch {
    return null
  }
}

export function renderInvoicePdf(inv: InvoiceForPdf, settings: InvoiceSettingsForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const left = 50
    const right = doc.page.width - 50
    const width = right - left

    // ── Header: brand (left) + INVOICE title (right) ──
    const logo = logoBuffer(settings.logo_data_url)
    let brandX = left
    if (logo) {
      try {
        doc.image(logo, left, 50, { fit: [46, 46] })
        brandX = left + 58
      } catch {
        brandX = left
      }
    }
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(settings.company_name, brandX, 54)
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    const companyMeta = [settings.company_email, settings.company_address].filter(Boolean).join('  ·  ')
    if (companyMeta) doc.text(companyMeta, brandX, 76)

    doc.font('Helvetica-Bold').fontSize(26).fillColor(ACCENT).text('INVOICE', left, 50, { width, align: 'right' })
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    doc.text(inv.number, left, 84, { width, align: 'right' })
    doc.text(fmtDate(inv.issue_date), left, 98, { width, align: 'right' })

    // ── Parties ──
    let y = 140
    const colW = width / 3
    const party = (x: number, label: string, lines: string[]) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#999999').text(label.toUpperCase(), x, y, { width: colW - 10, characterSpacing: 0.5 })
      doc.font('Helvetica').fontSize(10).fillColor(INK)
      let ly = y + 14
      lines.filter(Boolean).forEach((ln, i) => {
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fillColor(i === 0 ? INK : MUTED).fontSize(i === 0 ? 11 : 9.5)
        doc.text(ln, x, ly, { width: colW - 10 })
        ly += i === 0 ? 15 : 12
      })
    }
    party(left, 'From (Contractor)', [inv.contractor_name, inv.contractor_email, inv.contractor_address])
    party(left + colW, 'Bill To', [settings.company_name, settings.company_email, settings.company_address])
    party(left + colW * 2, 'Period', [inv.period || '—'])

    // ── Line items table ──
    y = 220
    const cDesc = left
    const cHours = left + width * 0.55
    const cRate = left + width * 0.72
    const cAmt = right
    doc.rect(left, y, width, 22).fill('#faf7f1')
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#8a7350')
    doc.text('DESCRIPTION', cDesc + 8, y + 7, { characterSpacing: 0.4 })
    doc.text('HOURS', cHours, y + 7, { width: width * 0.15, align: 'right' })
    doc.text('RATE', cRate, y + 7, { width: width * 0.13, align: 'right' })
    doc.text('AMOUNT', cAmt - width * 0.16, y + 7, { width: width * 0.16 - 8, align: 'right' })
    y += 22

    doc.font('Helvetica').fontSize(10).fillColor(INK)
    for (const it of inv.line_items) {
      const descHeight = doc.heightOfString(it.desc || '—', { width: width * 0.53 })
      const rowH = Math.max(24, descHeight + 12)
      doc.fillColor(INK).font('Helvetica').fontSize(10)
      doc.text(it.desc || '—', cDesc + 8, y + 6, { width: width * 0.53 })
      doc.text(String(it.hours), cHours, y + 6, { width: width * 0.15, align: 'right' })
      doc.text(money(it.rateCents), cRate, y + 6, { width: width * 0.13, align: 'right' })
      doc.text(money(it.amountCents), cAmt - width * 0.16, y + 6, { width: width * 0.16 - 8, align: 'right' })
      y += rowH
      doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke()
      if (y > doc.page.height - 160) { doc.addPage(); y = 50 }
    }

    // ── Totals ──
    y += 14
    const totalsX = right - width * 0.38
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Subtotal', totalsX, y, { width: width * 0.22, align: 'left' })
    doc.fillColor(INK).text(money(inv.total_cents), totalsX, y, { width: width * 0.38, align: 'right' })
    y += 22
    doc.strokeColor(INK).lineWidth(1.5).moveTo(totalsX, y).lineTo(right, y).stroke()
    y += 8
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Total Due', totalsX, y, { width: width * 0.22, align: 'left' })
    doc.fillColor(ACCENT).text(money(inv.total_cents), totalsX, y, { width: width * 0.38, align: 'right' })
    y += 34

    // ── Notes + payment line ──
    if (inv.notes) {
      doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke()
      y += 12
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(inv.notes, left, y, { width })
      y = doc.y + 6
    }
    const payLine = inv.pay_method
      ? `Payment method: ${inv.pay_method}${inv.pay_method === 'ACH' ? ' · funded by credit card via Melio' : ''}`
      : ''
    if (payLine) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(payLine, left, y, { width })
    }

    doc.end()
  })
}
