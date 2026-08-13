import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import {
  api,
  type ApiContractor,
  type ApiInvoice,
  type ApiInvoiceSettings,
} from '../api'

// ── money + parsing helpers ──────────────────────────────────────────
const money = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollarsToCents = (v: string | number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const centsToInput = (cents: number) => (cents ? (cents / 100).toString() : '')
const fmtDate = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const defaultPeriod = () => new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })

type EditItem = { desc: string; hours: string; rate: string }
type Tab = 'dashboard' | 'new' | 'invoices' | 'contractors' | 'settings'

// Parse pasted spreadsheet rows / CSV into line items.
function parseRows(text: string, fallbackRateCents: number): EditItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s{2,}/
  let rows = lines.map((l) => (l as string).split(delim as never).map((c) => c.trim()))
  const first = rows[0].map((c) => c.toLowerCase())
  let di = 0, hi = 1, ri = 2
  if (first.some((c) => /desc|task|item|work/.test(c)) || first.some((c) => /hour|hrs|qty/.test(c))) {
    const find = (re: RegExp, def: number) => { const idx = first.findIndex((c) => re.test(c)); return idx >= 0 ? idx : def }
    di = find(/desc|task|item|work/, 0); hi = find(/hour|hrs|qty/, 1); ri = find(/rate|price|\$/, 2)
    rows = rows.slice(1)
  }
  const fallbackRate = fallbackRateCents ? (fallbackRateCents / 100).toString() : ''
  return rows
    .map((r) => {
      const hours = (r[hi] || '').replace(/[^0-9.\-]/g, '')
      const rate = r[ri] !== undefined && r[ri] !== '' ? (r[ri] || '').replace(/[^0-9.\-]/g, '') : fallbackRate
      return { desc: r[di] || '', hours, rate }
    })
    .filter((r) => r.desc || r.hours)
}

