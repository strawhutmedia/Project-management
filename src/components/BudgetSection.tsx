import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type ApiBudget,
  type ApiBudgetAccount,
  type ApiBudgetLineItem,
  type BudgetCategory,
} from '../api'

const CATEGORY_LABEL: Record<BudgetCategory, string> = {
  above_line: 'Above the Line',
  production: 'Production',
  post: 'Post-Production',
  other: 'Other',
}

const CATEGORY_ORDER: BudgetCategory[] = ['above_line', 'production', 'post', 'other']

const CATEGORY_ACCENT: Record<BudgetCategory, { text: string; border: string; bg: string; dot: string }> = {
  above_line: { text: 'text-stage-mastering', border: 'border-stage-mastering/40', bg: 'bg-stage-mastering/10', dot: 'bg-stage-mastering' },
  production: { text: 'text-stage-tracking', border: 'border-stage-tracking/40', bg: 'bg-stage-tracking/10', dot: 'bg-stage-tracking' },
  post: { text: 'text-stage-mixing', border: 'border-stage-mixing/40', bg: 'bg-stage-mixing/10', dot: 'bg-stage-mixing' },
  other: { text: 'text-stage-stems', border: 'border-stage-stems/40', bg: 'bg-stage-stems/10', dot: 'bg-stage-stems' },
}

function fmtMoney(v: number, currency: string): string {
  if (!Number.isFinite(v)) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `$${Math.round(v).toLocaleString()}`
  }
}

function accountTotal(acc: ApiBudgetAccount): number {
  return acc.lineItems.reduce((sum, li) => sum + li.total, 0)
}

type GoalBucket = 'production' | 'post' | 'marketing' | 'admin'

// User-facing goal buckets. Production/Post are whole categories; "Other" is
// further split by account code so Marketing (publicity) is separated from
// Admin (legal/accounting + general expense + insurance).
function accountInBucket(acc: ApiBudgetAccount, bucket: GoalBucket): boolean {
  if (bucket === 'production') return acc.category === 'above_line' || acc.category === 'production'
  if (bucket === 'post') return acc.category === 'post'
  if (bucket === 'marketing') return acc.code.startsWith('55-')
  if (bucket === 'admin') return (
    acc.code.startsWith('56-') || acc.code.startsWith('57-') || acc.code.startsWith('58-')
  )
  return false
}

function bucketSpend(budget: ApiBudget, bucket: GoalBucket): number {
  return budget.accounts
    .filter((a) => accountInBucket(a, bucket))
    .reduce((s, a) => s + accountTotal(a), 0)
}

