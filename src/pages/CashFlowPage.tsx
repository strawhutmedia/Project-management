import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { api, type ApiCashflowEntry, type ApiCashflowOverview } from '../api'

// ── money + date helpers ───────────────────────────────────
const money = (cents: number) => {
  const sign = cents < 0 ? '-' : ''
  return sign + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const dollarsToCents = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const centsToInput = (cents: number) => (cents ? (cents / 100).toString() : '')
const fmtDate = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const fmtMonth = (ym: string) => {
  const d = new Date(ym + '-01T00:00:00')
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().toISOString().slice(0, 7)

// ── shared UI atoms (Slate design system) ──────────────────────────
const card = 'rounded-2xl border border-line bg-panel/60'
const inputCls = 'w-full bg-ink/60 border border-line rounded-xl px-3 py-2 text-text placeholder:text-muted/60 focus:outline-none focus:border-stage-mastering/60'
const labelCls = 'text-[11px] uppercase tracking-wider font-bold text-muted'

function Btn({ children, onClick, variant = 'default', type = 'button', disabled, className = '' }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'ghost' | 'danger'
  type?: 'button' | 'submit'; disabled?: boolean; className?: string
}) {
  const styles: Record<string, string> = {
    default: 'border border-line bg-panel hover:bg-line/40 text-text',
    primary: 'bg-gradient-to-r from-stage-producing to-stage-mastering text-white hover:opacity-90 border border-transparent',
    ghost: 'border border-transparent hover:bg-line/40 text-muted hover:text-text',
    danger: 'border border-urgent/40 text-urgent hover:bg-urgent/10',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}>
      {children}
    </button>
  )
}

