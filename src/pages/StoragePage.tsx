import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { api, type ApiArchiveFile, type ApiArchiveSummary, type ApiArchiveTransfer } from '../api'

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

// Live transfer rows, reported once a minute by the NAS. Considered stale
// (job finished, or the reporter/NAS is down) after 5 minutes of silence.
function TransferRow({ t, onCommand }: { t: ApiArchiveTransfer; onCommand: (name: string, action: 'pause' | 'resume') => Promise<void> }) {
  const [filesOpen, setFilesOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const ageMs = Date.now() - new Date(t.reportedAt).getTime()
  const stale = ageMs > 5 * 60 * 1000
  const done = (t.percent ?? 0) >= 100
  const progressAgeMs = Date.now() - new Date(t.lastProgressAt ?? t.reportedAt).getTime()
  // Paused when the Pause button's command was executed on the NAS, or —
  // fallback heuristic — when the reporter still posts but the log content
  // hasn't changed for 10+ min (a docker stop done from a terminal).
  const cmd = t.command
  const cmdPending = Boolean(cmd && !cmd.executedAt)
  const pausedByButton = !done && cmd?.action === 'stop' && Boolean(cmd.executedAt)
  // Just resumed: give rclone up to 10 min to produce fresh log lines before
  // the no-progress heuristic is allowed to call it paused again.
  const resuming =
    !done && cmd?.action === 'start' && Boolean(cmd.executedAt) &&
    progressAgeMs > 10 * 60 * 1000 &&
    Date.now() - new Date(cmd.executedAt as string).getTime() < 10 * 60 * 1000
  const paused = !done && !stale && !resuming && (pausedByButton || progressAgeMs > 10 * 60 * 1000)
  const pct = Math.max(0, Math.min(100, t.percent ?? 0))
  const sendCommand = async (action: 'pause' | 'resume') => {
    setSending(true)
    try {
      await onCommand(t.name, action)
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold">{done ? '✅' : stale ? '⚠️' : paused ? '⏸' : '📤'} {t.name}</span>
        {paused && (
          <span className="inline-flex items-center rounded-full border border-line bg-ink/40 text-muted px-2 py-0.5 text-[11px] font-bold">
            {pausedByButton ? 'paused' : 'paused — waiting its turn'}
          </span>
        )}
        {cmdPending && (
          <span className="inline-flex items-center rounded-full border border-line bg-ink/40 text-muted px-2 py-0.5 text-[11px] font-bold">
            {cmd?.action === 'stop' ? 'pausing…' : 'resuming…'} the NAS picks this up within ~30s
          </span>
        )}
        {resuming && !cmdPending && (
          <span className="inline-flex items-center rounded-full border border-line bg-ink/40 text-muted px-2 py-0.5 text-[11px] font-bold">
            resuming — first progress lines coming up
          </span>
        )}
        {!done && !stale && !cmdPending && (
          <button
            onClick={() => { void sendCommand(paused ? 'resume' : 'pause') }}
            disabled={sending}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-panel hover:bg-line/40 px-2.5 py-0.5 text-[11px] font-bold disabled:opacity-50"
            title={paused ? 'Start this job again — it resumes exactly where it stopped' : 'Stop this job cleanly — progress is kept, resume any time'}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        )}
        {t.errors > 0 && (
          <span className="inline-flex items-center rounded-full border border-urgent/40 bg-urgent/10 text-urgent px-2 py-0.5 text-[11px] font-bold">
            {t.errors} error{t.errors === 1 ? '' : 's'} — auto-retrying; verify will catch anything missed
          </span>
        )}
        <span className="ml-auto text-xs text-muted tabular-nums">
          {t.bytesDone && t.bytesTotal ? `${t.bytesDone} of ${t.bytesTotal}` : ''}
          {!done && t.speed ? ` · ${t.speed}` : ''}
          {!done && t.eta ? ` · ETA ${t.eta}` : ''}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-ink/60 overflow-hidden">
        <div
          className={`h-full rounded-full ${done ? 'bg-stage-done' : 'bg-gradient-to-r from-stage-producing to-stage-mastering'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!done && !stale && !paused && (t.currentFiles?.length ?? 0) > 0 && (
        <div className="mt-1.5">
          <button
            onClick={() => setFilesOpen((v) => !v)}
            className="text-[11px] text-muted hover:text-text inline-flex items-center gap-1"
          >
            <span className="text-[9px]">{filesOpen ? '▾' : '▸'}</span>
            now uploading {t.currentFiles!.length} file{t.currentFiles!.length === 1 ? '' : 's'}
          </button>
          {filesOpen && (
            <div className="mt-1 space-y-0.5">
              {t.currentFiles!.map((f, i) => {
                const file = typeof f === 'string' ? { name: f, pct: null, speed: '', eta: '' } : f
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-muted pl-4">
                    <span className="truncate min-w-0">🎬 {file.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {file.pct != null ? `${file.pct}%` : ''}
                      {file.speed ? ` · ${file.speed}` : ''}
                      {file.eta ? ` · ${file.eta} left` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div className="mt-1 text-[11px] text-muted">
        {done
          ? `Finished — ${t.filesTotal ? fmtCount(t.filesTotal) + ' files' : 'complete'}. Ready to verify.`
          : stale
            ? `No update in ${Math.round(ageMs / 60000)} min — the job may have just finished, or the reporter on the NAS stopped. Check Docker on RED if this persists.`
            : paused
              ? `Held where it stopped (${t.filesDone != null && t.filesTotal != null ? `${fmtCount(t.filesDone)} of ${fmtCount(t.filesTotal)} files` : 'progress kept'}) — resumes exactly here when its box frees up.`
              : `${t.filesDone != null && t.filesTotal != null ? `${fmtCount(t.filesDone)} of ${fmtCount(t.filesTotal)} files · ` : ''}updated ${Math.max(1, Math.round(ageMs / 1000))}s ago`}
      </div>
    </div>
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
  const [transfers, setTransfers] = useState<ApiArchiveTransfer[]>([])
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [root, setRoot] = useState<Level | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [s, r] = await Promise.all([api.storageSummary(false), api.storageList('')])
      setConfigured(Boolean(s.configured && r.configured))
      setSummary(s.summary ?? null)
      setRoot(r.configured ? { folders: r.folders, files: r.files, truncated: r.truncated } : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onCommand = useCallback(async (name: string, action: 'pause' | 'resume') => {
    await api.storageTransferCommand(name, action)
    try {
      const res = await api.storageTransfers()
      setTransfers(res.transfers)
    } catch {
      /* next 30s poll will catch up */
    }
  }, [])

  // Poll live transfers every 30s — cheap (a DB read), and it's the whole
  // point of the page while migration runs.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await api.storageTransfers()
        if (alive) setTransfers(res.transfers)
      } catch {
        /* transfers are best-effort; the card just doesn't render */
      }
    }
    void tick()
    const id = setInterval(() => { void tick() }, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

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
      </div>

      <div className={`${card} p-4`}>
        <div className={`${labelCls} mb-1`}>Transfers — NAS → vault</div>
        {transfers.length > 0 ? (
          <div className="divide-y divide-line/60">
            {transfers.map((t) => (
              <TransferRow key={t.name} t={t} onCommand={onCommand} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted py-3">
            No live transfer feed yet. The reporter on the NAS isn't running — it's the small
            always-on container that reads each transfer's log once a minute and sends it here.
            Start it on RED (the one-line <span className="font-mono">archive-reporter</span> paste)
            and progress bars, speeds, and ETAs appear on this card within about a minute.
            Files that have already arrived are always visible in the tree below either way.
          </div>
        )}
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
