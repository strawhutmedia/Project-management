import { Router, type Request } from 'express'
import { pool } from '../db'
import { requireOwnerOrService, type SessionUser } from '../auth'
import { logError } from '../diag'
import { runCashflowPaymentCheckNow } from '../cashflow_payment_check'

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
  notes: string; is_recurring: boolean; created_at: string; updated_at: string
}

function mapEntry(r: EntryRow) {
  return {
    id: r.id, kind: r.kind, amountCents: Number(r.amount_cents),
    occurredOn: toDateStr(r.occurred_on), category: r.category,
    counterparty: r.counterparty, notes: r.notes, isRecurring: r.is_recurring,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

// Validate + normalize an entry payload. Returns null with an error string
// when the payload can't make a sane entry.
function parseEntryBody(body: Record<string, unknown>, partial: boolean) {
  const out: { kind?: 'in' | 'out'; amountCents?: number; occurredOn?: string; category?: string; counterparty?: string; notes?: string; isRecurring?: boolean } = {}
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
  // Recurring monthly item (payroll, a retainer client, a subscription) vs a
  // one-off/lumpy amount (a single project payment, a one-time purchase).
  // Defaults to true on create — most logged entries are the steady baseline;
  // a one-time item is the exception and gets flagged false explicitly.
  if (!partial) out.isRecurring = body.isRecurring === false ? false : true
  else if (body.isRecurring !== undefined) out.isRecurring = body.isRecurring !== false
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

type PipelineDealRow = {
  id: string; name: string; estimated_mrr_cents: string | number
  stage: string; notes: string; created_at: string; updated_at: string
}

function mapDeal(r: PipelineDealRow) {
  return {
    id: r.id, name: r.name, estimatedMrrCents: Number(r.estimated_mrr_cents),
    stage: r.stage as 'prospecting' | 'quoted' | 'negotiating' | 'won' | 'lost',
    notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

const PIPELINE_STAGES = ['prospecting', 'quoted', 'negotiating', 'won', 'lost']

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

    // Recurring baseline: the current steady monthly picture, NOT locked to
    // whatever happens to be dated in the current calendar month. Recurring
    // entries are corrected in place (an UPDATE when a client's real rate
    // changes) rather than re-logged every month, so pin each counterparty
    // to its most recent recurring row and sum those — this stays accurate
    // whether the month just rolled over or not.
    const recurringLatest = await pool.query(
      `SELECT kind, COALESCE(SUM(amount_cents), 0) AS total_cents
       FROM (
         SELECT DISTINCT ON (kind, counterparty) kind, amount_cents
         FROM cashflow_entries
         WHERE is_recurring = true
         ORDER BY kind, counterparty, occurred_on DESC, created_at DESC
       ) latest
       GROUP BY 1`,
    )
    const recurringInCents = Number(recurringLatest.rows.find((r) => r.kind === 'in')?.total_cents ?? 0)
    const recurringOutCents = Number(recurringLatest.rows.find((r) => r.kind === 'out')?.total_cents ?? 0)

    // Same "latest recurring row per counterparty" logic as above, but the
    // itemized list instead of just the sum — a checklist Ryan can actually
    // read line by line and check against reality, not just trust a total.
    const recurringChecklistRows = await pool.query(
      `SELECT DISTINCT ON (kind, counterparty) kind, counterparty, category, amount_cents
       FROM cashflow_entries
       WHERE is_recurring = true
       ORDER BY kind, counterparty, occurred_on DESC, created_at DESC`,
    )
    const recurringChecklist = {
      in: recurringChecklistRows.rows
        .filter((r) => r.kind === 'in')
        .map((r) => ({ counterparty: r.counterparty as string, category: r.category as string, amountCents: Number(r.amount_cents) }))
        .sort((a, b) => b.amountCents - a.amountCents),
      out: recurringChecklistRows.rows
        .filter((r) => r.kind === 'out')
        .map((r) => ({ counterparty: r.counterparty as string, category: r.category as string, amountCents: Number(r.amount_cents) }))
        .sort((a, b) => b.amountCents - a.amountCents),
    }

    // One-time/lumpy money (Disney-style project payments, a one-off
    // purchase) is a real dated event, so this one stays scoped to the
    // current calendar month — a single big win shouldn't inflate every
    // month going forward the way a stale recurring row would.
    const oneTime = await pool.query(
      `SELECT kind, COALESCE(SUM(amount_cents), 0) AS total_cents
       FROM cashflow_entries
       WHERE is_recurring = false AND to_char(occurred_on, 'YYYY-MM') = to_char(CURRENT_DATE, 'YYYY-MM')
       GROUP BY 1`,
    )
    const oneTimeInCents = Number(oneTime.rows.find((r) => r.kind === 'in')?.total_cents ?? 0)
    const oneTimeOutCents = Number(oneTime.rows.find((r) => r.kind === 'out')?.total_cents ?? 0)

    // Growth pipeline — target MRR vs current recurring income, plus the
    // working list of prospective new-client deals that could close the gap.
    const targetRow = await pool.query(
      `SELECT target_mrr_cents FROM cashflow_growth_target WHERE id = 1`,
    )
    const targetMrrCents = Number(targetRow.rows[0]?.target_mrr_cents ?? 8000000)
    const deals = await pool.query(
      `SELECT id, name, estimated_mrr_cents, stage, notes, created_at, updated_at
       FROM cashflow_pipeline_deals
       ORDER BY CASE stage
         WHEN 'negotiating' THEN 0 WHEN 'quoted' THEN 1 WHEN 'prospecting' THEN 2
         WHEN 'won' THEN 3 WHEN 'lost' THEN 4 ELSE 5 END, updated_at DESC`,
    )
    const openPipelineCents = deals.rows
      .filter((r) => r.stage !== 'lost' && r.stage !== 'won')
      .reduce((sum, r) => sum + Number(r.estimated_mrr_cents), 0)

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
      recurringChecklist,
      currentMonthBaseline: {
        recurringInCents, recurringOutCents,
        recurringNetCents: recurringInCents - recurringOutCents,
        oneTimeInCents, oneTimeOutCents,
        oneTimeNetCents: oneTimeInCents - oneTimeOutCents,
      },
      growthPipeline: {
        targetMrrCents,
        currentMrrCents: recurringInCents,
        gapCents: Math.max(0, targetMrrCents - recurringInCents),
        openPipelineCents,
        deals: deals.rows.map(mapDeal),
      },
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
      `SELECT id, kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring, created_at, updated_at
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
      `INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring, created_at, updated_at`,
      [e.kind, e.amountCents, e.occurredOn, e.category ?? '', e.counterparty ?? '', e.notes ?? '', e.isRecurring ?? true, user.id],
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
    if (e.isRecurring !== undefined) push('is_recurring', e.isRecurring)
    if (!sets.length) { res.status(400).json({ error: 'invalid_entry', detail: 'nothing to update' }); return }
    params.push(req.params.id)
    const { rows } = await pool.query(
      `UPDATE cashflow_entries SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING id, kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring, created_at, updated_at`,
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

// ── growth pipeline: target MRR + prospective deals ───────────────────
cashflowRouter.patch('/growth-target', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const targetMrrCents = toCents(body.targetMrrCents)
    if (targetMrrCents <= 0) { res.status(400).json({ error: 'invalid_target', detail: 'targetMrrCents must be greater than zero' }); return }
    await pool.query(
      `UPDATE cashflow_growth_target SET target_mrr_cents = $1, updated_at = now() WHERE id = 1`,
      [targetMrrCents],
    )
    res.json({ targetMrrCents })
  } catch (err) {
    logError('cashflow_growth_target_failed', { err: String(err) })
    res.status(500).json({ error: 'growth_target_failed' })
  }
})

function parseDealBody(body: Record<string, unknown>, partial: boolean) {
  const out: { name?: string; estimatedMrrCents?: number; stage?: string; notes?: string } = {}
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim().slice(0, 200)
    if (!name) return { error: 'name is required' }
    out.name = name
  }
  if (!partial || body.estimatedMrrCents !== undefined) {
    out.estimatedMrrCents = Math.max(0, toCents(body.estimatedMrrCents))
  }
  if (!partial || body.stage !== undefined) {
    const stage = String(body.stage ?? 'prospecting')
    if (!PIPELINE_STAGES.includes(stage)) return { error: `stage must be one of: ${PIPELINE_STAGES.join(', ')}` }
    out.stage = stage
  }
  if (!partial || body.notes !== undefined) out.notes = String(body.notes ?? '').slice(0, 2000)
  return { value: out }
}

cashflowRouter.post('/pipeline', async (req, res) => {
  try {
    const parsed = parseDealBody((req.body ?? {}) as Record<string, unknown>, false)
    if ('error' in parsed) { res.status(400).json({ error: 'invalid_deal', detail: parsed.error }); return }
    const d = parsed.value!
    const user = (req as Request & { user: SessionUser }).user
    const { rows } = await pool.query(
      `INSERT INTO cashflow_pipeline_deals (name, estimated_mrr_cents, stage, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, estimated_mrr_cents, stage, notes, created_at, updated_at`,
      [d.name, d.estimatedMrrCents ?? 0, d.stage ?? 'prospecting', d.notes ?? '', user.id],
    )
    res.json({ deal: mapDeal(rows[0]) })
  } catch (err) {
    logError('cashflow_pipeline_create_failed', { err: String(err) })
    res.status(500).json({ error: 'create_failed' })
  }
})

cashflowRouter.patch('/pipeline/:id', async (req, res) => {
  try {
    const parsed = parseDealBody((req.body ?? {}) as Record<string, unknown>, true)
    if ('error' in parsed) { res.status(400).json({ error: 'invalid_deal', detail: parsed.error }); return }
    const d = parsed.value!
    const sets: string[] = []
    const params: unknown[] = []
    const push = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`) }
    if (d.name !== undefined) push('name', d.name)
    if (d.estimatedMrrCents !== undefined) push('estimated_mrr_cents', d.estimatedMrrCents)
    if (d.stage !== undefined) push('stage', d.stage)
    if (d.notes !== undefined) push('notes', d.notes)
    if (!sets.length) { res.status(400).json({ error: 'invalid_deal', detail: 'nothing to update' }); return }
    params.push(req.params.id)
    const { rows } = await pool.query(
      `UPDATE cashflow_pipeline_deals SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING id, name, estimated_mrr_cents, stage, notes, created_at, updated_at`,
      params,
    )
    if (!rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ deal: mapDeal(rows[0]) })
  } catch (err) {
    logError('cashflow_pipeline_update_failed', { err: String(err) })
    res.status(500).json({ error: 'update_failed' })
  }
})

cashflowRouter.delete('/pipeline/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM cashflow_pipeline_deals WHERE id = $1`, [req.params.id])
    if (!rowCount) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ ok: true })
  } catch (err) {
    logError('cashflow_pipeline_delete_failed', { err: String(err) })
    res.status(500).json({ error: 'delete_failed' })
  }
})

// ── QuickBooks payment check (manual re-run) ──────────────────────────
// The real check runs automatically once a month (server/cashflow_payment_check.ts).
// This lets Ryan (or Claude) trigger an on-demand recheck any time — Railway
// timeout-safe since it's a handful of QuickBooks API calls, not a long job.
cashflowRouter.post('/payment-check/run', async (_req, res) => {
  try {
    const result = await runCashflowPaymentCheckNow()
    res.json({ ok: true, ...result })
  } catch (err) {
    logError('cashflow_payment_check_manual_failed', { err: String(err) })
    res.status(500).json({ error: 'payment_check_failed' })
  }
})