// ── shared UI atoms (Slate design system) ────────────────────────────
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

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: 'text-stage-done bg-stage-done/10 border-stage-done/40',
    unpaid: 'text-stage-tracking bg-stage-tracking/10 border-stage-tracking/40',
    draft: 'text-muted bg-line/30 border-line',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold border rounded-full px-2.5 py-1 ${map[status] || map.draft}`}>
      {status}
    </span>
  )
}

// Locked to a single owner account — must match the server's
// INVOICING_OWNER_EMAIL (defaults to ryan@strawhutmedia.com). The server
// enforces this on every request; this is the matching UI gate.
const OWNER_EMAIL = 'ryan@strawhutmedia.com'

// ── main page ─────────────────────────────────────────────────────────
export default function InvoicingPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [settings, setSettings] = useState<ApiInvoiceSettings | null>(null)
  const [contractors, setContractors] = useState<ApiContractor[]>([])
  const [invoices, setInvoices] = useState<ApiInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }, [])

  const reload = useCallback(async () => {
    const [s, c, iv] = await Promise.all([api.invoiceSettings(), api.contractors(), api.invoices()])
    setSettings(s.settings); setContractors(c.contractors); setInvoices(iv.invoices)
  }, [])

  useEffect(() => { void reload().finally(() => setLoading(false)) }, [reload])

  if (!user) return null
  if ((user.email || '').trim().toLowerCase() !== OWNER_EMAIL) {
    return <div className="max-w-2xl"><div className={`${card} p-8 text-center text-muted`}>This section is private.</div></div>
  }
  if (loading || !settings) return <div className="text-muted text-sm">Loading invoicing…</div>

  const viewing = invoices.find((i) => i.id === viewingId) || null
  const unpaid = invoices.filter((i) => i.status === 'unpaid')
  const owedCents = unpaid.reduce((s, i) => s + i.totalCents, 0)
  const paidCents = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalCents, 0)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'new', label: 'New Invoice' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'contractors', label: 'Contractors' },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-5xl text-rainbow">Invoices</h1>
          <p className="text-muted text-sm mt-1">Turn contractor hours into invoices, then pay by card in Melio.</p>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setViewingId(null) }}
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition ${
              tab === t.key && !viewing ? 'text-text border-stage-mastering' : 'text-muted border-transparent hover:text-text'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {viewing ? (
        <InvoicePreview
          invoice={viewing} settings={settings}
          onBack={() => setViewingId(null)}
          onChanged={reload} flash={flash}
        />
      ) : tab === 'dashboard' ? (
        <Dashboard
          owedCents={owedCents} paidCents={paidCents} unpaidCount={unpaid.length}
          contractorCount={contractors.length} invoices={invoices.slice(0, 6)}
          onOpen={(id) => setViewingId(id)} onNew={() => setTab('new')}
        />
      ) : tab === 'new' ? (
        <NewInvoice
          contractors={contractors} settings={settings} flash={flash}
          onCreated={async (id) => { await reload(); setViewingId(id) }}
        />
      ) : tab === 'invoices' ? (
        <InvoiceList invoices={invoices} onOpen={(id) => setViewingId(id)} onNew={() => setTab('new')} />
      ) : tab === 'contractors' ? (
        <Contractors contractors={contractors} onChanged={reload} flash={flash} />
      ) : (
        <SettingsPanel settings={settings} onSaved={(s) => setSettings(s)} flash={flash} />
      )}

      {toast && (
        <div className="fixed left-1/2 bottom-8 -translate-x-1/2 z-50 bg-text text-ink font-semibold text-sm px-4 py-2.5 rounded-full shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────
function Dashboard({ owedCents, paidCents, unpaidCount, contractorCount, invoices, onOpen, onNew }: {
  owedCents: number; paidCents: number; unpaidCount: number; contractorCount: number
  invoices: ApiInvoice[]; onOpen: (id: string) => void; onNew: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-stage-mastering/30 bg-stage-mastering/10 p-5">
          <div className={labelCls}>Owed to contractors</div>
          <div className="text-3xl font-bold mt-1 tabular-nums text-stage-mastering">{money(owedCents)}</div>
        </div>
        <Stat label="Unpaid invoices" value={String(unpaidCount)} />
        <Stat label="Total paid" value={money(paidCents)} accent="text-stage-done" />
        <Stat label="Contractors" value={String(contractorCount)} />
      </div>
      <div className={card}>
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h2 className="font-display text-xl">Recent invoices</h2>
          <Btn variant="primary" onClick={onNew}>+ New Invoice</Btn>
        </div>
        {invoices.length === 0 ? (
          <div className="p-10 text-center text-muted">No invoices yet — create your first one.</div>
        ) : (
          <InvoiceRows invoices={invoices} onOpen={onOpen} />
        )}
      </div>
    </div>
  )
}
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/60 p-5">
      <div className={labelCls}>{label}</div>
      <div className={`text-3xl font-bold mt-1 tabular-nums ${accent || 'text-text'}`}>{value}</div>
    </div>
  )
}

// ── Invoice list ──────────────────────────────────────────────────────
function InvoiceList({ invoices, onOpen, onNew }: { invoices: ApiInvoice[]; onOpen: (id: string) => void; onNew: () => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const filtered = invoices.filter((i) =>
    (status === 'all' || i.status === status) &&
    (!q || i.contractorName.toLowerCase().includes(q.toLowerCase()) || i.number.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="all">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="draft">Draft</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contractor or #…" className={`${inputCls} w-64`} />
        <div className="ml-auto"><Btn variant="primary" onClick={onNew}>+ New Invoice</Btn></div>
      </div>
      <div className={card}>
        {invoices.length === 0 ? (
          <div className="p-10 text-center text-muted">No invoices yet.</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted">No matches.</div>
        ) : (
          <InvoiceRows invoices={filtered} onOpen={onOpen} />
        )}
      </div>
    </div>
  )
}
function InvoiceRows({ invoices, onOpen }: { invoices: ApiInvoice[]; onOpen: (id: string) => void }) {
  return (
    <div className="divide-y divide-line">
      {invoices.map((i) => (
        <button key={i.id} onClick={() => onOpen(i.id)}
          className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-line/20 transition">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm font-bold">{i.number}</div>
            <div className="text-xs text-muted">{fmtDate(i.issueDate)}</div>
          </div>
          <div className="min-w-0 flex-1 truncate text-sm">{i.contractorName || '—'}</div>
          <div className="hidden sm:block flex-1 text-sm text-muted truncate">{i.period || '—'}</div>
          <div className="text-sm font-bold tabular-nums text-right w-24">{money(i.totalCents)}</div>
          <div className="w-20 text-right"><StatusChip status={i.status} /></div>
        </button>
      ))}
    </div>
  )
}

// ── New / edit invoice ────────────────────────────────────────────────
function NewInvoice({ contractors, settings, flash, onCreated }: {
  contractors: ApiContractor[]; settings: ApiInvoiceSettings; flash: (m: string) => void; onCreated: (id: string) => void
}) {
  const [contractorId, setContractorId] = useState('')
  const [period, setPeriod] = useState(defaultPeriod())
  const [issueDate, setIssueDate] = useState(todayISO())
  const [items, setItems] = useState<EditItem[]>([{ desc: '', hours: '', rate: '' }])
  const [notes, setNotes] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [saving, setSaving] = useState(false)

  const contractor = contractors.find((c) => c.id === contractorId)

  function selectContractor(id: string) {
    setContractorId(id)
    const c = contractors.find((x) => x.id === id)
    if (c) setItems((prev) => prev.map((it) => (it.rate ? it : { ...it, rate: centsToInput(c.hourlyRateCents) })))
  }
  const setItem = (idx: number, patch: Partial<EditItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const total = items.reduce((s, it) => s + (parseFloat(it.hours) || 0) * dollarsToCents(it.rate), 0)

  async function save() {
    if (!contractorId) { flash('Choose a contractor first'); return }
    const lineItems = items
      .filter((it) => it.desc.trim() || it.hours)
      .map((it) => ({ desc: it.desc.trim(), hours: parseFloat(it.hours) || 0, rateCents: dollarsToCents(it.rate) }))
    if (!lineItems.length) { flash('Add at least one line with hours'); return }
    setSaving(true)
    try {
      const { invoice } = await api.createInvoice({ contractorId, period, issueDate, notes, lineItems })
      flash('Invoice saved')
      onCreated(invoice.id)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className={`${card} p-5`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={labelCls}>Contractor</span>
            <select value={contractorId} onChange={(e) => selectContractor(e.target.value)} className={inputCls}>
              <option value="">— Select —</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Period</span>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="August 2026" className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Issue date</span>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} />
          </label>
          <div className="space-y-1">
            <span className={labelCls}>Number</span>
            <div className="px-3 py-2 text-sm text-muted">Auto ({settings.invoicePrefix}-{String(settings.nextNumber).padStart(4, '0')})</div>
          </div>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl">Hours &amp; line items</h2>
          <Btn onClick={() => setShowImport(true)}>⇪ Paste / upload hours</Btn>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wider">
                <th className="py-1.5 font-bold">Description</th>
                <th className="py-1.5 font-bold text-right w-24">Hours</th>
                <th className="py-1.5 font-bold text-right w-28">Rate ($)</th>
                <th className="py-1.5 font-bold text-right w-28">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td className="py-1 pr-2">
                    <input value={it.desc} onChange={(e) => setItem(idx, { desc: e.target.value })}
                      placeholder="e.g. Editing – Episode 41" className={inputCls} />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={it.hours} onChange={(e) => setItem(idx, { hours: e.target.value })}
                      inputMode="decimal" className={`${inputCls} text-right`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={it.rate} onChange={(e) => setItem(idx, { rate: e.target.value })}
                      inputMode="decimal" className={`${inputCls} text-right`} />
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums font-semibold whitespace-nowrap">
                    {money((parseFloat(it.hours) || 0) * dollarsToCents(it.rate))}
                  </td>
                  <td className="py-1 text-center">
                    <button onClick={() => setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : [{ desc: '', hours: '', rate: '' }]))}
                      className="text-muted hover:text-urgent px-1" title="Remove">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => setItems((p) => [...p, { desc: '', hours: '', rate: contractor ? centsToInput(contractor.hourlyRateCents) : '' }])}
          className="mt-2 text-sm text-muted hover:text-text">+ Add line</button>

        <div className="mt-4 pt-4 border-t border-line flex items-end justify-between gap-4 flex-wrap">
          <label className="space-y-1 flex-1 min-w-[240px]">
            <span className={labelCls}>Notes on the invoice (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Thanks for your work this month!" className={inputCls} />
          </label>
          <div className="text-right">
            <div className={labelCls}>Total</div>
            <div className="text-3xl font-bold tabular-nums text-stage-mastering">{money(total)}</div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save & preview invoice'}</Btn>
      </div>

      {showImport && (
        <ImportModal
          fallbackRateCents={contractor?.hourlyRateCents || 0}
          onClose={() => setShowImport(false)}
          onImport={(rows) => {
            setItems((prev) => {
              const base = prev.length === 1 && !prev[0].desc && !prev[0].hours ? [] : prev
              return [...base, ...rows]
            })
            setShowImport(false)
            flash(`Imported ${rows.length} line${rows.length > 1 ? 's' : ''}`)
          }}
        />
      )}
    </div>
  )
}

function ImportModal({ fallbackRateCents, onClose, onImport }: {
  fallbackRateCents: number; onClose: () => void; onImport: (rows: EditItem[]) => void
}) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const parsed = parseRows(text, fallbackRateCents)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`${card} bg-panel w-full max-w-lg`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h3 className="font-display text-xl">Paste or upload hours</h3>
          <button onClick={onClose} className="text-muted hover:text-text">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted">
            Copy rows from Excel or Google Sheets and paste, or upload a CSV. Columns read as
            <b className="text-text"> Description</b>, <b className="text-text">Hours</b>, and optionally
            <b className="text-text"> Rate</b>. A header row is detected automatically.
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
            placeholder={'Editing – Episode 41\t12\t45\nShow notes\t3\t45'}
            className={`${inputCls} font-mono text-xs`} />
          <div className="flex items-center justify-between">
            <Btn onClick={() => fileRef.current?.click()}>⭱ Upload CSV</Btn>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden
              onChange={(e) => {
                const f = e.target.files?.[0]; if (!f) return
                const r = new FileReader(); r.onload = () => setText(String(r.result || '')); r.readAsText(f)
                e.target.value = ''
              }} />
            <span className="text-xs text-muted">{parsed.length ? `${parsed.length} line${parsed.length > 1 ? 's' : ''} detected` : ''}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-line">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => parsed.length ? onImport(parsed) : undefined} disabled={!parsed.length}>Import lines</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Invoice preview ───────────────────────────────────────────────────
function InvoicePreview({ invoice, settings, onBack, onChanged, flash }: {
  invoice: ApiInvoice; settings: ApiInvoiceSettings; onBack: () => void; onChanged: () => Promise<void>; flash: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  async function setStatus(status: 'paid' | 'unpaid') {
    setBusy(true)
    try { await api.updateInvoice(invoice.id, { status }); await onChanged(); flash(status === 'paid' ? 'Marked paid ✓' : 'Marked unpaid') }
    finally { setBusy(false) }
  }
  async function del() {
    if (!confirm(`Delete invoice ${invoice.number}? This can't be undone.`)) return
    await api.deleteInvoice(invoice.id); await onChanged(); onBack(); flash('Invoice deleted')
  }
  async function email() {
    setBusy(true)
    try { const r = await api.emailInvoice(invoice.id); flash(`Emailed to ${r.sentTo}`) }
    catch (e) { flash(e instanceof Error ? e.message : 'Email failed') }
    finally { setBusy(false) }
  }
  function copyTotal() {
    const v = (invoice.totalCents / 100).toFixed(2)
    navigator.clipboard?.writeText(v).then(() => flash(`Copied $${v}`)).catch(() => flash(`Total: $${v}`))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Btn variant="ghost" onClick={onBack}>← Back</Btn>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip status={invoice.status} />
          {invoice.status === 'paid'
            ? <Btn onClick={() => setStatus('unpaid')} disabled={busy}>Mark unpaid</Btn>
            : <Btn onClick={() => setStatus('paid')} disabled={busy}>✓ Mark as paid</Btn>}
          <Btn onClick={email} disabled={busy}>✉ Email contractor</Btn>
          <a href={api.invoicePdfUrl(invoice.id)} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold border border-line bg-panel hover:bg-line/40 text-text">⭳ PDF</a>
          <Btn variant="danger" onClick={del}>Delete</Btn>
        </div>
      </div>

      {/* pay-in-Melio banner */}
      <div className="rounded-2xl border border-stage-mastering/30 bg-stage-mastering/10 p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className={labelCls}>Amount to pay in Melio</div>
          <div className="text-4xl font-bold tabular-nums text-stage-mastering mt-1">{money(invoice.totalCents)}</div>
        </div>
        <div className="flex items-center gap-2">
          <Btn onClick={copyTotal}>⧉ Copy amount</Btn>
          <a href="https://meliopayments.com" target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold bg-gradient-to-r from-stage-producing to-stage-mastering text-white hover:opacity-90">Open Melio ↗</a>
        </div>
      </div>

      {/* the invoice document */}
      <div className="rounded-2xl border border-line bg-line/20 p-4 sm:p-8 overflow-x-auto">
        <div className="bg-white text-[#1a1a1a] rounded-lg shadow-xl mx-auto p-8 sm:p-10 max-w-[720px] text-sm">
          <div className="flex justify-between items-start gap-4 mb-8">
            <div className="flex items-center gap-3">
              {settings.logoDataUrl
                ? <img src={settings.logoDataUrl} alt="" className="w-11 h-11 object-contain" />
                : <div className="w-11 h-11 rounded-lg grid place-items-center text-white font-extrabold" style={{ background: '#A96B12' }}>SH</div>}
              <div>
                <div className="font-bold text-[17px]">{settings.companyName}</div>
                <div className="text-[#666] text-xs">{[settings.companyEmail, settings.companyAddress].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[26px] font-bold tracking-wide" style={{ color: '#A96B12' }}>INVOICE</div>
              <div className="text-[#666] text-xs mt-1 tabular-nums">{invoice.number}</div>
              <div className="text-[#666] text-xs tabular-nums">{fmtDate(invoice.issueDate)}</div>
            </div>
          </div>
          <div className="flex justify-between gap-6 mb-7 flex-wrap">
            <Party label="From (Contractor)" lines={[invoice.contractorName, invoice.contractorEmail, invoice.contractorAddress]} />
            <Party label="Bill To" lines={[settings.companyName, settings.companyEmail, settings.companyAddress]} />
            <Party label="Period" lines={[invoice.period || '—']} />
          </div>
          <table className="w-full border-collapse mb-4">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide" style={{ color: '#8a7350' }}>
                <th className="text-left py-2 px-2 border-b-2" style={{ background: '#faf7f1', borderColor: '#eadfce' }}>Description</th>
                <th className="text-right py-2 px-2 border-b-2" style={{ background: '#faf7f1', borderColor: '#eadfce' }}>Hours</th>
                <th className="text-right py-2 px-2 border-b-2" style={{ background: '#faf7f1', borderColor: '#eadfce' }}>Rate</th>
                <th className="text-right py-2 px-2 border-b-2" style={{ background: '#faf7f1', borderColor: '#eadfce' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((it, i) => (
                <tr key={i} className="border-b" style={{ borderColor: '#eee' }}>
                  <td className="py-2.5 px-2">{it.desc || '—'}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{it.hours}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{money(it.rateCents)}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{money(it.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end mb-6">
            <table className="min-w-[260px]">
              <tbody>
                <tr><td className="py-1 px-3 text-[#666]">Subtotal</td><td className="py-1 px-3 text-right tabular-nums">{money(invoice.totalCents)}</td></tr>
                <tr className="text-[19px] font-bold"><td className="py-2 px-3 border-t-2" style={{ borderColor: '#1a1a1a' }}>Total Due</td>
                  <td className="py-2 px-3 text-right border-t-2 tabular-nums" style={{ borderColor: '#1a1a1a', color: '#A96B12' }}>{money(invoice.totalCents)}</td></tr>
              </tbody>
            </table>
          </div>
          {invoice.notes && <div className="border-t pt-4 text-xs text-[#666] whitespace-pre-wrap" style={{ borderColor: '#eee' }}>{invoice.notes}</div>}
          {invoice.payMethod && (
            <div className="text-xs text-[#666] mt-2">
              Payment method: {invoice.payMethod}{invoice.payMethod === 'ACH' ? ' · funded by credit card via Melio' : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function Party({ label, lines }: { label: string; lines: string[] }) {
  const clean = lines.filter(Boolean)
  return (
    <div className="text-xs leading-relaxed">
      <div className="text-[10px] uppercase tracking-wide font-bold text-[#999] mb-1">{label}</div>
      {clean.length === 0 ? <div className="text-[#666]">—</div> : clean.map((l, i) => (
        <div key={i} className={i === 0 ? 'font-bold text-[#1a1a1a] text-[13px]' : 'text-[#666]'}>{l}</div>
      ))}
    </div>
  )
}

// ── Contractors ───────────────────────────────────────────────────────
function W9Chip({ status }: { status: string }) {
  const map: Record<string, { c: string; t: string }> = {
    on_file: { c: 'text-stage-done bg-stage-done/10 border-stage-done/40', t: 'W9 on file' },
    requested: { c: 'text-stage-tracking bg-stage-tracking/10 border-stage-tracking/40', t: 'W9 requested' },
    none: { c: 'text-muted bg-line/30 border-line', t: 'No W9' },
  }
  const m = map[status] || map.none
  return <span className={`inline-flex items-center text-[11px] uppercase tracking-wider font-bold border rounded-full px-2.5 py-1 ${m.c}`}>{m.t}</span>
}

function Contractors({ contractors, onChanged, flash }: {
  contractors: ApiContractor[]; onChanged: () => Promise<void>; flash: (m: string) => void
}) {
  const [editing, setEditing] = useState<ApiContractor | null | 'new'>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [vaultReady, setVaultReady] = useState(true)

  useEffect(() => { api.vaultStatus().then((v) => setVaultReady(v.ready)).catch(() => {}) }, [])

  async function makeLink(c: ApiContractor) {
    setLinking(c.id)
    try {
      const { url } = await api.createIntakeLink(c.id)
      try { await navigator.clipboard.writeText(url) } catch { /* fall through */ }
      await onChanged()
      flash('W9 link copied — send it to ' + c.name)
      window.prompt('Send this private W9 link to ' + c.name + ' (expires in 21 days):', url)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create link')
    } finally { setLinking(null) }
  }

  return (
    <div className="space-y-4">
      {!vaultReady && (
        <div className="rounded-2xl border border-urgent/40 bg-urgent/10 p-4 text-sm">
          <b className="text-urgent">Secure W9 storage isn’t turned on yet.</b>
          <span className="text-muted"> Vendors can’t submit until the encryption key <code>INVOICING_ENC_KEY</code> is set on the Railway service. Contractor profiles and invoicing still work.</span>
        </div>
      )}
      <div className="flex justify-end"><Btn variant="primary" onClick={() => setEditing('new')}>+ Add contractor</Btn></div>
      <div className={card}>
        {contractors.length === 0 ? (
          <div className="p-10 text-center text-muted">No contractors yet — add your freelancers to start invoicing them.</div>
        ) : (
          <div className="divide-y divide-line">
            {contractors.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold flex items-center gap-2">{c.name} <W9Chip status={c.w9Status} /></div>
                  <div className="text-xs text-muted">
                    {c.email || 'no email'} · {c.payMethod}
                    {c.w9Status === 'on_file' && c.tinMasked && <> · {c.tinType.toUpperCase()} {c.tinMasked}</>}
                  </div>
                </div>
                <div className="text-sm tabular-nums text-muted">{c.hourlyRateCents ? `${money(c.hourlyRateCents)}/hr` : '—'}</div>
                <Btn variant="ghost" onClick={() => makeLink(c)} disabled={linking === c.id}>
                  {linking === c.id ? '…' : c.w9Status === 'on_file' ? '↻ New W9 link' : '🔗 W9 link'}
                </Btn>
                <Btn variant="ghost" onClick={() => setEditing(c)}>Edit</Btn>
                <Btn variant="ghost" onClick={async () => {
                  if (!confirm(`Delete ${c.name}? Their saved invoices remain.`)) return
                  await api.deleteContractor(c.id); await onChanged(); flash('Contractor deleted')
                }}>Delete</Btn>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <ContractorModal
          contractor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await onChanged(); flash('Contractor saved') }}
        />
      )}
    </div>
  )
}
function ContractorModal({ contractor, onClose, onSaved }: {
  contractor: ApiContractor | null; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(contractor?.name || '')
  const [email, setEmail] = useState(contractor?.email || '')
  const [rate, setRate] = useState(contractor ? centsToInput(contractor.hourlyRateCents) : '')
  const [payMethod, setPayMethod] = useState<'ACH' | 'Check' | 'Other'>(contractor?.payMethod || 'ACH')
  const [address, setAddress] = useState(contractor?.address || '')
  const [notes, setNotes] = useState(contractor?.notes || '')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const body = { name: name.trim(), email, hourlyRateCents: dollarsToCents(rate), payMethod, address, notes }
      if (contractor) await api.updateContractor(contractor.id, body)
      else await api.createContractor(body)
      onSaved()
    } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`${card} bg-panel w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h3 className="font-display text-xl">{contractor ? 'Edit contractor' : 'Add contractor'}</h3>
          <button onClick={onClose} className="text-muted hover:text-text">✕</button>
        </div>
        <div className="p-4 grid gap-3">
          <Labeled label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Jordan Rivera" /></Labeled>
          <Labeled label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="jordan@email.com" /></Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Hourly rate ($)"><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={inputCls} placeholder="45" /></Labeled>
            <Labeled label="Gets paid by">
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'ACH' | 'Check' | 'Other')} className={inputCls}>
                <option value="ACH">ACH (bank deposit)</option>
                <option value="Check">Check (mailed)</option>
                <option value="Other">Other</option>
              </select>
            </Labeled>
          </div>
          <Labeled label="Mailing address (for checks)"><input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="Optional" /></Labeled>
          <Labeled label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Optional" /></Labeled>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-line">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save contractor'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────
function SettingsPanel({ settings, onSaved, flash }: {
  settings: ApiInvoiceSettings; onSaved: (s: ApiInvoiceSettings) => void; flash: (m: string) => void
}) {
  const [companyName, setCompanyName] = useState(settings.companyName)
  const [companyEmail, setCompanyEmail] = useState(settings.companyEmail)
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress)
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix)
  const [nextNumber, setNextNumber] = useState(String(settings.nextNumber))
  const [logo, setLogo] = useState<string | null>(settings.logoDataUrl)
  const [saving, setSaving] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  function onLogoFile(f: File) {
    if (f.size > 1_000_000) { flash('Logo too large (max ~1MB)'); return }
    const r = new FileReader()
    r.onload = () => setLogo(String(r.result || ''))
    r.readAsDataURL(f)
  }
  async function save() {
    setSaving(true)
    try {
      const { settings: s } = await api.updateInvoiceSettings({
        companyName, companyEmail, companyAddress, invoicePrefix,
        nextNumber: parseInt(nextNumber) || 1, logoDataUrl: logo,
      })
      onSaved(s); flash('Settings saved')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`${card} p-5 space-y-4`}>
        <h2 className="font-display text-xl">Company &amp; branding</h2>
        <div className="flex items-center gap-4">
          {logo
            ? <img src={logo} alt="logo" className="w-16 h-16 object-contain rounded-lg border border-line bg-white/5 p-1" />
            : <div className="w-16 h-16 rounded-lg grid place-items-center text-white font-extrabold border border-line" style={{ background: '#A96B12' }}>SH</div>}
          <div className="flex gap-2">
            <Btn onClick={() => logoRef.current?.click()}>Upload logo</Btn>
            {logo && <Btn variant="ghost" onClick={() => setLogo(null)}>Remove</Btn>}
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/svg+xml" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); e.target.value = '' }} />
          </div>
        </div>
        <p className="text-xs text-muted">PNG or JPG shows on the emailed/printed PDF. SVG shows in the on-screen invoice.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Company name"><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Email"><input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} className={inputCls} /></Labeled>
          <div className="sm:col-span-2"><Labeled label="Address"><input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} className={inputCls} /></Labeled></div>
          <Labeled label="Invoice prefix"><input value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} className={inputCls} placeholder="SHM" /></Labeled>
          <Labeled label="Next invoice number"><input value={nextNumber} onChange={(e) => setNextNumber(e.target.value)} inputMode="numeric" className={inputCls} /></Labeled>
        </div>
        <div className="flex justify-end"><Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Btn></div>
      </div>
    </div>
  )
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 block"><span className={labelCls}>{label}</span>{children}</label>
}