function KindChip({ kind }: { kind: 'in' | 'out' }) {
  return kind === 'in'
    ? <span className="inline-flex items-center rounded-full border border-stage-done/40 bg-stage-done/10 text-stage-done px-2.5 py-0.5 text-xs font-bold">＋ In</span>
    : <span className="inline-flex items-center rounded-full border border-urgent/40 bg-urgent/10 text-urgent px-2.5 py-0.5 text-xs font-bold">－ Out</span>
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-stage-done' : tone === 'bad' ? 'text-urgent' : 'text-text'
  return (
    <div className={`${card} p-4`}>
      <div className={labelCls}>{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

// The server is the real gate (403s for anyone but the owner — which
// also covers is_invoicing_owner, migration 136, currently Caroline).
// This client-side check just hides the UI from other signed-in accounts.
const OWNER_EMAIL = 'ryan@strawhutmedia.com'

type EntryDraft = {
  kind: 'in' | 'out'
  amount: string
  occurredOn: string
  category: string
  counterparty: string
  notes: string
  isRecurring: boolean
}

const emptyDraft = (kind: 'in' | 'out' = 'in'): EntryDraft => ({
  kind, amount: '', occurredOn: todayISO(), category: '', counterparty: '', notes: '', isRecurring: true,
})

const IN_CATEGORIES = ['Client payment', 'Podbooster', 'Ad revenue', 'Production fee', 'Sponsorship', 'Other income']
const OUT_CATEGORIES = ['Payroll', 'Contractors', 'Ad spend', 'Software', 'Rent', 'Equipment', 'Travel', 'Taxes', 'Other expense']

export default function CashFlowPage() {
  const { user } = useAuth()
  const [overview, setOverview] = useState<ApiCashflowOverview | null>(null)
  const [entries, setEntries] = useState<ApiCashflowEntry[]>([])
  const [monthFilter, setMonthFilter] = useState<string>('') // '' = recent
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsBalance, setSettingsBalance] = useState('')
  const [settingsDate, setSettingsDate] = useState(todayISO())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const amountRef = useRef<HTMLInputElement | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }, [])

  const reload = useCallback(async () => {
    const [o, e] = await Promise.all([
      api.cashflowOverview(),
      api.cashflowEntries(monthFilter ? { month: monthFilter } : { limit: 100 }),
    ])
    setOverview(o)
    setEntries(e.entries)
    setSettingsBalance(centsToInput(o.settings.startingBalanceCents))
    setSettingsDate(o.settings.startingDate)
  }, [monthFilter])

  useEffect(() => { void reload().catch((err) => setError(String(err?.message || err))).finally(() => setLoading(false)) }, [reload])

  const thisMonth = useMemo(() => {
    const m = overview?.months.find((x) => x.month === currentMonth())
    return m ?? { month: currentMonth(), inCents: 0, outCents: 0, netCents: 0, endingBalanceCents: overview?.currentBalanceCents ?? 0 }
  }, [overview])

  const monthsNewestFirst = useMemo(() => (overview ? [...overview.months].reverse() : []), [overview])

  if (!user) return null
  if ((user.email || '').trim().toLowerCase() !== OWNER_EMAIL && !user.is_invoicing_owner) {
    return <div className="max-w-2xl"><div className={`${card} p-8 text-center text-muted`}>This section is private.</div></div>
  }
  if (loading || !overview) return <div className="text-muted text-sm">Loading cash flow…</div>

  const startEdit = (e: ApiCashflowEntry) => {
    setEditingId(e.id)
    setDraft({
      kind: e.kind, amount: centsToInput(e.amountCents), occurredOn: e.occurredOn,
      category: e.category, counterparty: e.counterparty, notes: e.notes, isRecurring: e.isRecurring,
    })
    amountRef.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => { setEditingId(null); setDraft(emptyDraft(draft.kind)) }

  const submit = async () => {
    setError('')
    const amountCents = dollarsToCents(draft.amount)
    if (amountCents <= 0) { setError('Enter an amount greater than zero.'); return }
    if (!draft.occurredOn) { setError('Pick a date.'); return }
    setSaving(true)
    try {
      const body = {
        kind: draft.kind, amountCents, occurredOn: draft.occurredOn,
        category: draft.category.trim(), counterparty: draft.counterparty.trim(), notes: draft.notes.trim(),
        isRecurring: draft.isRecurring,
      }
      if (editingId) {
        await api.updateCashflowEntry(editingId, body)
        flash('Entry updated')
      } else {
        await api.createCashflowEntry(body)
        flash(draft.kind === 'in' ? `Logged ${money(amountCents)} in` : `Logged ${money(amountCents)} out`)
      }
      setEditingId(null)
      setDraft(emptyDraft(draft.kind))
      await reload()
      amountRef.current?.focus()
    } catch (err) {
      setError(String((err as Error)?.message || err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (e: ApiCashflowEntry) => {
    if (!window.confirm(`Delete this ${e.kind === 'in' ? 'incoming' : 'outgoing'} entry of ${money(e.amountCents)}?`)) return
    try {
      await api.deleteCashflowEntry(e.id)
      if (editingId === e.id) cancelEdit()
      flash('Entry deleted')
      await reload()
    } catch (err) {
      setError(String((err as Error)?.message || err))
    }
  }

  const saveSettings = async () => {
    try {
      await api.updateCashflowSettings({
        startingBalanceCents: dollarsToCents(settingsBalance),
        startingDate: settingsDate,
      })
      setShowSettings(false)
      flash('Opening balance saved')
      await reload()
    } catch (err) {
      setError(String((err as Error)?.message || err))
    }
  }

  const categories = draft.kind === 'in' ? IN_CATEGORIES : OUT_CATEGORIES

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text">💵 Cash Flow</h1>
          <p className="text-sm text-muted mt-0.5">
            Private money log — tell it what came in and what went out; it keeps the running balance.
          </p>
        </div>
        <Btn variant="ghost" onClick={() => setShowSettings((v) => !v)}>⚙ Opening balance</Btn>
      </div>

      {toast && <div className="rounded-xl border border-stage-done/40 bg-stage-done/10 text-stage-done px-4 py-2 text-sm font-semibold">{toast}</div>}
      {error && <div className="rounded-xl border border-urgent/40 bg-urgent/10 text-urgent px-4 py-2 text-sm">{error}</div>}

      {showSettings && (
        <div className={`${card} p-4 space-y-3`}>
          <div className="text-sm text-muted">
            The running balance starts from this opening balance. Set it to your bank balance on a chosen day,
            then log every movement after that day. Entries dated before it will still be counted, so pick a
            date earlier than your first entry.
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <div className={labelCls}>Opening balance ($)</div>
              <input className={inputCls} inputMode="decimal" value={settingsBalance}
                onChange={(e) => setSettingsBalance(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <div className={labelCls}>As of date</div>
              <input className={inputCls} type="date" value={settingsDate}
                onChange={(e) => setSettingsDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Btn variant="primary" onClick={saveSettings}>Save</Btn>
              <Btn variant="ghost" onClick={() => setShowSettings(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Current balance" value={money(overview.currentBalanceCents)}
          tone={overview.currentBalanceCents >= 0 ? 'good' : 'bad'} />
        <Stat label="In · this month" value={money(thisMonth.inCents)} tone="good" />
        <Stat label="Out · this month" value={money(thisMonth.outCents)} tone="bad" />
        <Stat label="Net · this month" value={(thisMonth.netCents >= 0 ? '+' : '') + money(thisMonth.netCents)}
          tone={thisMonth.netCents >= 0 ? 'good' : 'bad'} />
      </div>

      {/* Baseline vs one-time — the sustainable number vs lumpy project wins */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-text">Monthly recurring revenue vs. costs</div>
          <div className="text-xs text-muted">What you can count on, separate from big one-off jobs like Disney or Hulu</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-ink/40 p-3">
            <div className={labelCls}>Recurring net (baseline)</div>
            <div className={`text-xl font-bold mt-1 tabular-nums ${overview.currentMonthBaseline.recurringNetCents >= 0 ? 'text-stage-done' : 'text-urgent'}`}>
              {(overview.currentMonthBaseline.recurringNetCents >= 0 ? '+' : '') + money(overview.currentMonthBaseline.recurringNetCents)}
            </div>
            <div className="text-xs text-muted mt-1">
              {money(overview.currentMonthBaseline.recurringInCents)} in − {money(overview.currentMonthBaseline.recurringOutCents)} out
            </div>
          </div>
          <div className="rounded-xl border border-line bg-ink/40 p-3">
            <div className={labelCls}>One-time net · this month</div>
            <div className={`text-xl font-bold mt-1 tabular-nums ${overview.currentMonthBaseline.oneTimeNetCents > 0 ? 'text-stage-done' : overview.currentMonthBaseline.oneTimeNetCents < 0 ? 'text-urgent' : 'text-muted'}`}>
              {(overview.currentMonthBaseline.oneTimeNetCents > 0 ? '+' : '') + money(overview.currentMonthBaseline.oneTimeNetCents)}
            </div>
            <div className="text-xs text-muted mt-1">
              {money(overview.currentMonthBaseline.oneTimeInCents)} in − {money(overview.currentMonthBaseline.oneTimeOutCents)} out
            </div>
          </div>
        </div>
        <div className={`mt-3 rounded-xl border px-3 py-2.5 text-sm ${overview.currentMonthBaseline.recurringNetCents >= 0
          ? 'border-stage-done/40 bg-stage-done/10 text-stage-done'
          : 'border-urgent/40 bg-urgent/10 text-urgent'}`}>
          {overview.currentMonthBaseline.recurringNetCents >= 0
            ? <>Your recurring clients cover your monthly costs on their own, with <b>{money(overview.currentMonthBaseline.recurringNetCents)}</b> to spare — before counting any one-off project wins.</>
            : <>Your recurring clients alone don't cover your monthly costs — there's a <b>{money(Math.abs(overview.currentMonthBaseline.recurringNetCents))}</b> gap that has to come from new clients or one-time deals. This is the number to watch, not the total that includes big project payments.</>}
        </div>
      </div>

      {/* Recurring checklist — every in, every out, so the totals above are checkable line by line, not a black box */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-text">Recurring checklist — every in, every out</div>
          <div className="text-xs text-muted">Line by line, so you can check it yourself</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className={`${labelCls} mb-2`}>In · {overview.recurringChecklist.in.length} clients</div>
            <div className="space-y-1">
              {overview.recurringChecklist.in.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-ink/40 border border-line px-2.5 py-1.5 text-sm">
                  <span className="text-stage-done">✓</span>
                  <span className="flex-1 min-w-0 truncate text-text">{r.counterparty || r.category || 'Unnamed'}</span>
                  <span className="tabular-nums font-semibold text-stage-done">{money(r.amountCents)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/60 text-sm font-bold">
              <span className="text-text">Total in</span>
              <span className="tabular-nums text-stage-done">{money(overview.currentMonthBaseline.recurringInCents)}</span>
            </div>
          </div>
          <div>
            <div className={`${labelCls} mb-2`}>Out · {overview.recurringChecklist.out.length} lines</div>
            <div className="space-y-1">
              {overview.recurringChecklist.out.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-ink/40 border border-line px-2.5 py-1.5 text-sm">
                  <span className="text-urgent">✓</span>
                  <span className="flex-1 min-w-0 truncate text-text">{r.counterparty || r.category || 'Unnamed'}</span>
                  <span className="tabular-nums font-semibold text-urgent">{money(r.amountCents)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/60 text-sm font-bold">
              <span className="text-text">Total out</span>
              <span className="tabular-nums text-urgent">{money(overview.currentMonthBaseline.recurringOutCents)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-sm font-bold">
          <span className="text-text">Does it equal out?</span>
          <span className={`tabular-nums ${overview.currentMonthBaseline.recurringNetCents >= 0 ? 'text-stage-done' : 'text-urgent'}`}>
            {(overview.currentMonthBaseline.recurringNetCents >= 0 ? '+' : '') + money(overview.currentMonthBaseline.recurringNetCents)}
          </span>
        </div>
      </div>

      {/* Quick add / edit */}
      <div className={`${card} p-4 space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-text">{editingId ? 'Edit entry' : 'Log money'}</div>
          {editingId && <Btn variant="ghost" onClick={cancelEdit}>Cancel edit</Btn>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDraft((d) => ({ ...d, kind: 'in', category: '' }))}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${draft.kind === 'in'
              ? 'border-stage-done/60 bg-stage-done/15 text-stage-done'
              : 'border-line bg-ink/40 text-muted hover:text-text'}`}>
            ＋ Money in
          </button>
          <button type="button" onClick={() => setDraft((d) => ({ ...d, kind: 'out', category: '' }))}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${draft.kind === 'out'
              ? 'border-urgent/60 bg-urgent/15 text-urgent'
              : 'border-line bg-ink/40 text-muted hover:text-text'}`}>
            － Money out
          </button>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <div>
            <div className={labelCls}>Amount ($)</div>
            <input ref={amountRef} className={inputCls} inputMode="decimal" value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} placeholder="0.00"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          </div>
          <div>
            <div className={labelCls}>Date</div>
            <input className={inputCls} type="date" value={draft.occurredOn}
              onChange={(e) => setDraft((d) => ({ ...d, occurredOn: e.target.value }))} />
          </div>
          <div>
            <div className={labelCls}>Category</div>
            <input className={inputCls} list="cashflow-categories" value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              placeholder={draft.kind === 'in' ? 'Client payment…' : 'Payroll…'} />
            <datalist id="cashflow-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <div className={labelCls}>{draft.kind === 'in' ? 'From' : 'To'}</div>
            <input className={inputCls} value={draft.counterparty}
              onChange={(e) => setDraft((d) => ({ ...d, counterparty: e.target.value }))}
              placeholder={draft.kind === 'in' ? 'Who paid us' : 'Who we paid'} />
          </div>
        </div>
        <div>
          <div className={labelCls}>Notes (optional)</div>
          <input className={inputCls} value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="Invoice #, what it was for…"
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
            <input type="checkbox" checked={draft.isRecurring}
              onChange={(e) => setDraft((d) => ({ ...d, isRecurring: e.target.checked }))}
              className="rounded border-line accent-stage-mastering" />
            Recurring monthly {draft.kind === 'in' ? '(a steady client)' : '(a regular cost)'}
            <span className="text-muted/70">— uncheck for a one-off {draft.kind === 'in' ? 'project payment' : 'purchase'}</span>
          </label>
          <Btn variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : draft.kind === 'in' ? 'Log money in' : 'Log money out'}
          </Btn>
        </div>
      </div>

      {/* Monthly history */}
      {monthsNewestFirst.length > 0 && (
        <div className={`${card} p-4`}>
          <div className="font-bold text-text mb-3">Month by month</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className={`${labelCls} pb-2 pr-4`}>Month</th>
                  <th className={`${labelCls} pb-2 pr-4 text-right`}>In</th>
                  <th className={`${labelCls} pb-2 pr-4 text-right`}>Out</th>
                  <th className={`${labelCls} pb-2 pr-4 text-right`}>Net</th>
                  <th className={`${labelCls} pb-2 text-right`}>Ending balance</th>
                </tr>
              </thead>
              <tbody>
                {monthsNewestFirst.map((m) => (
                  <tr key={m.month} className="border-t border-line/60 hover:bg-line/20 cursor-pointer"
                    onClick={() => setMonthFilter(monthFilter === m.month ? '' : m.month)}
                    title="Click to filter entries to this month">
                    <td className="py-2 pr-4 text-text font-semibold">
                      {fmtMonth(m.month)}{monthFilter === m.month && <span className="ml-2 text-xs text-stage-mastering">(filtering)</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-stage-done">{money(m.inCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-urgent">{money(m.outCents)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums font-semibold ${m.netCents >= 0 ? 'text-stage-done' : 'text-urgent'}`}>
                      {(m.netCents >= 0 ? '+' : '') + money(m.netCents)}
                    </td>
                    <td className={`py-2 text-right tabular-nums font-bold ${m.endingBalanceCents >= 0 ? 'text-text' : 'text-urgent'}`}>
                      {money(m.endingBalanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* This month by category */}
      {overview.currentMonthCategories.length > 0 && (
        <div className={`${card} p-4`}>
          <div className="font-bold text-text mb-3">This month by category</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {overview.currentMonthCategories.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-ink/40 border border-line px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <KindChip kind={c.kind} />
                  <span className="text-sm text-text truncate">{c.category}</span>
                </div>
                <span className={`text-sm font-bold tabular-nums ${c.kind === 'in' ? 'text-stage-done' : 'text-urgent'}`}>
                  {money(c.totalCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entries */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="font-bold text-text">
            {monthFilter ? `Entries · ${fmtMonth(monthFilter)}` : 'Recent entries'}
          </div>
          {monthFilter && <Btn variant="ghost" onClick={() => setMonthFilter('')}>Show recent instead</Btn>}
        </div>
        {entries.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">
            No entries yet. Log your first movement above — or just tell Claude what came in or went out.
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl bg-ink/40 border border-line px-3 py-2.5">
                <KindChip kind={e.kind} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text truncate">
                    <span className="font-semibold">{e.counterparty || e.category || (e.kind === 'in' ? 'Income' : 'Expense')}</span>
                    {e.counterparty && e.category && <span className="text-muted"> · {e.category}</span>}
                    {e.notes && <span className="text-muted"> — {e.notes}</span>}
                    {!e.isRecurring && (
                      <span className="ml-2 inline-flex items-center rounded-full border border-line bg-line/30 text-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider align-middle">
                        One-time
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">{fmtDate(e.occurredOn)}</div>
                </div>
                <div className={`text-sm font-bold tabular-nums ${e.kind === 'in' ? 'text-stage-done' : 'text-urgent'}`}>
                  {e.kind === 'in' ? '+' : '−'}{money(e.amountCents)}
                </div>
                <div className="flex items-center gap-1">
                  <Btn variant="ghost" className="!px-2.5 !py-1" onClick={() => startEdit(e)}>Edit</Btn>
                  <Btn variant="danger" className="!px-2.5 !py-1" onClick={() => void remove(e)}>✕</Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
