// Monthly automated check: are Ryan's recurring cash-flow clients actually
// paid up in QuickBooks? Runs once a month (day 1-3 UTC, restart-safe via
// cashflow_payment_check_runs) and emails the admin a short digest.
//
// Always checks real invoice-level Balance + DueDate via the QuickBooks
// API directly -- never the A/R Aging Summary report, which has shown
// stale data in practice (invoices flagged 91+ days overdue that were
// already paid in full).
import { pool } from './db'
import { logError, logInfo } from './diag'
import { sendAdminAlert } from './email'
import { configured as qbConfigured, getConnection, qbFetch } from './quickbooks'

const TICK_MS = 6 * 60 * 60 * 1000 // check every 6 hours; only acts on day 1-3 of the month

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10)
}
function currentMonth(): string {
  return todayYMD().slice(0, 7)
}
// QuickBooks Query Language escapes a literal single quote by doubling it.
function qbEscape(s: string): string {
  return s.replace(/'/g, "''")
}

type QbCustomer = { Id: string }
type QbInvoice = { Balance?: number; DueDate?: string }

async function findCustomerId(name: string): Promise<string | null> {
  const q = `SELECT Id FROM Customer WHERE DisplayName = '${qbEscape(name)}'`
  const data = (await qbFetch(`/query?query=${encodeURIComponent(q)}`)) as {
    QueryResponse?: { Customer?: QbCustomer[] }
  }
  return data.QueryResponse?.Customer?.[0]?.Id ?? null
}

async function overdueInvoicesForCustomer(customerId: string): Promise<QbInvoice[]> {
  const q = `SELECT Balance, DueDate FROM Invoice WHERE CustomerRef = '${customerId}' ORDERBY TxnDate DESC MAXRESULTS 12`
  const data = (await qbFetch(`/query?query=${encodeURIComponent(q)}`)) as {
    QueryResponse?: { Invoice?: QbInvoice[] }
  }
  const invoices = data.QueryResponse?.Invoice ?? []
  const today = todayYMD()
  return invoices.filter((inv) => (inv.Balance ?? 0) > 0 && !!inv.DueDate && inv.DueDate < today)
}

function daysOverdue(dueDate: string): number {
  const due = Date.parse(dueDate + 'T00:00:00Z')
  const today = Date.parse(todayYMD() + 'T00:00:00Z')
  return Math.round((today - due) / 86_400_000)
}

// The client list is whatever Ryan is currently tracking as recurring
// income in the Cash Flow tracker -- no separate config to keep in sync.
async function recurringClients(): Promise<{ counterparty: string; qbName: string }[]> {
  const { rows } = await pool.query<{ counterparty: string; qb_customer_name: string | null }>(
    `SELECT DISTINCT counterparty, qb_customer_name FROM cashflow_entries
       WHERE kind = 'in' AND is_recurring = true AND counterparty <> ''`,
  )
  return rows.map((r) => ({ counterparty: r.counterparty, qbName: r.qb_customer_name || r.counterparty }))
}

type CheckResult = { clientsChecked: number; overdueCount: number; notFoundCount: number; skipped: boolean }

// alertKey is passed for the scheduled monthly run (dedupe-protected); the
// manual "run now" trigger omits it so a re-check always sends an email.
async function runCheck(alertKey?: string): Promise<CheckResult> {
  const conn = await getConnection()
  if (!qbConfigured() || !conn) {
    logInfo('cashflow payment check: skipped, QuickBooks not connected')
    return { clientsChecked: 0, overdueCount: 0, notFoundCount: 0, skipped: true }
  }

  const clients = await recurringClients()
  const overdue: { name: string; amount: number; days: number }[] = []
  const notFound: string[] = []

  for (const c of clients) {
    let customerId: string | null = null
    try {
      customerId = await findCustomerId(c.qbName)
    } catch (err) {
      logError('cashflow_payment_check: customer lookup failed', { client: c.qbName, err: String(err) })
      continue
    }
    if (!customerId) { notFound.push(c.counterparty); continue }
    try {
      const invoices = await overdueInvoicesForCustomer(customerId)
      for (const inv of invoices) {
        overdue.push({ name: c.counterparty, amount: inv.Balance ?? 0, days: daysOverdue(inv.DueDate!) })
      }
    } catch (err) {
      logError('cashflow_payment_check: invoice lookup failed', { client: c.qbName, err: String(err) })
    }
  }

  const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (!overdue.length && !notFound.length) {
    await sendAdminAlert(
      'Monthly payment check — all clear',
      `Checked ${clients.length} recurring client(s) against real QuickBooks invoice balances. Everyone's paid up — nothing overdue.`,
      alertKey,
    )
  } else {
    const lines: string[] = []
    if (overdue.length) {
      lines.push("Clients who haven't paid (verified against actual invoice balance + due date):")
      for (const o of overdue.sort((a, b) => b.days - a.days)) {
        lines.push(`- ${o.name}: ${money(o.amount)}, ${o.days} day(s) overdue`)
      }
    }
    if (notFound.length) {
      lines.push('', "Couldn't find a matching QuickBooks customer for:")
      for (const n of notFound) lines.push(`- ${n} (name may not match QuickBooks — check in the Cash Flow tracker)`)
    }
    await sendAdminAlert('Monthly payment check', lines.join('\n'), alertKey)
  }

  return { clientsChecked: clients.length, overdueCount: overdue.length, notFoundCount: notFound.length, skipped: false }
}

async function tick(): Promise<void> {
  const day = new Date().getUTCDate()
  if (day > 3) return
  const month = currentMonth()
  const { rowCount } = await pool.query(
    `INSERT INTO cashflow_payment_check_runs (run_month) VALUES ($1) ON CONFLICT DO NOTHING`,
    [month],
  )
  if (!rowCount) return // already ran this month
  await runCheck(`cashflow-payment-check-digest-${month}`)
}

export function startCashflowPaymentCheckLoop(): void {
  logInfo('cashflow payment check: loop started', { tickHours: TICK_MS / 3_600_000 })
  const safeTick = () => {
    tick().catch((err) => {
      logError('cashflow payment check: tick failed', { error: err instanceof Error ? err.message : String(err) })
    })
  }
  // First check shortly after boot (give migrations a beat), then every TICK_MS.
  setTimeout(safeTick, 45_000)
  setInterval(safeTick, TICK_MS)
}

// Owner-triggered manual re-run — bypasses the once-per-month guard and the
// email dedupe window, for testing or an on-demand "check now".
export async function runCashflowPaymentCheckNow(): Promise<CheckResult> {
  return runCheck()
}
