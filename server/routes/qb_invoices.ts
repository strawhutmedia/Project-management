// Client-facing (AR) invoices via QuickBooks — the feature CLAUDE.md
// promised ("draft/send client estimates & invoices from Slate") but
// that never actually got built beyond the OAuth connect button. This
// is the real thing.
//
// The split that matters: creating an invoice in QuickBooks does NOT
// email anyone — QBO invoices are born as unsent drafts. Only a
// separate, explicit "send" call emails the client. So:
//
//   POST /api/qb/customers/search   → find a QBO customer
//   GET  /api/qb/items              → line-item picker (products/services)
//   POST /api/qb/invoices           → create a DRAFT. Never emails.
//   GET  /api/qb/invoices           → list recent invoices + send status,
//                                      for review
//   POST /api/qb/invoices/:id/send  → THE ONLY endpoint that emails a
//                                      client. Owner-only, and only ever
//                                      called by an explicit button press
//                                      in the UI — no automated code path
//                                      in this app calls it.
//
// Owner-only throughout, matching the rest of the QuickBooks/invoicing
// surface (requireOwner from ../auth).
import { Router } from 'express'
import { requireOwner } from '../auth'
import { logError, logInfo } from '../diag'
import { qbFetch } from '../quickbooks'

export const qbInvoicesRouter = Router()
qbInvoicesRouter.use(requireOwner)

