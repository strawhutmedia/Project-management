import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db'
import { requireOwnerOrService, makeToken, type SessionUser } from '../auth'
import { logError } from '../diag'
import { renderInvoicePdf, type InvoiceLineItem } from '../invoice_pdf'
import { sendInvoiceEmail } from '../email'
import { vaultReady } from '../crypto_vault'

// Contractor invoicing — Ryan's payroll tool. Admin-only. Turns a
// freelancer's monthly hours into a saved, numbered invoice with a clear
// total to pay by credit card via Melio. See migration 095_invoicing.sql.
export const invoicingRouter = Router()
// Locked to the single owner account (ryan@strawhutmedia.com) — every
// endpoint below returns 403 for anyone else, admins included. Also accepts
// the INVOICING_SERVICE_TOKEN header for the monthly invoice automation.
invoicingRouter.use(requireOwnerOrService)

// ── helpers ───────────────────────────────────────────────────────────
function money(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toCents(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

// pg returns DATE columns as JS Date objects; coerce to a plain 'YYYY-MM-DD'
// so the client (and PDF) render the intended day regardless of timezone.
function toDateStr(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

// Normalize + re-total line items server-side (never trust the client total).
function normalizeItems(raw: unknown): { items: InvoiceLineItem[]; totalCents: number } {
  const arr = Array.isArray(raw) ? raw : []
  const items: InvoiceLineItem[] = []
  let totalCents = 0
  for (const r of arr) {
    const o = (r ?? {}) as Record<string, unknown>
    const desc = String(o.desc ?? '').slice(0, 500)
    const hours = Number.isFinite(Number(o.hours)) ? Math.round(Number(o.hours) * 100) / 100 : 0
    const rateCents = toCents(o.rateCents)
    if (!desc && !hours) continue
    const amountCents = Math.round(hours * rateCents)
    items.push({ desc, hours, rateCents, amountCents })
    totalCents += amountCents
  }
  return { items, totalCents }
}

type ContractorRow = {
  id: string; name: string; email: string; hourly_rate_cents: number
  pay_method: string; address: string; notes: string; archived: boolean
  created_at: string; updated_at: string
  legal_name?: string; business_name?: string; tax_classification?: string
  tin_type?: string; tin_last4?: string; phone?: string
  is_us_person?: boolean; prefers_ach?: boolean
  w9_signature?: string; w9_signed_at?: string | null
  w9_status?: string; w9_submitted_at?: string | null
}

function mapContractor(r: ContractorRow) {
  const maskedTin = r.tin_last4
    ? (r.tin_type === 'ein' ? `••-•••${r.tin_last4}` : `•••-••-${r.tin_last4}`)
    : ''
  return {
    id: r.id, name: r.name, email: r.email, hourlyRateCents: r.hourly_rate_cents,
    payMethod: r.pay_method, address: r.address, notes: r.notes, archived: r.archived,
    createdAt: r.created_at, updatedAt: r.updated_at,
    // W9 / vendor intake (TIN is never returned in full — only masked last-4)
    w9Status: r.w9_status || 'none',
    w9SubmittedAt: r.w9_submitted_at || null,
    legalName: r.legal_name || '', businessName: r.business_name || '',
    taxClassification: r.tax_classification || '', tinType: r.tin_type || '',
    tinMasked: maskedTin, phone: r.phone || '',
    prefersAch: r.prefers_ach ?? false, w9Signature: r.w9_signature || '',
    w9SignedAt: r.w9_signed_at || null,
  }
}

type InvoiceRow = {
  id: string; number: string; contractor_id: string | null
  contractor_name: string; contractor_email: string; contractor_address: string
  pay_method: string; period: string; issue_date: string | Date
  line_items: InvoiceLineItem[]; total_cents: number; notes: string
  status: string; paid_at: string | null; created_at: string; updated_at: string
}

function mapInvoice(r: InvoiceRow) {
  return {
    id: r.id, number: r.number, contractorId: r.contractor_id,
    contractorName: r.contractor_name, contractorEmail: r.contractor_email,
    contractorAddress: r.contractor_address, payMethod: r.pay_method,
    period: r.period, issueDate: toDateStr(r.issue_date),
    lineItems: r.line_items, totalCents: r.total_cents, notes: r.notes,
    status: r.status, paidAt: r.paid_at, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

async function loadSettings() {
  const { rows } = await pool.query(
    `SELECT company_name, company_email, company_address, logo_data_url, invoice_prefix, next_number
       FROM invoice_settings WHERE id = 1`,
  )
  return rows[0]
}

// ── settings ──────────────────────────────────────────────────────────
invoicingRouter.get('/settings', async (_req, res) => {
  try {
    const s = await loadSettings()
    res.json({
      settings: {
        companyName: s.company_name, companyEmail: s.company_email, companyAddress: s.company_address,
        logoDataUrl: s.logo_data_url, invoicePrefix: s.invoice_prefix, nextNumber: s.next_number,
      },
    })
  } catch (err) {
    logError('invoicing settings GET failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.patch('/settings', async (req, res) => {
  const b = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  const push = (col: string, val: unknown) => { updates.push(`${col} = $${i++}`); values.push(val) }
  if (typeof b.companyName === 'string') push('company_name', b.companyName.trim().slice(0, 200) || 'Straw Hut Media')
  if (typeof b.companyEmail === 'string') push('company_email', b.companyEmail.trim().slice(0, 200))
  if (typeof b.companyAddress === 'string') push('company_address', b.companyAddress.trim().slice(0, 400))
  if (b.logoDataUrl === null) push('logo_data_url', null)
  else if (typeof b.logoDataUrl === 'string') {
    const v = b.logoDataUrl.trim()
    if (v && !/^data:image\/(png|jpe?g|svg\+xml);base64,|^data:image\/svg\+xml,/.test(v)) {
      res.status(400).json({ error: 'bad_logo', detail: 'Logo must be a PNG, JPG, or SVG image.' }); return
    }
    if (v.length > 1_500_000) { res.status(400).json({ error: 'logo_too_large', detail: 'Logo image is too large (max ~1MB).' }); return }
    push('logo_data_url', v || null)
  }
  if (typeof b.invoicePrefix === 'string') push('invoice_prefix', b.invoicePrefix.trim().slice(0, 12) || 'SHM')
  if (Number.isFinite(Number(b.nextNumber))) push('next_number', Math.max(1, Math.round(Number(b.nextNumber))))
  if (!updates.length) { res.status(400).json({ error: 'no_fields' }); return }
  push('updated_at', new Date().toISOString())
  try {
    await pool.query(`UPDATE invoice_settings SET ${updates.join(', ')} WHERE id = 1`, values)
    const s = await loadSettings()
    res.json({
      settings: {
        companyName: s.company_name, companyEmail: s.company_email, companyAddress: s.company_address,
        logoDataUrl: s.logo_data_url, invoicePrefix: s.invoice_prefix, nextNumber: s.next_number,
      },
    })
  } catch (err) {
    logError('invoicing settings PATCH failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── contractors ───────────────────────────────────────────────────────
invoicingRouter.get('/contractors', async (req, res) => {
  try {
    const includeArchived = req.query.all === '1'
    const { rows } = await pool.query<ContractorRow>(
      `SELECT * FROM contractors ${includeArchived ? '' : 'WHERE archived = FALSE'} ORDER BY name ASC`,
    )
    res.json({ contractors: rows.map(mapContractor) })
  } catch (err) {
    logError('contractors GET failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.post('/contractors', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const b = req.body ?? {}
  const name = String(b.name ?? '').trim()
  if (!name) { res.status(400).json({ error: 'name_required' }); return }
  const payMethod = ['ACH', 'Check', 'Other'].includes(b.payMethod) ? b.payMethod : 'ACH'
  try {
    const { rows } = await pool.query<ContractorRow>(
      `INSERT INTO contractors (name, email, hourly_rate_cents, pay_method, address, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name.slice(0, 200), String(b.email ?? '').trim().slice(0, 200), toCents(b.hourlyRateCents),
       payMethod, String(b.address ?? '').trim().slice(0, 400), String(b.notes ?? '').trim().slice(0, 1000), user.id],
    )
    res.json({ contractor: mapContractor(rows[0]) })
  } catch (err) {
    logError('contractors POST failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.patch('/contractors/:id', async (req, res) => {
  const b = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  const push = (col: string, val: unknown) => { updates.push(`${col} = $${i++}`); values.push(val) }
  if (typeof b.name === 'string' && b.name.trim()) push('name', b.name.trim().slice(0, 200))
  if (typeof b.email === 'string') push('email', b.email.trim().slice(0, 200))
  if (b.hourlyRateCents !== undefined) push('hourly_rate_cents', toCents(b.hourlyRateCents))
  if (['ACH', 'Check', 'Other'].includes(b.payMethod)) push('pay_method', b.payMethod)
  if (typeof b.address === 'string') push('address', b.address.trim().slice(0, 400))
  if (typeof b.notes === 'string') push('notes', b.notes.trim().slice(0, 1000))
  if (typeof b.archived === 'boolean') push('archived', b.archived)
  if (!updates.length) { res.status(400).json({ error: 'no_fields' }); return }
  push('updated_at', new Date().toISOString())
  values.push(req.params.id)
  try {
    const { rows } = await pool.query<ContractorRow>(
      `UPDATE contractors SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values,
    )
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ contractor: mapContractor(rows[0]) })
  } catch (err) {
    logError('contractors PATCH failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.delete('/contractors/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM contractors WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    logError('contractors DELETE failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Is secure W9 storage configured? (INVOICING_ENC_KEY present)
invoicingRouter.get('/vault-status', (_req, res) => {
  res.json({ ready: vaultReady() })
})

// Generate (or regenerate) a private vendor intake link for a contractor.
// The raw token is returned once; only its sha256 hash is stored.
invoicingRouter.post('/contractors/:id/intake-link', async (req, res) => {
  try {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM contractors WHERE id = $1`, [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    const token = makeToken(24)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const days = 21
    await pool.query(
      `UPDATE contractors
         SET intake_token_hash = $2,
             intake_expires_at = now() + ($3 || ' days')::interval,
             w9_status = CASE WHEN w9_status = 'on_file' THEN w9_status ELSE 'requested' END,
             updated_at = now()
       WHERE id = $1`,
      [req.params.id, tokenHash, String(days)],
    )
    const base = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
    res.json({ url: `${base}/vendor/${token}`, expiresInDays: days, vaultReady: vaultReady() })
  } catch (err) {
    logError('intake-link POST failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── invoices ──────────────────────────────────────────────────────────
invoicingRouter.get('/invoices', async (_req, res) => {
  try {
    const { rows } = await pool.query<InvoiceRow>(
      `SELECT * FROM invoices ORDER BY created_at DESC`,
    )
    res.json({ invoices: rows.map(mapInvoice) })
  } catch (err) {
    logError('invoices GET failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.get('/invoices/:id', async (req, res) => {
  try {
    const { rows } = await pool.query<InvoiceRow>(`SELECT * FROM invoices WHERE id = $1`, [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ invoice: mapInvoice(rows[0]) })
  } catch (err) {
    logError('invoice GET failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.post('/invoices', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const b = req.body ?? {}
  const { items, totalCents } = normalizeItems(b.lineItems)
  if (!items.length) { res.status(400).json({ error: 'no_items', detail: 'Add at least one line with hours.' }); return }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Snapshot contractor details onto the invoice.
    let cName = String(b.contractorName ?? '').trim()
    let cEmail = String(b.contractorEmail ?? '').trim()
    let cAddress = String(b.contractorAddress ?? '').trim()
    let payMethod = ['ACH', 'Check', 'Other'].includes(b.payMethod) ? b.payMethod : 'ACH'
    if (b.contractorId) {
      const { rows: cr } = await client.query<ContractorRow>(`SELECT * FROM contractors WHERE id = $1`, [b.contractorId])
      if (cr[0]) { cName = cName || cr[0].name; cEmail = cEmail || cr[0].email; cAddress = cAddress || cr[0].address; payMethod = cr[0].pay_method }
    }
    // Invoice number: use provided, else generate from settings + increment.
    let number = String(b.number ?? '').trim()
    if (!number) {
      const { rows: sr } = await client.query<{ invoice_prefix: string; next_number: number }>(
        `SELECT invoice_prefix, next_number FROM invoice_settings WHERE id = 1 FOR UPDATE`,
      )
      const prefix = sr[0]?.invoice_prefix || 'SHM'
      const n = sr[0]?.next_number || 1
      number = `${prefix}-${String(n).padStart(4, '0')}`
      await client.query(`UPDATE invoice_settings SET next_number = $1 WHERE id = 1`, [n + 1])
    }
    const status = ['draft', 'unpaid', 'paid'].includes(b.status) ? b.status : 'unpaid'
    const { rows } = await client.query<InvoiceRow>(
      `INSERT INTO invoices
        (number, contractor_id, contractor_name, contractor_email, contractor_address,
         pay_method, period, issue_date, line_items, total_cents, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, CURRENT_DATE),$9,$10,$11,$12,$13) RETURNING *`,
      [number, b.contractorId || null, cName.slice(0, 200), cEmail.slice(0, 200), cAddress.slice(0, 400),
       payMethod, String(b.period ?? '').trim().slice(0, 120), b.issueDate || null,
       JSON.stringify(items), totalCents, String(b.notes ?? '').trim().slice(0, 2000), status, user.id],
    )
    await client.query('COMMIT')
    res.json({ invoice: mapInvoice(rows[0]) })
  } catch (err) {
    await client.query('ROLLBACK')
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('idx_invoices_number')) { res.status(409).json({ error: 'duplicate_number', detail: 'That invoice number already exists.' }); return }
    logError('invoice POST failed', { error: msg })
    res.status(500).json({ error: 'internal_error', detail: msg })
  } finally {
    client.release()
  }
})

invoicingRouter.patch('/invoices/:id', async (req, res) => {
  const b = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  const push = (col: string, val: unknown) => { updates.push(`${col} = $${i++}`); values.push(val) }
  if (typeof b.number === 'string' && b.number.trim()) push('number', b.number.trim().slice(0, 60))
  if (typeof b.contractorName === 'string') push('contractor_name', b.contractorName.trim().slice(0, 200))
  if (typeof b.contractorEmail === 'string') push('contractor_email', b.contractorEmail.trim().slice(0, 200))
  if (typeof b.contractorAddress === 'string') push('contractor_address', b.contractorAddress.trim().slice(0, 400))
  if (['ACH', 'Check', 'Other'].includes(b.payMethod)) push('pay_method', b.payMethod)
  if (typeof b.period === 'string') push('period', b.period.trim().slice(0, 120))
  if (typeof b.issueDate === 'string' && b.issueDate) push('issue_date', b.issueDate)
  if (typeof b.notes === 'string') push('notes', b.notes.trim().slice(0, 2000))
  if (b.lineItems !== undefined) {
    const { items, totalCents } = normalizeItems(b.lineItems)
    push('line_items', JSON.stringify(items))
    push('total_cents', totalCents)
  }
  if (['draft', 'unpaid', 'paid'].includes(b.status)) {
    push('status', b.status)
    push('paid_at', b.status === 'paid' ? new Date().toISOString() : null)
  }
  if (!updates.length) { res.status(400).json({ error: 'no_fields' }); return }
  push('updated_at', new Date().toISOString())
  values.push(req.params.id)
  try {
    const { rows } = await pool.query<InvoiceRow>(
      `UPDATE invoices SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values,
    )
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ invoice: mapInvoice(rows[0]) })
  } catch (err) {
    logError('invoice PATCH failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

invoicingRouter.delete('/invoices/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM invoices WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    logError('invoice DELETE failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// PDF download
invoicingRouter.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query<InvoiceRow>(`SELECT * FROM invoices WHERE id = $1`, [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    const s = await loadSettings()
    const pdf = await renderInvoicePdf(
      { ...rows[0], issue_date: toDateStr(rows[0].issue_date) },
      { company_name: s.company_name, company_email: s.company_email, company_address: s.company_address, logo_data_url: s.logo_data_url },
    )
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`)
    res.send(pdf)
  } catch (err) {
    logError('invoice PDF failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Email the invoice (with PDF attached) to the contractor
invoicingRouter.post('/invoices/:id/email', async (req, res) => {
  try {
    const { rows } = await pool.query<InvoiceRow>(`SELECT * FROM invoices WHERE id = $1`, [req.params.id])
    const inv = rows[0]
    if (!inv) { res.status(404).json({ error: 'not_found' }); return }
    const to = String(req.body?.to ?? inv.contractor_email ?? '').trim()
    if (!to) { res.status(400).json({ error: 'no_recipient', detail: 'This contractor has no email address.' }); return }
    const s = await loadSettings()
    const pdf = await renderInvoicePdf(
      { ...inv, issue_date: toDateStr(inv.issue_date) },
      { company_name: s.company_name, company_email: s.company_email, company_address: s.company_address, logo_data_url: s.logo_data_url },
    )
    await sendInvoiceEmail({
      to,
      replyTo: s.company_email || undefined,
      companyName: s.company_name,
      contractorName: inv.contractor_name || 'there',
      invoiceNumber: inv.number,
      period: inv.period,
      totalLabel: money(inv.total_cents),
      payMethod: inv.pay_method || 'your usual method',
      pdf,
    })
    res.json({ ok: true, sentTo: to })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('invoice email failed', { error: msg })
    res.status(500).json({ error: 'email_failed', detail: msg })
  }
})
