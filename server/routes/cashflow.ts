import { Router, type Request } from 'express'
import { pool } from '../db'
import { requireOwnerOrService, type SessionUser } from '../auth'
import { logError } from '../diag'

// Cash flow tracker — Ryan's owner-only money log. He records every incoming
// and outgoing amount; the app keeps a running balance plus a month-by-month
// view of cash flow. See migration 104_cashflow.sql. Locked to the single
// owner account the same way invoicing is; the service token also works so
// entries can be logged by automation on Ryan's behalf.
export const cashflowRouter = Router()
cashflowRouter.use(requireOwnerOrService)

// ── helpers ───────────────────────────────────────────────────────────
function toCents(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

// pg returns DATE columns as JS Date objects; coerce to plain 'YYYY-MM-DD'
// so the client renders the intended day regardless of timezone.
function toDateStr(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime())
}

type EntryRow = {
  id: string; kind: 'in' | 'out'; amount_cents: string | number
  occurred_on: string | Date; category: string; counterparty: string
  notes: string; created_at: string; updated_at: string
}

function mapEntry(r: EntryRow) {
  return {
    id: r.id, kind: r.kind, amountCents: Number(r.amount_cents),
    occurredOn: toDateStr(r.occurred_on), category: r.category,
    counterparty: r.counterparty, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

// Validate + normalize an entry payload. Returns null with an error string
// when the payload can't make a sane entry.
function parseEntryBody(body: Record<string, unknown>, partial: boolean) {
  const out: { kind?: 'in' | 'out'; amountCents?: number; occurredOn?: string; category?: string; counterparty?: string; notes?: string } = {}
  if (!partial || body.kind !== undefined) {
    const kind = String(body.kind ?? '')
    if (kind !== 'in' && kind !== 'out') return { error: 'kind must be "in" or "out"' }
    out.kind = kind
  }
  if (!partial || body.amountCents !== undefined) {
    const amountCents = toCents(body.amountCents)
    if (amountCents <= 0) return { error: 'amount must be greater than zero' }
    out.amountCents = amountCents
  }
  if (!partial || body.occurredOn !== undefined) {
    const occurredOn = String(body.occurredOn ?? '').slice(0, 10)
    if (!isValidDate(occurredOn)) return { error: 'occurredOn must be YYYY-MM-DD' }
    out.occurredOn = occurredOn
  }
  if (!partial || body.category !== undefined) out.category = String(body.category ?? '').slice(0, 120)
  if (!partial || body.counterparty !== undefined) out.counterparty = String(body.counterparty ?? '').slice(0, 200)
  if (!partial || body.notes !== undefined) out.notes = String(body.notes ?? '').slice(0, 2000)
  return { value: out }
}

async function loadSettings() {
  const { rows } = await pool.query(
    `SELECT starting_balance_cents, starting_date FROM cashflow_settings WHERE id = 1`,
  )
  const s = rows[0] ?? { starting_balance_cents: 0, starting_date: new Date() }
  return {
    startingBalanceCents: Number(s.starting_balance_cents),
    startingDate: toDateStr(s.starting_date),
  }
}

// ── overview: balance + monthly series + category breakdown ──────────
cashflowRouter.get('/overview', async (_req, res) => {
  try {
    const settings = await loadSettings()

    const totals = await pool.query(
      `SELECT
         COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'in'), 0)  AS in_cents,
         COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'out'), 0) AS out_cents,
         COUNT(*) AS entry_count
       FROM cashflow_entries`,
    )
    const allIn = Number(totals.rows[0].in_cents)
    const allOut = Number(totals.rows[0].out_cents)
    const currentBalanceCents = settings.startingBalanceCents + allIn - allOut

    // Every month that has entries, oldest first, so the client can compute
    // a running ending balance per month.
    const monthly = await pool.query(
      `SELECT to_char(occurred_on, 'YYYY-MM') AS month,
              COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'in'), 0)  AS in_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'out'), 0) AS out_cents
       FROM cashflow_entries
       GROUP BY 1 ORDER BY 1 ASC`,
    )
    let running = settings.startingBalanceCents
    const months = monthly.rows.map((r) => {
      const inCents = Number(r.in_cents)
      const outCents = Number(r.out_cents)
      running += inCents - outCents
      return { month: r.month as string, inCents, outCents, netCents: inCents - outCents, endingBalanceCents: running }
    })

    // Category breakdown for the current calendar month (both directions).
    const categories = await pool.query(
      `SELECT kind, COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
              SUM(amount_cents) AS total_cents
       FROM cashflow_entries
       WHERE to_char(occurred_on, 'YYYY-MM') = to_char(CURRENT_DATE, 'YYYY-MM')
       GROUP BY 1, 2 ORDER BY total_cents DESC`,
    )

    res.json({
      settings,
      currentBalanceCents,
      totalInCents: allIn,
      totalOutCents: allOut,
      entryCount: Number(totals.rows[0].entry_count),
      months,
      currentMonthCategories: categories.rows.map((r) => ({
        kind: r.kind as 'in' | 'out',
        category: r.category as string,
        totalCents: Number(r.total_cents),
      })),
    })
  } catch (err) {
    logError('cashflow_overview_failed', { err: String(err) })
    res.status(500).json({ error: 'overview_failed' })
  }
})

// ── entries ───────────────────────────────────────────────────────────
cashflowRouter.get('/entries', async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500)
    const params: unknown[] = []
    let where = ''
    if (month) {
      params.push(month)
      where = `WHERE to_char(occurred_on, 'YYYY-MM') = $1`
    }
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT id, kind, amount_cents, occurred_on, category, counterparty, notes, created_at, updated_at
       FROM cashflow_entries ${where}
       ORDER BY occurred_on DESC, created_at DESC
       LIMIT $${params.length}`,
      params,
    )
    res.json({ entries: rows.map(mapEntry) })
  } catch (err) {
    logError('cashflow_entries_failed', { err: String(err) })
    res.status(500).json({ error: 'entries_failed' })
  }
})

cashflowRouter.post('/entries', async (req, res) => {
  try {
    const parsed = parseEntryBody((req.body ?? {}) as Record<string, unknown>, false)
    if ('error' in parsed) { res.status(400).json({ error: 'invalid_entry', detail: parsed.error }); return }
    const e = parsed.value!
    const user = (req as Request & { user: SessionUser }).user
    const { rows } = await pool.query(
      `INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, kind, amount_cents, occurred_on, category, counterparty, notes, created_at, updated_at`,
      [e.kind, e.amountCents, e.occurredOn, e.category ?? '', e.counterparty ?? '', e.notes ?? '', user.id],
    )
    res.json({ entry: mapEntry(rows[0]) })
  } catch (err) {
    logError('cashflow_create_failed', { err: String(err) })
    res.status(500).json({ error: 'create_failed' })
  }
})

cashflowRouter.patch('/entries/:id', async (req, res) => {
  try {
    const parsed = parseEntryBody((req.body ?? {}) as Record<string, unknown>, true)
    if ('error' in parsed) { res.status(400).json({ error: 'invalid_entry', detail: parsed.error }); return }
    const e = parsed.value!
    const sets: string[] = []
    const params: unknown[] = []
    const push = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`) }
    if (e.kind !== undefined) push('kind', e.kind)
    if (e.amountCents !== undefined) push('amount_cents', e.amountCents)
    if (e.occurredOn !== undefined) push('occurred_on', e.occurredOn)
    if (e.category !== undefined) push('category', e.category)
    if (e.counterparty !== undefined) push('counterparty', e.counterparty)
    if (e.notes !== undefined) push('notes', e.notes)
    if (!sets.length) { res.status(400).json({ error: 'invalid_entry', detail: 'nothing to update' }); return }
    params.push(req.params.id)
    const { rows } = await pool.query(
      `UPDATE cashflow_entries SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING id, kind, amount_cents, occurred_on, category, counterparty, notes, created_at, updated_at`,
      params,
    )
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ entry: mapEntry(rows[0]) })
  } catch (err) {
    logError('cashflow_update_failed', { err: String(err) })
    res.status(500).json({ error: 'update_failed' })
  }
})