// Escape a value for QBO's SQL-like query language (single quotes only —
// this is not a real SQL injection surface since qbFetch requires an
// authenticated owner session, but escaping keeps queries well-formed).
function qq(s: string): string {
  return s.replace(/'/g, "\\'")
}

type QbCustomer = { Id: string; DisplayName: string; PrimaryEmailAddr?: { Address?: string } }
type QbItem = { Id: string; Name: string; UnitPrice?: number; Type?: string }
type QbInvoiceLine = {
  Amount?: number
  Description?: string
  SalesItemLineDetail?: { ItemRef?: { value?: string; name?: string }; Qty?: number; UnitPrice?: number }
}
type QbInvoice = {
  Id: string
  SyncToken?: string
  DocNumber?: string
  TotalAmt?: number
  Balance?: number
  DueDate?: string
  TxnDate?: string
  CustomerRef?: { value?: string; name?: string }
  BillEmail?: { Address?: string }
  BillEmailCc?: { Address?: string }
  CustomerMemo?: { value?: string }
  EmailStatus?: string
  Line?: QbInvoiceLine[]
}

qbInvoicesRouter.get('/customers/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) { res.json({ customers: [] }); return }
  try {
    const data = await qbFetch(
      `/query?query=${encodeURIComponent(`SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE DisplayName LIKE '%${qq(q)}%' MAXRESULTS 15`)}`,
    ) as { QueryResponse?: { Customer?: QbCustomer[] } }
    const customers = (data.QueryResponse?.Customer ?? []).map((c) => ({
      id: c.Id, name: c.DisplayName, email: c.PrimaryEmailAddr?.Address ?? null,
    }))
    res.json({ customers })
  } catch (err) {
    logError('qb customer search failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'qb_error', detail: err instanceof Error ? err.message : String(err) })
  }
})

qbInvoicesRouter.get('/items', async (_req, res) => {
  try {
    const data = await qbFetch(
      `/query?query=${encodeURIComponent(`SELECT Id, Name, UnitPrice, Type FROM Item MAXRESULTS 200`)}`,
    ) as { QueryResponse?: { Item?: QbItem[] } }
    const items = (data.QueryResponse?.Item ?? [])
      .filter((i) => i.Type === 'Service' || i.Type === 'NonInventory')
      .map((i) => ({ id: i.Id, name: i.Name, unitPrice: i.UnitPrice ?? 0 }))
    res.json({ items })
  } catch (err) {
    logError('qb items list failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'qb_error', detail: err instanceof Error ? err.message : String(err) })
  }
})

function invoiceToApi(inv: QbInvoice) {
  return {
    id: inv.Id,
    docNumber: inv.DocNumber ?? '',
    total: inv.TotalAmt ?? 0,
    balance: inv.Balance ?? 0,
    dueDate: inv.DueDate ?? null,
    txnDate: inv.TxnDate ?? null,
    customerId: inv.CustomerRef?.value ?? null,
    customerName: inv.CustomerRef?.name ?? '',
    billEmail: inv.BillEmail?.Address ?? null,
    ccEmail: inv.BillEmailCc?.Address ?? null,
    note: inv.CustomerMemo?.value ?? '',
    // QBO's EmailStatus: 'NotSet' (never sent) | 'NeedToSend' | 'EmailSent'.
    sent: inv.EmailStatus === 'EmailSent',
    paid: (inv.Balance ?? inv.TotalAmt ?? 0) <= 0,
    lines: (inv.Line ?? [])
      .filter((l) => l.SalesItemLineDetail)
      .map((l) => ({
        itemId: l.SalesItemLineDetail?.ItemRef?.value ?? '',
        description: l.Description ?? '',
        qty: l.SalesItemLineDetail?.Qty ?? 1,
        rate: l.SalesItemLineDetail?.UnitPrice ?? 0,
        amount: l.Amount ?? 0,
      })),
  }
}

// GET recent invoices, for review before sending.
qbInvoicesRouter.get('/invoices', async (_req, res) => {
  try {
    const data = await qbFetch(
      `/query?query=${encodeURIComponent(`SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 40`)}`,
    ) as { QueryResponse?: { Invoice?: QbInvoice[] } }
    const invoices = (data.QueryResponse?.Invoice ?? []).map(invoiceToApi)
    res.json({ invoices })
  } catch (err) {
    logError('qb invoices list failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'qb_error', detail: err instanceof Error ? err.message : String(err) })
  }
})

// POST create a DRAFT invoice. This call does NOT email the customer —
// QuickBooks invoices are created unsent. Nothing reaches the client
// until someone clicks Send on it, below.
qbInvoicesRouter.post('/invoices', async (req, res) => {
  const body = req.body as {
    customerId?: string
    dueDate?: string
    txnDate?: string
    note?: string
    billEmail?: string
    ccEmail?: string
    lines?: Array<{ itemId: string; itemName?: string; description?: string; qty?: number; rate: number }>
  }
  const customerId = String(body.customerId || '').trim()
  const lines = Array.isArray(body.lines) ? body.lines : []
  if (!customerId) { res.status(400).json({ error: 'customer_required' }); return }
  if (lines.length === 0) { res.status(400).json({ error: 'line_items_required' }); return }

  const payload: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: lines.map((l) => ({
      DetailType: 'SalesItemLineDetail',
      Amount: (l.qty ?? 1) * l.rate,
      Description: l.description || undefined,
      SalesItemLineDetail: {
        ItemRef: { value: l.itemId },
        Qty: l.qty ?? 1,
        UnitPrice: l.rate,
      },
    })),
  }
  if (body.dueDate) payload.DueDate = body.dueDate
  if (body.txnDate) payload.TxnDate = body.txnDate
  if (body.note) payload.CustomerMemo = { value: body.note }
  if (body.billEmail) payload.BillEmail = { Address: body.billEmail }
  // Baked into the invoice itself (not the send call) — QBO CCs whoever
  // is on BillEmailCc automatically when the invoice is sent, so this
  // survives no matter who clicks Send or when.
  if (body.ccEmail) payload.BillEmailCc = { Address: body.ccEmail }

  try {
    const data = await qbFetch('/invoice', { method: 'POST', body: JSON.stringify(payload) }) as { Invoice?: QbInvoice }
    if (!data.Invoice) throw new Error('no_invoice_in_response')
    logInfo('qb invoice draft created', { invoiceId: data.Invoice.Id, customerId })
    res.json({ invoice: invoiceToApi(data.Invoice) })
  } catch (err) {
    logError('qb invoice create failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'qb_error', detail: err instanceof Error ? err.message : String(err) })
  }
})

// PUT edit an existing invoice — line items, dates, note, send-to/cc.
// Does NOT email anyone by itself, sent or not: this only edits the QBO
// record via a sparse update. If the invoice was already sent (e.g. it
// went out with a wrong recipient, wrong dates, or a missing CC), fixing
// it here and then hitting Send below is how a correction actually
// reaches the client — nothing here sends on its own.
qbInvoicesRouter.put('/invoices/:id', async (req, res) => {
  const id = req.params.id
  const body = req.body as {
    dueDate?: string
    note?: string
    billEmail?: string
    ccEmail?: string
    lines?: Array<{ itemId: string; description?: string; qty?: number; rate: number }>
  }
  const lines = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0) { res.status(400).json({ error: 'line_items_required' }); return }

  try {
    const current = await qbFetch(`/invoice/${id}`) as { Invoice?: QbInvoice }
    if (!current.Invoice) { res.status(404).json({ error: 'not_found' }); return }

    const payload: Record<string, unknown> = {
      Id: id,
      SyncToken: current.Invoice.SyncToken,
      sparse: true,
      CustomerRef: current.Invoice.CustomerRef,
      Line: lines.map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: (l.qty ?? 1) * l.rate,
        Description: l.description || undefined,
        SalesItemLineDetail: {
          ItemRef: { value: l.itemId },
          Qty: l.qty ?? 1,
          UnitPrice: l.rate,
        },
      })),
    }
    if (body.dueDate) payload.DueDate = body.dueDate
    if (body.note !== undefined) payload.CustomerMemo = { value: body.note }
    if (body.billEmail) payload.BillEmail = { Address: body.billEmail }
    if (body.ccEmail) payload.BillEmailCc = { Address: body.ccEmail }

    const data = await qbFetch('/invoice', { method: 'POST', body: JSON.stringify(payload) }) as { Invoice?: QbInvoice }
    if (!data.Invoice) throw new Error('no_invoice_in_response')
    logInfo('qb invoice updated', { invoiceId: id })
    res.json({ invoice: invoiceToApi(data.Invoice) })
  } catch (err) {
    logError('qb invoice update failed', { invoiceId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'qb_error', detail: err instanceof Error ? err.message : String(err) })
  }
})

// POST send — THE only endpoint in this file that emails a client.
// Works the same whether the invoice has never been sent or is being
// resent after a correction (QBO just re-sends). Owner-only (route-level
// requireOwner above), and only ever reachable via an explicit button
// press in the Invoicing UI.
qbInvoicesRouter.post('/invoices/:id/send', async (req, res) => {
  const id = req.params.id
  const sendTo = String(req.body?.sendTo || '').trim()
  if (!sendTo || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(sendTo)) {
    res.status(400).json({ error: 'valid_email_required' })
    return
  }
  try {
    const data = await qbFetch(`/invoice/${id}/send?sendTo=${encodeURIComponent(sendTo)}`, {
      method: 'POST',
      body: '{}',
    }) as { Invoice?: QbInvoice }
    logInfo('qb invoice sent', { invoiceId: id, sendTo })
    res.json({ ok: true, invoice: data.Invoice ? invoiceToApi(data.Invoice) : null })
  } catch (err) {
    logError('qb invoice send failed', { invoiceId: id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'qb_error', detail: err instanceof Error ? err.message : String(err) })
  }
})