export default function BudgetSection({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [budget, setBudget] = useState<ApiBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openCategory, setOpenCategory] = useState<BudgetCategory | null>('above_line')
  const [openAccountId, setOpenAccountId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { budget } = await api.budget(projectId)
      setBudget(budget)
      setMissing(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'no_budget') setMissing(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [projectId])

  if (loading) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">💰 Budget</div>
        <p className="text-muted text-sm mt-2">Loading budget…</p>
      </section>
    )
  }

  if (missing) {
    return <BudgetCreate projectId={projectId} isAdmin={isAdmin} onCreated={load} />
  }

  if (error || !budget) {
    return (
      <section className="rounded-2xl border border-urgent/40 bg-urgent/5 p-6">
        <div className="text-[11px] uppercase tracking-[0.2em] text-urgent font-bold">💰 Budget</div>
        <p className="text-urgent text-sm mt-2">Failed to load budget: {error}</p>
      </section>
    )
  }

  const totalsByCategory = CATEGORY_ORDER.map((cat) => {
    const accounts = budget.accounts.filter((a) => a.category === cat)
    const subtotal = accounts.reduce((s, a) => s + accountTotal(a), 0)
    return { cat, accounts, subtotal }
  })
  const directTotal = totalsByCategory.reduce((s, c) => s + c.subtotal, 0)
  const contingency = directTotal * (budget.contingencyPct / 100)
  const bond = directTotal * (budget.bondPct / 100)
  const grand = directTotal + contingency + bond

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">💰 Budget</h2>
          <p className="text-[11px] text-muted/80 mt-1">
            StudioBinder format · {budget.shootDays} shoot day{budget.shootDays === 1 ? '' : 's'} · {budget.currency}
          </p>
        </div>
        {isAdmin && (
          <BudgetSettings budget={budget} onSaved={load} />
        )}
      </div>

      {(budget.totalTarget != null ||
        budget.productionTarget != null ||
        budget.postTarget != null ||
        budget.marketingTarget != null ||
        budget.adminTarget != null) && (
        <div className="space-y-3">
          {budget.totalTarget != null && (
            <GoalBar
              label="🎯 Total Goal"
              spent={grand}
              target={budget.totalTarget}
              currency={budget.currency}
              big
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {budget.productionTarget != null && (
              <GoalBar
                label="🎬 Production"
                spent={bucketSpend(budget, 'production')}
                target={budget.productionTarget}
                currency={budget.currency}
              />
            )}
            {budget.postTarget != null && (
              <GoalBar
                label="✂️ Post"
                spent={bucketSpend(budget, 'post')}
                target={budget.postTarget}
                currency={budget.currency}
              />
            )}
            {budget.marketingTarget != null && (
              <GoalBar
                label="📣 Marketing / PR"
                spent={bucketSpend(budget, 'marketing')}
                target={budget.marketingTarget}
                currency={budget.currency}
              />
            )}
            {budget.adminTarget != null && (
              <GoalBar
                label="🛡️ Admin (Legal·Acct·Ins)"
                spent={bucketSpend(budget, 'admin')}
                target={budget.adminTarget}
                currency={budget.currency}
              />
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {totalsByCategory.map(({ cat, subtotal }) => {
          const a = CATEGORY_ACCENT[cat]
          return (
            <button
              key={cat}
              onClick={() => setOpenCategory(openCategory === cat ? null : cat)}
              className={`text-left rounded-xl border ${a.border} ${a.bg} p-3 transition hover:bg-opacity-30 ${openCategory === cat ? 'ring-1 ring-inset ring-current' : ''}`}
            >
              <div className={`text-[10px] uppercase tracking-wider ${a.text} font-bold`}>{CATEGORY_LABEL[cat]}</div>
              <div className="font-display text-2xl mt-1">{fmtMoney(subtotal, budget.currency)}</div>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-line/60 bg-ink/40 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Direct total" value={fmtMoney(directTotal, budget.currency)} />
        <Stat label={`Contingency (${budget.contingencyPct}%)`} value={fmtMoney(contingency, budget.currency)} />
        <Stat label={`Bond (${budget.bondPct}%)`} value={fmtMoney(bond, budget.currency)} />
        <Stat label="Grand total" value={fmtMoney(grand, budget.currency)} accent />
      </div>

      {openCategory && (
        <div className="space-y-3">
          {totalsByCategory.find((c) => c.cat === openCategory)!.accounts.map((acc) => {
            const open = openAccountId === acc.id
            return (
              <BudgetAccount
                key={acc.id}
                account={acc}
                currency={budget.currency}
                open={open}
                onToggle={() => setOpenAccountId(open ? null : acc.id)}
                onChanged={load}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function GoalBar({
  label,
  spent,
  target,
  currency,
  big,
}: {
  label: string
  spent: number
  target: number
  currency: string
  big?: boolean
}) {
  const pct = target > 0 ? (spent / target) * 100 : 0
  const clamped = Math.min(pct, 100)
  const over = pct > 100
  const tone =
    pct > 100 ? 'urgent' : pct >= 90 ? 'warn' : pct >= 75 ? 'ok' : 'good'
  const barClass: Record<typeof tone, string> = {
    good: 'bg-stage-mixing',
    ok: 'bg-stage-mastering',
    warn: 'bg-stage-overdubs',
    urgent: 'bg-urgent',
  }
  const textClass: Record<typeof tone, string> = {
    good: 'text-stage-mixing',
    ok: 'text-stage-mastering',
    warn: 'text-stage-overdubs',
    urgent: 'text-urgent',
  }
  const remaining = target - spent
  return (
    <div className={`rounded-xl border border-line/60 ${big ? 'bg-ink/60 p-4' : 'bg-ink/40 p-3'}`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className={`text-[10px] uppercase tracking-wider font-bold ${big ? 'text-text' : 'text-muted'}`}>
          {label}
        </div>
        <div className={`text-[10px] uppercase tracking-wider font-bold ${textClass[tone]}`}>
          {over ? `Over by ${fmtMoney(spent - target, currency)}` : `${fmtMoney(remaining, currency)} left`}
        </div>
      </div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <div className={`font-display ${big ? 'text-3xl' : 'text-xl'}`}>{fmtMoney(spent, currency)}</div>
        <div className="text-muted text-xs">
          / {fmtMoney(target, currency)} <span className={`ml-1 ${textClass[tone]}`}>({Math.round(pct)}%)</span>
        </div>
      </div>
      <div className={`mt-2 relative h-1.5 rounded-full bg-line/40 overflow-hidden`}>
        <div
          className={`absolute left-0 top-0 bottom-0 ${barClass[tone]} transition-[width]`}
          style={{ width: `${clamped}%` }}
        />
        {over && (
          <div className="absolute right-0 top-0 bottom-0 bg-urgent/40 animate-pulse" style={{ width: '6%' }} />
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{label}</div>
      <div className={`font-display ${accent ? 'text-2xl text-rainbow' : 'text-xl'} mt-0.5`}>{value}</div>
    </div>
  )
}

function BudgetCreate({ projectId, isAdmin, onCreated }: { projectId: string; isAdmin: boolean; onCreated: () => void | Promise<void> }) {
  const [opening, setOpening] = useState(false)
  const [shootDays, setShootDays] = useState(0)
  const [currency, setCurrency] = useState('USD')
  const [template, setTemplate] = useState<'studiobinder' | 'blank'>('studiobinder')
  const [productionTarget, setProductionTarget] = useState<string>('')
  const [postTarget, setPostTarget] = useState<string>('')
  const [marketingTarget, setMarketingTarget] = useState<string>('')
  const [adminTarget, setAdminTarget] = useState<string>('')
  const [totalTarget, setTotalTarget] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isAdmin) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">💰 Budget</h2>
        <p className="text-muted text-sm mt-2">No budget yet. Ask an admin to create one.</p>
      </section>
    )
  }

  if (!opening) {
    return (
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">💰 Budget</h2>
            <p className="text-[11px] text-muted/80 mt-1">
              Track planned vs. actual spend. Seed with the StudioBinder account
              structure (10-00 → 58-00) or start blank.
            </p>
          </div>
          <button
            onClick={() => setOpening(true)}
            className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap"
          >
            + Create budget
          </button>
        </div>
      </section>
    )
  }

  async function create() {
    setBusy(true)
    setError(null)
    const num = (s: string) => {
      const t = s.trim()
      if (!t) return null
      const n = parseFloat(t.replace(/[$,]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    try {
      await api.createBudget(projectId, {
        shootDays,
        currency,
        template,
        productionTarget: num(productionTarget),
        postTarget: num(postTarget),
        marketingTarget: num(marketingTarget),
        adminTarget: num(adminTarget),
        totalTarget: num(totalTarget),
      })
      await onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">💰 New Budget</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">Currency</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">Shoot days</span>
          <input
            type="number"
            min={0}
            value={shootDays}
            onChange={(e) => setShootDays(parseInt(e.target.value) || 0)}
            className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">Template</span>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as 'studiobinder' | 'blank')}
            className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
          >
            <option value="studiobinder">StudioBinder (recommended)</option>
            <option value="blank">Blank</option>
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-line/60 bg-ink/40 p-4 space-y-3">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.15em] text-muted font-bold">🎯 Goals (optional, can edit later)</h3>
          <p className="text-[11px] text-muted/70 mt-1">
            What's the most you can spend? Set a Total cap, then split it across
            Production (above-the-line + crew + equip), Post (edit/sound/color/VFX),
            Marketing/PR (publicity), and Admin (legal · accounting · insurance).
            Progress bars show planned spend vs. each cap and turn red when over.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">🎯 Total cap</span>
            <input
              inputMode="decimal"
              placeholder="e.g. 700000"
              value={totalTarget}
              onChange={(e) => setTotalTarget(e.target.value)}
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">🎬 Production</span>
            <input
              inputMode="decimal"
              placeholder="e.g. 500000"
              value={productionTarget}
              onChange={(e) => setProductionTarget(e.target.value)}
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">✂️ Post</span>
            <input
              inputMode="decimal"
              placeholder="e.g. 150000"
              value={postTarget}
              onChange={(e) => setPostTarget(e.target.value)}
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">📣 Marketing</span>
            <input
              inputMode="decimal"
              placeholder="e.g. 50000"
              value={marketingTarget}
              onChange={(e) => setMarketingTarget(e.target.value)}
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-muted font-bold mb-1.5">🛡️ Admin</span>
            <input
              inputMode="decimal"
              placeholder="e.g. 25000"
              value={adminTarget}
              onChange={(e) => setAdminTarget(e.target.value)}
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm font-mono"
            />
          </label>
        </div>
      </div>

      {error && <p className="text-urgent text-sm">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void create()}
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          onClick={() => setOpening(false)}
          className="rounded-xl border border-line text-muted text-xs px-3 py-2 hover:text-text"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}

function BudgetSettings({ budget, onSaved }: { budget: ApiBudget; onSaved: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [shootDays, setShootDays] = useState(budget.shootDays)
  const [currency, setCurrency] = useState(budget.currency)
  const [bondPct, setBondPct] = useState(budget.bondPct)
  const [contingencyPct, setContingencyPct] = useState(budget.contingencyPct)
  const [productionTarget, setProductionTarget] = useState<string>(budget.productionTarget != null ? String(budget.productionTarget) : '')
  const [postTarget, setPostTarget] = useState<string>(budget.postTarget != null ? String(budget.postTarget) : '')
  const [marketingTarget, setMarketingTarget] = useState<string>(budget.marketingTarget != null ? String(budget.marketingTarget) : '')
  const [adminTarget, setAdminTarget] = useState<string>(budget.adminTarget != null ? String(budget.adminTarget) : '')
  const [totalTarget, setTotalTarget] = useState<string>(budget.totalTarget != null ? String(budget.totalTarget) : '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const num = (s: string): number | null => {
      const t = s.trim()
      if (!t) return null
      const n = parseFloat(t.replace(/[$,]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    try {
      await api.updateBudget(budget.id, {
        shootDays,
        currency,
        bondPct,
        contingencyPct,
        productionTarget: num(productionTarget),
        postTarget: num(postTarget),
        marketingTarget: num(marketingTarget),
        adminTarget: num(adminTarget),
        totalTarget: num(totalTarget),
      })
      await onSaved()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] uppercase tracking-wider text-stage-stems border border-stage-stems/40 rounded-full px-2 py-1 hover:bg-stage-stems/10"
      >
        ⚙ Settings
      </button>
    )
  }

  return (
    <div className="w-full rounded-xl border border-line bg-ink/40 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Currency</span>
        <input
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Shoot days</span>
        <input
          type="number"
          min={0}
          value={shootDays}
          onChange={(e) => setShootDays(parseInt(e.target.value) || 0)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Bond %</span>
        <input
          type="number"
          step="0.1"
          min={0}
          value={bondPct}
          onChange={(e) => setBondPct(parseFloat(e.target.value) || 0)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Contingency %</span>
        <input
          type="number"
          step="0.1"
          min={0}
          value={contingencyPct}
          onChange={(e) => setContingencyPct(parseFloat(e.target.value) || 0)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none"
        />
      </label>
      <div className="col-span-2 sm:col-span-4 mt-1 mb-1 text-[10px] uppercase tracking-[0.15em] text-muted font-bold">
        🎯 Goals (leave blank to disable a bar)
      </div>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Total cap</span>
        <input
          inputMode="decimal"
          placeholder="700000"
          value={totalTarget}
          onChange={(e) => setTotalTarget(e.target.value)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Production cap</span>
        <input
          inputMode="decimal"
          placeholder="500000"
          value={productionTarget}
          onChange={(e) => setProductionTarget(e.target.value)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Post cap</span>
        <input
          inputMode="decimal"
          placeholder="150000"
          value={postTarget}
          onChange={(e) => setPostTarget(e.target.value)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Marketing cap</span>
        <input
          inputMode="decimal"
          placeholder="50000"
          value={marketingTarget}
          onChange={(e) => setMarketingTarget(e.target.value)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none font-mono"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-muted font-bold mb-1">Admin cap (Legal·Acct·Ins)</span>
        <input
          inputMode="decimal"
          placeholder="25000"
          value={adminTarget}
          onChange={(e) => setAdminTarget(e.target.value)}
          className="w-full rounded-md bg-ink/60 border border-line text-text px-2 py-1.5 outline-none font-mono"
        />
      </label>
      <div className="col-span-2 sm:col-span-4 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[10px] px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setOpen(false)} className="text-[10px] text-muted hover:text-text">Cancel</button>
      </div>
    </div>
  )
}

function BudgetAccount({
  account,
  currency,
  open,
  onToggle,
  onChanged,
}: {
  account: ApiBudgetAccount
  currency: string
  open: boolean
  onToggle: () => void
  onChanged: () => void | Promise<void>
}) {
  const total = useMemo(() => accountTotal(account), [account])
  const a = CATEGORY_ACCENT[account.category]

  return (
    <div className={`rounded-xl border ${a.border} ${open ? a.bg : 'bg-ink/30'} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-[10px] font-mono ${a.text} font-bold`}>{account.code}</span>
          <span className="font-bold text-sm uppercase tracking-wider truncate">{account.name}</span>
          <span className="text-[10px] text-muted">{account.lineItems.length} items</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-display text-lg">{fmtMoney(total, currency)}</span>
          <span className={`text-xs ${a.text}`}>{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-line/40 p-3">
          <BudgetItemTable account={account} currency={currency} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

type Draft = {
  code: string
  description: string
  amt: string
  units: string
  x: string
  rate: string
  vendor: string
  datedAt: string
  notes: string
}

const EMPTY_DRAFT: Draft = {
  code: '',
  description: '',
  amt: '0',
  units: '',
  x: '1',
  rate: '0',
  vendor: '',
  datedAt: '',
  notes: '',
}

function BudgetItemTable({
  account,
  currency,
  onChanged,
}: {
  account: ApiBudgetAccount
  currency: string
  onChanged: () => void | Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!draft.description.trim()) {
      setError('Description required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.addBudgetItem(account.id, {
        code: draft.code || undefined,
        description: draft.description,
        amt: parseFloat(draft.amt) || 0,
        units: draft.units || undefined,
        x: parseFloat(draft.x) || 1,
        rate: parseFloat(draft.rate) || 0,
        vendor: draft.vendor || undefined,
        datedAt: draft.datedAt || undefined,
        notes: draft.notes || undefined,
      })
      setDraft(EMPTY_DRAFT)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-3 px-3">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="text-left font-bold pb-2 pr-2 w-16">Code</th>
              <th className="text-left font-bold pb-2 pr-2">Description</th>
              <th className="text-right font-bold pb-2 pr-2 w-20">Amt</th>
              <th className="text-left font-bold pb-2 pr-2 w-16">Units</th>
              <th className="text-right font-bold pb-2 pr-2 w-12">×</th>
              <th className="text-right font-bold pb-2 pr-2 w-24">Rate</th>
              <th className="text-right font-bold pb-2 pr-2 w-24">Total</th>
              <th className="text-left font-bold pb-2 pr-2 w-32">Vendor</th>
              <th className="text-left font-bold pb-2 pr-2 w-28">Date</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {account.lineItems.length === 0 && (
              <tr>
                <td colSpan={10} className="text-muted/70 text-center py-3 italic">
                  No line items yet — add one below.
                </td>
              </tr>
            )}
            {account.lineItems.map((item) => (
              <BudgetItemRow key={item.id} item={item} currency={currency} onChanged={onChanged} />
            ))}
            <tr className="border-t border-line/40">
              <td className="pr-2 pt-2"><Cell value={draft.code} onChange={(v) => setDraft({ ...draft, code: v })} placeholder="—" /></td>
              <td className="pr-2 pt-2"><Cell value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} placeholder="New item…" /></td>
              <td className="pr-2 pt-2"><Cell value={draft.amt} onChange={(v) => setDraft({ ...draft, amt: v })} align="right" /></td>
              <td className="pr-2 pt-2"><Cell value={draft.units} onChange={(v) => setDraft({ ...draft, units: v })} placeholder="Days" /></td>
              <td className="pr-2 pt-2"><Cell value={draft.x} onChange={(v) => setDraft({ ...draft, x: v })} align="right" /></td>
              <td className="pr-2 pt-2"><Cell value={draft.rate} onChange={(v) => setDraft({ ...draft, rate: v })} align="right" /></td>
              <td className="pr-2 pt-2 text-right font-mono text-muted">
                {fmtMoney((parseFloat(draft.amt) || 0) * (parseFloat(draft.x) || 0) * (parseFloat(draft.rate) || 0), currency)}
              </td>
              <td className="pr-2 pt-2"><Cell value={draft.vendor} onChange={(v) => setDraft({ ...draft, vendor: v })} placeholder="—" /></td>
              <td className="pr-2 pt-2"><Cell value={draft.datedAt} onChange={(v) => setDraft({ ...draft, datedAt: v })} type="date" /></td>
              <td className="pt-2 text-right">
                <button
                  onClick={() => void add()}
                  disabled={busy}
                  className="text-stage-mastering hover:text-text text-base disabled:opacity-50"
                  title="Add line item"
                >
                  +
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {error && <p className="text-urgent text-xs">{error}</p>}
    </div>
  )
}

function BudgetItemRow({
  item,
  currency,
  onChanged,
}: {
  item: ApiBudgetLineItem
  currency: string
  onChanged: () => void | Promise<void>
}) {
  const [code, setCode] = useState(item.code ?? '')
  const [description, setDescription] = useState(item.description)
  const [amt, setAmt] = useState(String(item.amt))
  const [units, setUnits] = useState(item.units ?? '')
  const [x, setX] = useState(String(item.x))
  const [rate, setRate] = useState(String(item.rate))
  const [vendor, setVendor] = useState(item.vendor ?? '')
  const [datedAt, setDatedAt] = useState(item.datedAt ? item.datedAt.slice(0, 10) : '')

  useEffect(() => {
    setCode(item.code ?? '')
    setDescription(item.description)
    setAmt(String(item.amt))
    setUnits(item.units ?? '')
    setX(String(item.x))
    setRate(String(item.rate))
    setVendor(item.vendor ?? '')
    setDatedAt(item.datedAt ? item.datedAt.slice(0, 10) : '')
  }, [item.id, item.code, item.description, item.amt, item.units, item.x, item.rate, item.vendor, item.datedAt])

  async function commit(patch: Parameters<typeof api.updateBudgetItem>[1]) {
    await api.updateBudgetItem(item.id, patch)
    await onChanged()
  }

  async function remove() {
    if (!confirm(`Delete "${item.description}"?`)) return
    await api.deleteBudgetItem(item.id)
    await onChanged()
  }

  const total = (parseFloat(amt) || 0) * (parseFloat(x) || 0) * (parseFloat(rate) || 0)

  return (
    <tr className="border-t border-line/30 hover:bg-ink/30">
      <td className="pr-2 py-1"><Cell value={code} onChange={setCode} onBlur={() => code !== (item.code ?? '') && void commit({ code })} /></td>
      <td className="pr-2 py-1"><Cell value={description} onChange={setDescription} onBlur={() => description !== item.description && void commit({ description })} /></td>
      <td className="pr-2 py-1"><Cell value={amt} onChange={setAmt} align="right" onBlur={() => parseFloat(amt) !== item.amt && void commit({ amt: parseFloat(amt) || 0 })} /></td>
      <td className="pr-2 py-1"><Cell value={units} onChange={setUnits} onBlur={() => units !== (item.units ?? '') && void commit({ units })} /></td>
      <td className="pr-2 py-1"><Cell value={x} onChange={setX} align="right" onBlur={() => parseFloat(x) !== item.x && void commit({ x: parseFloat(x) || 1 })} /></td>
      <td className="pr-2 py-1"><Cell value={rate} onChange={setRate} align="right" onBlur={() => parseFloat(rate) !== item.rate && void commit({ rate: parseFloat(rate) || 0 })} /></td>
      <td className="pr-2 py-1 text-right font-mono">{fmtMoney(total, currency)}</td>
      <td className="pr-2 py-1"><Cell value={vendor} onChange={setVendor} onBlur={() => vendor !== (item.vendor ?? '') && void commit({ vendor })} /></td>
      <td className="pr-2 py-1"><Cell value={datedAt} onChange={setDatedAt} type="date" onBlur={() => {
        const next = datedAt || null
        const prev = item.datedAt ? item.datedAt.slice(0, 10) : null
        if (next !== prev) void commit({ datedAt: next })
      }} /></td>
      <td className="py-1 text-right">
        <button onClick={() => void remove()} className="text-muted hover:text-urgent text-sm" title="Delete">
          ✕
        </button>
      </td>
    </tr>
  )
}

function Cell({
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  align = 'left',
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: string
  align?: 'left' | 'right'
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={`w-full bg-transparent text-xs px-1.5 py-1 rounded border border-transparent focus:border-stage-mastering/60 focus:bg-ink/40 outline-none ${
        align === 'right' ? 'text-right font-mono' : ''
      }`}
    />
  )
}