cashflowRouter.delete('/entries/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM cashflow_entries WHERE id = $1`, [req.params.id])
    if (!rowCount) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ ok: true })
  } catch (err) {
    logError('cashflow_delete_failed', { err: String(err) })
    res.status(500).json({ error: 'delete_failed' })
  }
})

// ── settings (opening balance) ────────────────────────────────────────
cashflowRouter.patch('/settings', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const sets: string[] = []
    const params: unknown[] = []
    if (body.startingBalanceCents !== undefined) {
      params.push(toCents(body.startingBalanceCents))
      sets.push(`starting_balance_cents = $${params.length}`)
    }
    if (body.startingDate !== undefined) {
      const d = String(body.startingDate ?? '').slice(0, 10)
      if (!isValidDate(d)) { res.status(400).json({ error: 'invalid_settings', detail: 'startingDate must be YYYY-MM-DD' }); return }
      params.push(d)
      sets.push(`starting_date = $${params.length}`)
    }
    if (!sets.length) { res.status(400).json({ error: 'invalid_settings', detail: 'nothing to update' }); return }
    await pool.query(`UPDATE cashflow_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`, params)
    res.json({ settings: await loadSettings() })
  } catch (err) {
    logError('cashflow_settings_failed', { err: String(err) })
    res.status(500).json({ error: 'settings_failed' })
  }
})
