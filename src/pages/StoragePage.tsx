import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { api, type ApiArchiveFile, type ApiArchiveSummary } from '../api'

// Master Archive — the read-only window into the S3 Deep Archive vault the
// UGREEN NASes upload to (mirroring the Dropbox structure: 1_PODCASTS /
// 2_CLIENTS / …). Answers "where is my media and what is it costing" without
// a terminal. Restore / share / delete controls arrive with the full storage
// feature; this page deliberately cannot modify anything.

const card = 'rounded-2xl border border-line bg-panel/60'
const labelCls = 'text-[11px] uppercase tracking-wider font-bold text-muted'

const fmtBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log2(n) / 10))
  const v = n / 2 ** (10 * i)
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`
}
const fmtCount = (n: number) => n.toLocaleString('en-US')
const fmtWhen = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Cloud = safely frozen in Deep Archive; green dot = instantly downloadable.
function ClassBadge({ storageClass }: { storageClass: string }) {
  const cold = storageClass === 'DEEP_ARCHIVE' || storageClass === 'GLACIER'
  return cold ? (
    <span title="In the vault (Deep Archive) — restorable in 12–48h" className="inline-flex items-center gap-1 rounded-full border border-line bg-ink/40 text-muted px-2 py-0.5 text-[11px] font-bold">☁ archived</span>
  ) : (
    <span title={storageClass} className="inline-flex items-center gap-1 rounded-full border border-stage-done/40 bg-stage-done/10 text-stage-done px-2 py-0.5 text-[11px] font-bold">● instant</span>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={`${card} p-4`}>
      <div className={labelCls}>{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

type Level = { folders: string[]; files: ApiArchiveFile[]; truncated: boolean }

function FolderRow({ prefix, depth, sizeLookup }: {
  prefix: string
  depth: number
  sizeLookup: Map<string, { objects: number; bytes: number }>
}) {
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<Level | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = prefix.replace(/\/$/, '').split('/').pop() || prefix
  const agg = sizeLookup.get(prefix)

  const toggle = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (next && !level && !loading) {
      setLoading(true)
      setError(null)
      try {
        const res = await api.storageList(prefix)
        setLevel({ folders: res.folders, files: res.files, truncated: res.truncated })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setOpen(false)
      } finally {
        setLoading(false)
      }
    }
  }, [open, level, loading, prefix])

  return (
    <div>
      <button
        onClick={() => { void toggle() }}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-line/30 text-left"
        style={{ paddingLeft: `${8 + depth * 18}px` }}
      >
        <span className="text-muted text-xs w-3">{loading ? '…' : open ? '▾' : '▸'}</span>
        <span className="text-sm">📁 {name}</span>
        {agg && (
          <span className="ml-auto text-xs text-muted tabular-nums">
            {fmtBytes(agg.bytes)} · {fmtCount(agg.objects)} files
          </span>
        )}
      </button>
      {error && <div className="text-xs text-urgent px-2" style={{ paddingLeft: `${28 + depth * 18}px` }}>{error}</div>}
      {open && level && (
        <div>
          {level.folders.map((f) => (
            <FolderRow key={f} prefix={f} depth={depth + 1} sizeLookup={sizeLookup} />
          ))}
          {level.files.map((f) => (
            <div
              key={f.key}
              className="flex items-center gap-2 px-2 py-1 text-sm text-text/90"
              style={{ paddingLeft: `${28 + (depth + 1) * 18}px` }}
            >
              <span className="truncate min-w-0">{f.name}</span>
              <span className="ml-auto flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted tabular-nums">{fmtBytes(f.size)}</span>
                <ClassBadge storageClass={f.storageClass} />
              </span>
            </div>
          ))}
          {level.truncated && (
            <div className="text-xs text-muted px-2 py-1" style={{ paddingLeft: `${28 + (depth + 1) * 18}px` }}>
              …more entries in this folder than shown
            </div>
          )}
          {level.folders.length === 0 && level.files.length === 0 && (
            <div className="text-xs text-muted px-2 py-1" style={{ paddingLeft: `${28 + (depth + 1) * 18}px` }}>
              (empty)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function StoragePage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<ApiArchiveSummary | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [root, setRoot] = useState<Level | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    setError(null)
    if (force) setRefreshing(true)
    try {
      const [s, r] = await Promise.all([api.storageSummary(force), api.storageList('')])
      setConfigured(Boolean(s.configured && r.configured))
      setSummary(s.summary ?? null)
      setRoot(r.configured ? { folders: r.folders, files: r.files, truncated: r.truncated } : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (user?.role !== 'admin') {
    return <div className="max-w-2xl"><div className={`${card} p-8 text-center text-muted`}>This section is admin-only.</div></div>
  }

  const sizeLookup = new Map<string, { objects: number; bytes: number }>()
  for (const agg of summary?.topLevel ?? []) sizeLookup.set(agg.prefix, agg)
  for (const agg of summary?.secondLevel ?? []) sizeLookup.set(agg.prefix, agg)

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">🗄️ Master Archive</h1>
        <span className="text-sm text-muted">{summary ? `bucket: ${summary.bucket}` : ''}</span>
        <button
          onClick={() => { void load(true) }}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold border border-line bg-panel hover:bg-line/40 text-text disabled:opacity-50"
        >
          {refreshing ? 'Rescanning…' : '↻ Rescan'}
        </button>
      </div>

      {loading && <div className={`${card} p-8 text-center text-muted`}>Reading the vault…</div>}

      {!loading && error && (
        <div className={`${card} p-6 text-sm`}>
          <div className="font-bold text-urgent mb-1">Couldn't reach the archive</div>
          <div className="text-muted">{error}</div>
        </div>
      )}

      {!loading && !error && configured === false && (
        <div className={`${card} p-6 text-sm space-y-2`}>
          <div className="font-bold">Archive credentials not configured</div>
          <div className="text-muted">
            Set <code>ARCHIVE_ACCESS_KEY_ID</code> and <code>ARCHIVE_SECRET_ACCESS_KEY</code> (the archive-scoped
            IAM keys) on the Railway service, plus optional <code>ARCHIVE_BUCKET</code> /{' '}
            <code>ARCHIVE_REGION</code>. This page is read-only — the keys never need delete permission.
          </div>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Archived" value={fmtBytes(summary.totals.bytes)} sub={`${fmtCount(summary.totals.objects)} files`} />
            <Stat label="Est. monthly cost" value={`$${summary.estMonthlyUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} sub="storage only, list-price estimate" />
            <Stat
              label="In the vault (Deep Archive)"
              value={fmtBytes(summary.byClass.find((c) => c.storageClass === 'DEEP_ARCHIVE')?.bytes ?? 0)}
              sub="≈ $1/TB per month"
            />
            <Stat label="Last scanned" value={fmtWhen(summary.scannedAt) || '—'} sub={summary.truncated ? 'scan truncated (huge bucket)' : 'auto-rescans every 5 min'} />
          </div>

          <div className={`${card} p-4`}>
            <div className={`${labelCls} mb-2`}>Browse the archive</div>
            {root && root.folders.length === 0 && root.files.length === 0 ? (
              <div className="text-sm text-muted p-4 text-center">
                The vault is empty so far — the first uploads from the NAS will appear here as they land.
              </div>
            ) : (
              <div className="space-y-0.5">
                {root?.folders.map((f) => (
                  <FolderRow key={f} prefix={f} depth={0} sizeLookup={sizeLookup} />
                ))}
                {root?.files.map((f) => (
                  <div key={f.key} className="flex items-center gap-2 px-2 py-1 text-sm">
                    <span className="truncate min-w-0">{f.name}</span>
                    <span className="ml-auto flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted tabular-nums">{fmtBytes(f.size)}</span>
                      <ClassBadge storageClass={f.storageClass} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-muted max-w-3xl">
            ☁ archived = master safely frozen in Deep Archive (restorable in 12–48h). ● instant = still in a
            hot tier. This page can't change or delete anything — restore, share links, and delete-with-confirmation
            arrive in the next phase of the storage feature.
          </div>
        </>
      )}
    </div>
  )
}
