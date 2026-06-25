import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  // Allow multiple categories + accounts to be expanded at once. Default to
  // ALL categories expanded so the itemized breakdown is immediately visible.
  const [openCategories, setOpenCategories] = useState<Set<BudgetCategory>>(
    new Set<BudgetCategory>(['above_line', 'production', 'post', 'other']),
  )
  const [openAccountIds, setOpenAccountIds] = useState<Set<string>>(new Set())
  // Default to the flat spreadsheet view — easier to scan and edit in one place.
  // Users can flip to the hierarchical view for category subtotals.
  const [viewMode, setViewMode] = useState<'items' | 'categories'>('items')

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
                hint="Above the Line + Production"
                spent={bucketSpend(budget, 'production')}
                target={budget.productionTarget}
                currency={budget.currency}
              />
            )}
            {budget.postTarget != null && (
              <GoalBar
                label="✂️ Post"
                hint="Post-Production category"
                spent={bucketSpend(budget, 'post')}
                target={budget.postTarget}
                currency={budget.currency}
              />
            )}
            {budget.marketingTarget != null && (
              <GoalBar
                label="📣 Marketing / PR"
                hint="Publicity (55-00) only"
                spent={bucketSpend(budget, 'marketing')}
                target={budget.marketingTarget}
                currency={budget.currency}
              />
            )}
            {budget.adminTarget != null && (
              <GoalBar
                label="🛡️ Admin"
                hint="Legal · Accounting · Insurance · GE"
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
          const isOpen = openCategories.has(cat)
          return (
            <button
              key={cat}
              onClick={() => {
                const next = new Set(openCategories)
                if (isOpen) next.delete(cat); else next.add(cat)
                setOpenCategories(next)
              }}
              className={`text-left rounded-xl border ${a.border} ${a.bg} p-3 transition hover:bg-opacity-30 ${isOpen ? 'ring-1 ring-inset ring-current' : ''}`}
            >
              <div className={`text-[10px] uppercase tracking-wider ${a.text} font-bold flex items-center gap-1`}>
                <span>{isOpen ? '▾' : '▸'}</span>
                {CATEGORY_LABEL[cat]}
              </div>
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

      {/* View mode toggle — flat spreadsheet for scanning vs.
          hierarchical categories for subtotal-style review. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-line bg-ink/40 p-0.5 text-[10px] uppercase tracking-wider font-bold">
          <button
            onClick={() => setViewMode('items')}
            className={`px-3 py-1.5 rounded-md transition ${
              viewMode === 'items' ? 'bg-stage-mastering text-white' : 'text-muted hover:text-text'
            }`}
          >
            📊 Items
          </button>
          <button
            onClick={() => setViewMode('categories')}
            className={`px-3 py-1.5 rounded-md transition ${
              viewMode === 'categories' ? 'bg-stage-mastering text-white' : 'text-muted hover:text-text'
            }`}
          >
            🗂 Categories
          </button>
        </div>
        {isAdmin && (
          <ResetPricesButton projectId={projectId} onReset={load} />
        )}
        {viewMode === 'categories' && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                const all = new Set<string>()
                for (const acc of budget.accounts) all.add(acc.id)
                setOpenAccountIds(all)
                setOpenCategories(new Set(['above_line', 'production', 'post', 'other']))
              }}
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-2 py-1 hover:bg-stage-mastering/10"
            >
              Expand all
            </button>
            <button
              onClick={() => setOpenAccountIds(new Set())}
              className="text-[10px] uppercase tracking-wider text-muted border border-line rounded-full px-2 py-1 hover:bg-ink/40"
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      {viewMode === 'items' && (
        <BudgetItemsTable
          accounts={budget.accounts}
          currency={budget.currency}
          isAdmin={isAdmin}
          onChanged={load}
        />
      )}

      {viewMode === 'categories' && openCategories.size > 0 && (
        <div className="space-y-4">
          {totalsByCategory.filter((c) => openCategories.has(c.cat)).map(({ cat, accounts: catAccounts }) => {
            const a = CATEGORY_ACCENT[cat]
            return (
              <div key={cat} className="space-y-2">
                <div className={`text-[11px] uppercase tracking-[0.2em] font-bold ${a.text} pl-1`}>
                  {CATEGORY_LABEL[cat]}
                </div>
                {catAccounts.map((acc) => {
                  const open = openAccountIds.has(acc.id)
                  return (
                    <BudgetAccount
                      key={acc.id}
                      account={acc}
                      currency={budget.currency}
                      open={open}
                      onToggle={() => {
                        const next = new Set(openAccountIds)
                        if (open) next.delete(acc.id); else next.add(acc.id)
                        setOpenAccountIds(next)
                      }}
                      onChanged={load}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function GoalBar({
  label,
  hint,
  spent,
  target,
  currency,
  big,
}: {
  label: string
  hint?: string
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
      {hint && (
        <div className="text-[9px] uppercase tracking-wider text-muted/70 mt-0.5">
          incl. {hint}
        </div>
      )}
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
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink/40 cursor-pointer transition group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-base ${a.text} font-bold transition-transform ${open ? '' : 'group-hover:translate-x-0.5'}`}>
            {open ? '▾' : '▸'}
          </span>
          <span className={`text-[10px] font-mono ${a.text} font-bold`}>{account.code}</span>
          <span className="font-bold text-sm uppercase tracking-wider truncate">{account.name}</span>
          <span className="text-[10px] text-muted">{account.lineItems.length} {account.lineItems.length === 1 ? 'item' : 'items'}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-display text-lg">{fmtMoney(total, currency)}</span>
          {!open && (
            <span className="text-[9px] uppercase tracking-wider text-muted/70 group-hover:text-stage-mastering hidden sm:inline">
              tap to edit
            </span>
          )}
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

  const draftTotal = (parseFloat(draft.amt) || 0) * (parseFloat(draft.x) || 0) * (parseFloat(draft.rate) || 0)

  return (
    <div className="space-y-2">
      {account.lineItems.length === 0 && (
        <div className="text-muted/70 text-center py-3 italic text-xs">
          No line items yet — add one below.
        </div>
      )}
      {account.lineItems.map((item) => (
        <BudgetItemCard key={item.id} item={item} currency={currency} onChanged={onChanged} />
      ))}
      <div className="rounded-lg border border-dashed border-line/60 bg-ink/20 p-2.5 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted font-bold">+ Add new line item</div>
        <div className="grid grid-cols-[auto_1fr] gap-2 items-start">
          <div className="w-16">
            <FieldLabel>Code</FieldLabel>
            <Cell value={draft.code} onChange={(v) => setDraft({ ...draft, code: v })} placeholder="—" />
          </div>
          <div className="min-w-0">
            <FieldLabel>Description</FieldLabel>
            <CellArea value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} placeholder="New item…" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <FieldLabel>Amt</FieldLabel>
            <Cell value={draft.amt} onChange={(v) => setDraft({ ...draft, amt: v })} align="right" />
          </div>
          <div>
            <FieldLabel>×</FieldLabel>
            <Cell value={draft.x} onChange={(v) => setDraft({ ...draft, x: v })} align="right" />
          </div>
          <div>
            <FieldLabel>Rate</FieldLabel>
            <Cell value={draft.rate} onChange={(v) => setDraft({ ...draft, rate: v })} align="right" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Units</FieldLabel>
            <Cell value={draft.units} onChange={(v) => setDraft({ ...draft, units: v })} placeholder="Days" />
          </div>
          <div>
            <FieldLabel>Date</FieldLabel>
            <Cell value={draft.datedAt} onChange={(v) => setDraft({ ...draft, datedAt: v })} type="date" />
          </div>
        </div>
        <div>
          <FieldLabel>Vendor</FieldLabel>
          <Cell value={draft.vendor} onChange={(v) => setDraft({ ...draft, vendor: v })} placeholder="—" />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted">
            Total: <span className="font-mono text-text">{fmtMoney(draftTotal, currency)}</span>
          </div>
          <button
            onClick={() => void add()}
            disabled={busy}
            className="rounded-lg bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-[11px] px-3 py-1.5 disabled:opacity-50"
          >
            + Add
          </button>
        </div>
      </div>
      {error && <p className="text-urgent text-xs">{error}</p>}
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-[9px] uppercase tracking-wider text-muted/70 font-bold mb-0.5">{children}</div>
}

function BudgetItemCard({
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
    <div className="rounded-lg border border-line/40 bg-ink/30 p-2.5 space-y-2 hover:border-line/70 transition">
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-start">
        <div className="w-16 shrink-0">
          <FieldLabel>Code</FieldLabel>
          <Cell value={code} onChange={setCode} onBlur={() => code !== (item.code ?? '') && void commit({ code })} placeholder="—" />
        </div>
        <div className="min-w-0">
          <FieldLabel>Description</FieldLabel>
          <CellArea value={description} onChange={setDescription} onBlur={() => description !== item.description && void commit({ description })} />
        </div>
        <button
          onClick={() => void remove()}
          className="text-muted hover:text-urgent text-sm shrink-0 mt-4 px-1"
          title="Delete"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <FieldLabel>Amt</FieldLabel>
          <Cell value={amt} onChange={setAmt} align="right" onBlur={() => parseFloat(amt) !== item.amt && void commit({ amt: parseFloat(amt) || 0 })} />
        </div>
        <div>
          <FieldLabel>×</FieldLabel>
          <Cell value={x} onChange={setX} align="right" onBlur={() => parseFloat(x) !== item.x && void commit({ x: parseFloat(x) || 1 })} />
        </div>
        <div>
          <FieldLabel>Rate</FieldLabel>
          <Cell value={rate} onChange={setRate} align="right" onBlur={() => parseFloat(rate) !== item.rate && void commit({ rate: parseFloat(rate) || 0 })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Units</FieldLabel>
          <Cell value={units} onChange={setUnits} onBlur={() => units !== (item.units ?? '') && void commit({ units })} placeholder="Days" />
        </div>
        <div>
          <FieldLabel>Date</FieldLabel>
          <Cell value={datedAt} onChange={setDatedAt} type="date" onBlur={() => {
            const next = datedAt || null
            const prev = item.datedAt ? item.datedAt.slice(0, 10) : null
            if (next !== prev) void commit({ datedAt: next })
          }} />
        </div>
      </div>
      <div>
        <FieldLabel>Vendor</FieldLabel>
        <Cell value={vendor} onChange={setVendor} onBlur={() => vendor !== (item.vendor ?? '') && void commit({ vendor })} placeholder="—" />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line/30 pt-2">
        <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">Line total</div>
        <div className="font-mono font-bold text-sm text-text">{fmtMoney(total, currency)}</div>
      </div>
    </div>
  )
}

function CellArea({
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={1}
      className="w-full bg-transparent text-xs px-1.5 py-1 rounded border border-transparent focus:border-stage-mastering/60 focus:bg-ink/40 outline-none resize-y leading-snug min-h-[28px]"
    />
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

// ============================================================
// Flat spreadsheet view
// ============================================================
//
// Pulls every line item out of every account in the budget into a
// single sortable / filterable table. Editing is inline per cell;
// adding a new row requires picking an account first since items
// belong to accounts. Account/category context is shown as a colored
// badge on every row.

function BudgetItemsTable({
  accounts,
  currency,
  isAdmin,
  onChanged,
}: {
  accounts: ApiBudgetAccount[]
  currency: string
  isAdmin: boolean
  onChanged: () => void | Promise<void>
}) {
  type Row = ApiBudgetLineItem & { accountId: string; accountName: string; accountCode: string; category: BudgetCategory }
  const allRows: Row[] = []
  for (const acc of accounts) {
    for (const item of acc.lineItems) {
      allRows.push({
        ...item,
        accountId: acc.id,
        accountName: acc.name,
        accountCode: acc.code,
        category: acc.category,
      })
    }
  }

  const [filter, setFilter] = useState<BudgetCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<'category' | 'account' | 'code' | 'description' | 'total'>('category')
  const [sortAsc, setSortAsc] = useState(true)
  // Categories start collapsed — 1500+ rows is overwhelming on first
  // load. Producer expands the categories they're working on. When a
  // search query is active, all matching categories auto-expand so
  // the matches are visible without an extra click.
  const [expandedCats, setExpandedCats] = useState<Set<BudgetCategory>>(new Set())
  function toggleCat(c: BudgetCategory) {
    setExpandedCats((s) => {
      const next = new Set(s)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  const filtered = allRows.filter((r) => {
    if (filter !== 'all' && r.category !== filter) return false
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      if (
        !r.description.toLowerCase().includes(q) &&
        !(r.code ?? '').toLowerCase().includes(q) &&
        !r.accountName.toLowerCase().includes(q) &&
        !(r.vendor ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  filtered.sort((a, b) => {
    const dir = sortAsc ? 1 : -1
    switch (sortKey) {
      case 'category':    return dir * (a.category.localeCompare(b.category) || a.accountCode.localeCompare(b.accountCode) || a.position - b.position)
      case 'account':     return dir * (a.accountName.localeCompare(b.accountName) || a.position - b.position)
      case 'code':        return dir * ((a.code ?? '').localeCompare(b.code ?? ''))
      case 'description': return dir * a.description.localeCompare(b.description)
      case 'total':       return dir * (a.total - b.total)
    }
  })

  const visibleTotal = filtered.reduce((sum, r) => sum + r.total, 0)

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortAsc(!sortAsc)
    else { setSortKey(k); setSortAsc(true) }
  }

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search description, code, account, vendor…"
          className="flex-1 min-w-[200px] rounded-lg bg-ink/40 border border-line text-text text-xs px-2.5 py-1.5 outline-none focus:border-stage-mastering"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as BudgetCategory | 'all')}
          className="rounded-lg bg-ink/40 border border-line text-text text-xs px-2 py-1.5 outline-none focus:border-stage-mastering"
        >
          <option value="all">All categories</option>
          <option value="above_line">Above the line</option>
          <option value="production">Production</option>
          <option value="post">Post</option>
          <option value="other">Other</option>
        </select>
        <span className="text-[10px] text-muted ml-auto">
          {filtered.length} item{filtered.length === 1 ? '' : 's'} · {fmtMoney(visibleTotal, currency)}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted/70 text-xs italic py-6 text-center border border-dashed border-line/60 rounded-xl">
          No items match. Try clearing the search or filter.
        </p>
      ) : (() => {
        // Group filtered rows by category. Each card renders its own
        // collapsible header + body. When the user typed a query, all
        // categories with at least one match auto-expand. Without a
        // query they're collapsed by default — the producer can open
        // the categories they're working on.
        const grouped = new Map<BudgetCategory, Row[]>()
        for (const r of filtered) {
          const arr = grouped.get(r.category) ?? []
          arr.push(r)
          grouped.set(r.category, arr)
        }
        const hasQuery = query.trim().length > 0
        const orderedCats = CATEGORY_ORDER.filter((c) => grouped.has(c))
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <button
                onClick={() => setExpandedCats(new Set(orderedCats))}
                className="hover:text-text uppercase tracking-wider"
              >
                Expand all
              </button>
              <span>·</span>
              <button
                onClick={() => setExpandedCats(new Set())}
                className="hover:text-text uppercase tracking-wider"
              >
                Collapse all
              </button>
            </div>
            {orderedCats.map((cat) => {
              const rows = grouped.get(cat)!
              const total = rows.reduce((s, r) => s + r.total, 0)
              const priced = rows.filter((r) => r.total > 0).length
              const open = expandedCats.has(cat) || hasQuery
              const accent = CATEGORY_ACCENT[cat]
              return (
                <div key={cat} className={`rounded-xl border ${accent.border} ${accent.bg} overflow-hidden`}>
                  <button
                    onClick={() => toggleCat(cat)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ink/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-muted">{open ? '▾' : '▸'}</span>
                      <span className={`text-[10px] uppercase tracking-wider font-bold ${accent.text}`}>
                        {CATEGORY_LABEL[cat]}
                      </span>
                      <span className="text-[10px] text-muted">
                        · {rows.length} item{rows.length === 1 ? '' : 's'}
                        {priced > 0 && rows.length > priced && (
                          <> · {priced} priced</>
                        )}
                      </span>
                    </div>
                    <div className="font-mono font-bold text-sm text-text shrink-0">
                      {fmtMoney(total, currency)}
                    </div>
                  </button>
                  {open && (
                    <div className="overflow-x-auto border-t border-line/40 bg-ink/30">
                      <table className="w-full text-xs">
                        <thead className="bg-ink/60 text-muted uppercase tracking-wider text-[9px]">
                          <tr>
                            <SortableTh label="Account" k="account" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                            <th className="px-2 py-2 text-left">Scene</th>
                            <SortableTh label="Code" k="code" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                            <SortableTh label="Description" k="description" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                            <th className="px-2 py-2 text-right">Amt</th>
                            <th className="px-2 py-2 text-right">×</th>
                            <th className="px-2 py-2 text-right">Rate</th>
                            <th className="px-2 py-2 text-left">Units</th>
                            <th className="px-2 py-2 text-left">Vendor</th>
                            <th className="px-2 py-2 text-left">Date</th>
                            <SortableTh label="Total" k="total" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} align="right" />
                            {isAdmin && <th className="px-2 py-2"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <ItemRow key={row.id} row={row} currency={currency} isAdmin={isAdmin} onChanged={onChanged} hideCategory />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}

function SortableTh({
  label, k, sortKey, sortAsc, onClick, align,
}: {
  label: string
  k: 'category' | 'account' | 'code' | 'description' | 'total'
  sortKey: string
  sortAsc: boolean
  onClick: (k: 'category' | 'account' | 'code' | 'description' | 'total') => void
  align?: 'right'
}) {
  const active = sortKey === k
  return (
    <th className={`px-2 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? 'text-text' : 'hover:text-text'}`}
      >
        {label}
        {active && <span className="text-[8px]">{sortAsc ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

function ItemRow({
  row, currency, isAdmin, onChanged, hideCategory,
}: {
  row: ApiBudgetLineItem & { accountId: string; accountName: string; accountCode: string; category: BudgetCategory }
  currency: string
  isAdmin: boolean
  onChanged: () => void | Promise<void>
  hideCategory?: boolean
}) {
  const [code, setCode] = useState(row.code ?? '')
  const [description, setDescription] = useState(row.description)
  const [amt, setAmt] = useState(String(row.amt))
  const [x, setX] = useState(String(row.x))
  const [rate, setRate] = useState(String(row.rate))
  const [units, setUnits] = useState(row.units ?? '')
  const [vendor, setVendor] = useState(row.vendor ?? '')
  const [datedAt, setDatedAt] = useState(row.datedAt ? row.datedAt.slice(0, 10) : '')

  useEffect(() => {
    setCode(row.code ?? '')
    setDescription(row.description)
    setAmt(String(row.amt))
    setX(String(row.x))
    setRate(String(row.rate))
    setUnits(row.units ?? '')
    setVendor(row.vendor ?? '')
    setDatedAt(row.datedAt ? row.datedAt.slice(0, 10) : '')
  }, [row.id, row.code, row.description, row.amt, row.x, row.rate, row.units, row.vendor, row.datedAt])

  async function commit(patch: Parameters<typeof api.updateBudgetItem>[1]) {
    await api.updateBudgetItem(row.id, patch)
    await onChanged()
  }

  async function remove() {
    if (!confirm(`Delete "${row.description}"?`)) return
    await api.deleteBudgetItem(row.id)
    await onChanged()
  }

  const a = CATEGORY_ACCENT[row.category]
  const computedTotal = (parseFloat(amt) || 0) * (parseFloat(x) || 0) * (parseFloat(rate) || 0)

  return (
    <tr className="border-t border-line/30 hover:bg-ink/40 group">
      {!hideCategory && (
        <td className="px-2 py-1.5">
          <span className={`text-[9px] uppercase tracking-wider font-bold ${a.text} ${a.bg} border ${a.border} rounded-full px-1.5 py-0.5 whitespace-nowrap`}>
            {CATEGORY_LABEL[row.category]}
          </span>
        </td>
      )}
      <td className="px-2 py-1.5 text-muted whitespace-nowrap" title={row.accountName}>
        <span className="font-mono text-[10px] text-muted/70">{row.accountCode}</span>{' '}
        <span className="max-w-[140px] truncate inline-block align-bottom">{row.accountName}</span>
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {row.sceneNumber ? (
          <span className="text-[10px] font-mono font-bold text-stage-mastering bg-stage-mastering/10 border border-stage-mastering/30 rounded px-1.5 py-0.5">
            #{row.sceneNumber}
          </span>
        ) : (
          <span className="text-[10px] text-muted/40">—</span>
        )}
      </td>
      <td className="px-1 py-1 w-14">
        <CellInput value={code} onChange={setCode} onBlur={() => code !== (row.code ?? '') && void commit({ code })} mono />
      </td>
      <td className="px-1 py-1 min-w-[160px]">
        <CellInput value={description} onChange={setDescription} onBlur={() => description !== row.description && void commit({ description })} />
      </td>
      <td className="px-1 py-1 w-16">
        <CellInput value={amt} onChange={setAmt} onBlur={() => parseFloat(amt) !== row.amt && void commit({ amt: parseFloat(amt) || 0 })} align="right" />
      </td>
      <td className="px-1 py-1 w-12">
        <CellInput value={x} onChange={setX} onBlur={() => parseFloat(x) !== row.x && void commit({ x: parseFloat(x) || 1 })} align="right" />
      </td>
      <td className="px-1 py-1 w-20">
        <CellInput value={rate} onChange={setRate} onBlur={() => parseFloat(rate) !== row.rate && void commit({ rate: parseFloat(rate) || 0 })} align="right" />
      </td>
      <td className="px-1 py-1 w-16">
        <CellInput value={units} onChange={setUnits} onBlur={() => units !== (row.units ?? '') && void commit({ units })} />
      </td>
      <td className="px-1 py-1 w-28">
        <CellInput value={vendor} onChange={setVendor} onBlur={() => vendor !== (row.vendor ?? '') && void commit({ vendor })} />
      </td>
      <td className="px-1 py-1 w-28">
        <CellInput
          value={datedAt}
          onChange={setDatedAt}
          type="date"
          onBlur={() => {
            const next = datedAt || null
            const prev = row.datedAt ? row.datedAt.slice(0, 10) : null
            if (next !== prev) void commit({ datedAt: next })
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap">
        {fmtMoney(computedTotal, currency)}
      </td>
      {isAdmin && (
        <td className="px-2 py-1.5 text-right">
          <button
            onClick={() => void remove()}
            className="text-muted/40 hover:text-urgent opacity-0 group-hover:opacity-100"
            title="Delete"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  )
}

function CellInput({
  value, onChange, onBlur, type = 'text', align, mono,
}: {
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  type?: 'text' | 'date'
  align?: 'right'
  mono?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={`w-full bg-transparent text-xs px-1.5 py-1 rounded border border-transparent focus:border-stage-mastering/60 focus:bg-ink/40 outline-none ${
        align === 'right' ? 'text-right font-mono' : ''
      } ${mono ? 'font-mono' : ''}`}
    />
  )
}

// "Reset all prices to $0" — gives the producer a clean plate before
// a budget meeting. Modal asks which (if any) categories to PRESERVE
// existing prices on, so e.g. cast deals already negotiated stay put.
function ResetPricesButton({
  projectId,
  onReset,
}: {
  projectId: string
  onReset: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [keepAboveLine, setKeepAboveLine] = useState(false)
  const [keepProduction, setKeepProduction] = useState(false)
  const [keepPost, setKeepPost] = useState(false)
  const [keepOther, setKeepOther] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setBusy(true); setError(null)
    const keep: BudgetCategory[] = []
    if (keepAboveLine) keep.push('above_line')
    if (keepProduction) keep.push('production')
    if (keepPost) keep.push('post')
    if (keepOther) keep.push('other')
    try {
      const r = await api.resetBudgetPrices(projectId, keep)
      await onReset()
      setOpen(false)
      alert(`✓ Reset ${r.zeroed} item${r.zeroed === 1 ? '' : 's'} to $0.${keep.length > 0 ? ` Kept prices in: ${keep.join(', ')}.` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] uppercase tracking-wider text-urgent border border-urgent/40 rounded-full px-3 py-1.5 hover:bg-urgent/10"
        title="Zero out every line item — descriptions stay, just the dollar amounts go to $0"
      >
        ↺ Reset all prices
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-2xl">
            <div className="border-b border-line px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider text-urgent font-bold mb-1">⚠️ Reset all prices to $0</div>
              <p className="text-[11px] text-muted">
                Every line item's amount × multiplier × rate gets set to zero.
                Descriptions, scene attachments, vendors, and notes stay. Pick
                any categories you want to PRESERVE prices in.
              </p>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm">
              {([
                ['above_line', 'Above the Line', keepAboveLine, setKeepAboveLine, 'cast, director, producer fees you\'ve already negotiated'],
                ['production', 'Production', keepProduction, setKeepProduction, 'crew, equipment, locations'],
                ['post', 'Post', keepPost, setKeepPost, 'editing, music, color, sound'],
                ['other', 'Other', keepOther, setKeepOther, 'publicity, legal, insurance'],
              ] as const).map(([key, label, val, set, hint]) => (
                <label key={key} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} className="mt-1" />
                  <div>
                    <div className="text-text font-bold">Keep {label}</div>
                    <div className="text-[10px] text-muted">{hint}</div>
                  </div>
                </label>
              ))}
              {error && <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">{error}</div>}
            </div>
            <div className="border-t border-line px-5 py-4 flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="text-[10px] uppercase tracking-wider text-muted hover:text-text border border-line rounded-full px-3 py-1.5">Cancel</button>
              <button
                onClick={() => void reset()}
                disabled={busy}
                className="rounded-full bg-urgent text-white font-bold uppercase tracking-wider text-[10px] px-4 py-1.5 disabled:opacity-50"
              >
                {busy ? 'Resetting…' : 'Reset prices'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
