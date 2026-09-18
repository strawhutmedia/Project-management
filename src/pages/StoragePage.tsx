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
function TransferRow({ t, onCommand, onDismiss }: {
  t: ApiArchiveTransfer
  onCommand: (name: string, action: 'pause' | 'resume') => Promise<void>
  onDismiss: (name: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  // A click only KICKS OFF the server-side check (instant response); the
  // verdict arrives with the normal 30s poll. `kickedAt` keeps the button in
  // its "verifying" state until the server confirms or the poll catches up.
  const [kickedAt, setKickedAt] = useState<number | null>(null)
  const verify = t.verify ?? null
  const verifying =
    Boolean(t.verifying) ||
    (kickedAt != null && Date.now() - kickedAt < 45_000 && (!verify || new Date(verify.runAt).getTime() < kickedAt))
  const [acceptedLocal, setAcceptedLocal] = useState(false)
  const heal = t.heal ?? null
  const missing = verify?.missingCount ?? 0
  const accepted = missing > 0 && (acceptedLocal || (heal?.acceptedMissing != null && missing <= heal.acceptedMissing))
  // rclone printing "directory not found" for its source root means the
  // job's drive is unplugged (or its dock is off) — a physical problem no
  // retry or approval can fix. Show that, plainly, instead of scope advice.
  const driveMissing =
    missing > 0 && (t.errorLines ?? []).some((l) => /error reading source root|directory not found/i.test(l))
  const healGaveUp = missing > 0 && !accepted && !driveMissing && (heal?.attempts ?? 0) >= (heal?.maxAttempts ?? 3)
  const healRetrying = missing > 0 && !accepted && !driveMissing && !healGaveUp && (heal?.attempts ?? 0) > 0
  const acceptMissing = async () => {
    try {
      await api.storageAcceptMissing(t.name)
      setAcceptedLocal(true)
    } catch {
      /* row keeps asking; next poll shows real state */
    }
  }
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
  const runVerify = async () => {
    setVerifyError(null)
    try {
      await api.storageVerify(t.name)
      setKickedAt(Date.now())
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err))
    }
  }
  const sendCommand = async (action: 'pause' | 'resume') => {
    setSending(true)
    try {
      await onCommand(t.name, action)
    } finally {
      setSending(false)
    }
  }
  // ONE plain status per row (Ryan, 2026-09-18: "so much text… my team will
  // be completely confused"). Everything else — buttons, file lists, verdict
  // detail — lives behind the details chevron.
  const chipBase = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold'
  const status = (() => {
    if (stale && !done) return { icon: '⚠️', label: 'no signal', cls: 'border-stage-tracking/50 bg-stage-tracking/10 text-stage-tracking' }
    if (!done) {
      if (cmdPending) return { icon: '📤', label: cmd?.action === 'stop' ? 'pausing…' : 'starting…', cls: 'border-line bg-ink/40 text-muted' }
      if (resuming) return { icon: '📤', label: 'starting back up', cls: 'border-line bg-ink/40 text-muted' }
      if (paused) return { icon: '⏸', label: 'waiting its turn', cls: 'border-line bg-ink/40 text-muted' }
      return { icon: '📤', label: 'uploading', cls: 'border-stage-producing/50 bg-stage-producing/10 text-stage-producing' }
    }
    if (verify && (verify.missingCount === 0 || accepted)) return { icon: '✅', label: 'safe in the vault', cls: 'border-stage-done/50 bg-stage-done/10 text-stage-done' }
    if (driveMissing) return { icon: '🔌', label: 'drive disconnected', cls: 'border-stage-tracking/50 bg-stage-tracking/10 text-stage-tracking' }
    if (healGaveUp) return { icon: '🟡', label: 'needs your OK', cls: 'border-stage-tracking/50 bg-stage-tracking/10 text-stage-tracking' }
    return { icon: '🔄', label: 'double-checking', cls: 'border-line bg-ink/40 text-muted' }
  })()

  return (
    <div className="py-2">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <span className="text-sm font-semibold shrink-0">{status.icon} {t.name}</span>
        <span className={`${chipBase} ${status.cls} shrink-0`}>{status.label}</span>
        <span className="ml-auto min-w-0 truncate text-right text-xs text-muted tabular-nums">
          {t.bytesDone && t.bytesTotal ? `${t.bytesDone} of ${t.bytesTotal}` : ''}
          {!done && !paused && t.speed ? ` · ${t.speed}` : ''}
          {!done && !paused && t.eta ? ` · ETA ${t.eta}` : ''}
        </span>
        <span className="text-[10px] text-muted shrink-0">{open ? '▾' : '▸'}</span>
      </button>
      <div className="mt-1.5 h-2 rounded-full bg-ink/60 overflow-hidden">
        <div
          className={`h-full rounded-full ${done ? 'bg-stage-done' : 'bg-gradient-to-r from-stage-producing to-stage-mastering'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-line bg-ink/30 p-2.5 space-y-2 text-[11px]">
          {/* Plain-language state */}
          <div className="text-text/90">
            {done ? (
              verify ? (
                verify.missingCount === 0 ? (
                  <>✅ All {fmtCount(verify.filesExpected)} files confirmed in the vault (checked {fmtWhen(verify.runAt)}).</>
                ) : accepted ? (
                  <>✅ {fmtCount(verify.filesMatched)} files confirmed in the vault; you approved skipping {fmtCount(verify.missingCount)} (checked {fmtWhen(verify.runAt)}).</>
                ) : driveMissing ? (
                  <>
                    🔌 The NAS can't see this job's source drive (its log says "directory not found") — the drive is
                    unplugged or its dock is powered off. {fmtCount(verify.missingCount)} files are waiting on it; they are
                    safe on the drive itself. Plug it back in and Slate retries automatically every hour — nothing to
                    approve, nothing is lost.
                  </>
                ) : healGaveUp ? (
                  <>
                    This upload re-ran {heal!.maxAttempts}× by itself and still can't reach {fmtCount(verify.missingCount)} files —
                    they're outside the folders it was set up to copy. They are safe on their source. To upload them, the job's
                    folder scope on the NAS must be widened (ask Claude — it has the exact fix ready). Or, if they truly don't
                    need to be in the vault:
                  </>
                ) : (
                  <>
                    {fmtCount(verify.filesMatched)} of {fmtCount(verify.filesExpected)} files confirmed in the vault
                    {verify.tier2Matches > 0 ? ` (${fmtCount(verify.tier2Matches)} matched by name+size)` : ''}, {fmtCount(verify.missingCount)} still
                    to land — Slate re-runs this upload by itself{healRetrying ? ` (retry ${heal!.attempts} of ${heal!.maxAttempts})` : ''}.
                    Nothing is lost; the files are safe on their source.
                  </>
                )
              ) : (
                <>Finished — {t.filesTotal ? `${fmtCount(t.filesTotal)} files` : 'complete'}. Slate is double-checking every file against the vault; the result will appear here.</>
              )
            ) : stale ? (
              <>No update in {Math.round(ageMs / 60000)} min — the job may have just finished, or the reporter on the NAS stopped. Check Docker on RED if this persists.</>
            ) : paused ? (
              <>Held where it stopped ({t.filesDone != null && t.filesTotal != null ? `${fmtCount(t.filesDone)} of ${fmtCount(t.filesTotal)} files` : 'progress kept'}) — starts again by itself when its box frees up.</>
            ) : (
              <>{t.filesDone != null && t.filesTotal != null ? `${fmtCount(t.filesDone)} of ${fmtCount(t.filesTotal)} files · ` : ''}updated {Math.max(1, Math.round(ageMs / 1000))}s ago.</>
            )}
          </div>
          {healGaveUp && (
            <button
              onClick={() => { void acceptMissing() }}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel hover:bg-line/40 px-2.5 py-0.5 font-bold text-muted"
              title="Only choose this if these files genuinely don't need to be in the vault. It changes nothing on any drive or in Dropbox — it just stops this row from warning about them."
            >
              These files don't need uploading — approve skipping them
            </button>
          )}
          {/* Missing files / per-folder verdicts */}
          {(verify?.detail?.missing?.length ?? 0) > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted font-bold">Still to land{(verify!.missingCount > verify!.detail!.missing!.length) ? ` (first ${verify!.detail!.missing!.length} of ${fmtCount(verify!.missingCount)})` : ''}:</div>
              {verify!.detail!.missing!.map((p, i) => (
                <div key={i} className="font-mono break-all text-text/80">{p}</div>
              ))}
            </div>
          )}
          {(verify?.detail?.targets?.length ?? 0) > 0 && (
            <div className="space-y-0.5">
              {verify!.detail!.targets!.map((tg) => (
                <div key={tg.target} className="flex items-center gap-2">
                  <span className={`shrink-0 font-bold ${tg.verdict.startsWith('VERIFIED') ? 'text-stage-done' : tg.verdict === 'in progress' ? 'text-stage-tracking' : 'text-muted'}`}>
                    {tg.verdict.startsWith('VERIFIED') ? '✅' : tg.verdict === 'in progress' ? '⏳' : '·'}
                  </span>
                  <span className="truncate min-w-0">{tg.target}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted">
                    {tg.files > 0 ? `${fmtCount(tg.matched)}/${fmtCount(tg.files)} files` : ''} · {tg.verdict}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Live file list while uploading */}
          {!done && !stale && !paused && (t.currentFiles?.length ?? 0) > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted font-bold">Now uploading:</div>
              {t.currentFiles!.map((f, i) => {
                const file = typeof f === 'string' ? { name: f, pct: null, speed: '', eta: '' } : f
                return (
                  <div key={i} className="flex items-center gap-2 text-muted">
                    <span className="truncate min-w-0">🎬 {file.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {file.pct != null ? `${file.pct}%` : 'starting…'}
                      {file.speed ? ` · ${file.speed}` : ''}
                      {file.eta ? ` · ${file.eta} left` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {/* Raw upload errors, if the log still holds them */}
          {t.errors > 0 && (t.errorLines?.length ?? 0) > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted font-bold">Upload errors seen (auto-retried; the vault check above is the final word):</div>
              {t.errorLines!.map((l, i) => (
                <div key={i} className="font-mono break-all text-urgent/80">{l}</div>
              ))}
            </div>
          )}
          {verifyError && <div className="text-urgent">Couldn't start a manual check ({verifyError}) — it runs by itself every 30 min anyway.</div>}
          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            {!done && !stale && !cmdPending && (
              <button
                onClick={() => { void sendCommand(paused ? 'resume' : 'pause') }}
                disabled={sending}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                  paused
                    ? 'border-stage-done/60 bg-stage-done/15 text-stage-done hover:bg-stage-done/30'
                    : 'border-stage-tracking/60 bg-stage-tracking/15 text-stage-tracking hover:bg-stage-tracking/30'
                }`}
                title={paused ? 'Start this job again — it resumes exactly where it stopped' : 'Stop this job cleanly — progress is kept, resume any time'}
              >
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
            )}
            {t.verifiable && (
              <button
                onClick={() => { void runVerify() }}
                disabled={verifying}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-panel hover:bg-line/40 px-2.5 py-0.5 font-bold text-muted disabled:opacity-50"
                title="Checks run by themselves every 30 minutes — this just runs one now. Changes nothing."
              >
                {verifying ? '⏳ checking every file…' : 'Check now'}
              </button>
            )}
            {(done || stale) && (
              <button
                onClick={() => { void onDismiss(t.name) }}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-panel hover:bg-line/40 px-2.5 py-0.5 font-bold text-muted"
                title="Hides this finished row from the dashboard. Deletes NOTHING — not from the drive, not from Dropbox, not from the vault. The row comes back on its own if the job ever runs again."
              >
                Hide row
              </button>
            )}
          </div>
        </div>
      )}
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

  const [autoQueue, setAutoQueue] = useState<boolean | null>(null)

  useEffect(() => {
    api.storageAutoQueue().then((r) => setAutoQueue(r.on)).catch(() => {})
  }, [])

  const toggleAutoQueue = useCallback(async () => {
    if (autoQueue === null) return
    const next = !autoQueue
    setAutoQueue(next)
    try {
      await api.storageSetAutoQueue(next)
    } catch {
      setAutoQueue(!next) // revert on failure
    }
  }, [autoQueue])

  const onDismiss = useCallback(async (name: string) => {
    await api.storageTransferDismiss(name)
    setTransfers((prev) => prev.filter((t) => t.name !== name))
  }, [])

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
        <div className="flex items-center gap-3 mb-1">
          <div className={labelCls}>Transfers — NAS → vault</div>
          {autoQueue !== null && (
            <button
              onClick={() => { void toggleAutoQueue() }}
              className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${
                autoQueue
                  ? 'border-stage-done/60 bg-stage-done/15 text-stage-done hover:bg-stage-done/30'
                  : 'border-line bg-panel text-muted hover:bg-line/40'
              }`}
              title={autoQueue
                ? 'When a box finishes everything it was doing, its next paused job starts by itself. Click to turn off (e.g. on editing days).'
                : 'Paused jobs stay paused until you press Resume yourself. Click to turn auto-queue back on.'}
            >
              {autoQueue ? '⚡ Auto-queue on' : '💤 Auto-queue off'}
            </button>
          )}
        </div>
        {transfers.length > 0 && (() => {
          const checked = transfers.filter((t) => t.verify)
          const clean = checked.filter((t) => {
            const m = t.verify!.missingCount
            return m === 0 || (t.heal?.acceptedMissing != null && m <= t.heal.acceptedMissing)
          })
          const toLand = checked.reduce((a, t) => {
            const m = t.verify!.missingCount
            return a + (t.heal?.acceptedMissing != null && m <= t.heal.acceptedMissing ? 0 : m)
          }, 0)
          const uploading = transfers.filter((t) => (t.percent ?? 0) < 100).length
          return (
            <div className="mb-2 rounded-lg border border-line bg-ink/30 p-2 text-[11px] text-muted">
              🛡 Checked file-by-file, re-uploaded automatically, never deleted without a verified vault copy.
              <span className="text-text/90 font-bold">
                {' '}{clean.length} of {checked.length} jobs safe in the vault
                {toLand > 0 ? ` · ${fmtCount(toLand)} files still to land` : ''}
                {uploading > 0 ? ` · ${uploading} uploading` : ''}.
              </span>
            </div>
          )
        })()}
        {transfers.length > 0 ? (
          <div className="divide-y divide-line/60">
            {transfers.map((t) => (
              <TransferRow key={t.name} t={t} onCommand={onCommand} onDismiss={onDismiss} />
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
