import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import {
  S3Client,
  ListObjectsV2Command,
  type _Object as S3Object,
} from '@aws-sdk/client-s3'
import { requireAdmin } from '../auth'
import { pool } from '../db'
import { logError, logInfo } from '../diag'

// Master Archive browser — read-only window into the S3 bucket that holds
// Straw Hut's Deep Archive vault (masters uploaded from the UGREEN NASes,
// mirroring the Dropbox folder structure: 1_PODCASTS / 2_CLIENTS / …).
//
// This router only ever LISTS the bucket. Uploads happen from the NAS via
// rclone; restores/deletes are deliberately not exposed yet (they arrive
// with the full storage feature — restore buttons, share links, the
// type-DELETE-to-confirm flow). The credentials here should be the
// archive-scoped IAM user (no delete permission), NOT the SES keys.
//
// Env:
//   ARCHIVE_BUCKET            default 'strawhut-master-archive'
//   ARCHIVE_REGION            default 'us-west-2'
//   ARCHIVE_ACCESS_KEY_ID     falls back to AWS_ACCESS_KEY_ID
//   ARCHIVE_SECRET_ACCESS_KEY falls back to AWS_SECRET_ACCESS_KEY

export const storageRouter = Router()
storageRouter.use(requireAdmin)

function bucketName(): string {
  return (process.env.ARCHIVE_BUCKET || 'strawhut-master-archive').trim()
}

function creds(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = (process.env.ARCHIVE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = (process.env.ARCHIVE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '').trim()
  if (!accessKeyId || !secretAccessKey) return null
  return { accessKeyId, secretAccessKey }
}

let client: S3Client | null = null
function s3(): S3Client | null {
  if (client) return client
  const c = creds()
  if (!c) return null
  client = new S3Client({
    region: (process.env.ARCHIVE_REGION || 'us-west-2').trim(),
    credentials: c,
  })
  return client
}

// Monthly $/GB by storage class (us-west-2 list prices, Sep 2026). Estimates
// for the dashboard only — the AWS bill is the source of truth.
const CLASS_RATE_PER_GB: Record<string, number> = {
  DEEP_ARCHIVE: 0.00099,
  GLACIER: 0.0036,
  GLACIER_IR: 0.004,
  STANDARD: 0.023,
  STANDARD_IA: 0.0125,
  INTELLIGENT_TIERING: 0.023,
}

type PrefixAgg = { prefix: string; objects: number; bytes: number }

type Summary = {
  bucket: string
  scannedAt: string
  truncated: boolean
  totals: { objects: number; bytes: number }
  byClass: Array<{ storageClass: string; objects: number; bytes: number; estMonthlyUsd: number }>
  estMonthlyUsd: number
  topLevel: PrefixAgg[]
  secondLevel: PrefixAgg[]
}

// Full-bucket scans are paginated LIST calls (1,000 objects each). Cache the
// aggregate so the page doesn't re-scan on every load; a scan of ~100k
// objects is ~100 requests (fractions of a cent, a few seconds).
const SUMMARY_TTL_MS = 5 * 60 * 1000
const MAX_PAGES = 3000 // safety cap: 3M objects per scan
let summaryCache: { at: number; data: Summary } | null = null
let summaryInFlight: Promise<Summary> | null = null

async function scanBucket(): Promise<Summary> {
  const c = s3()
  if (!c) throw new Error('archive_not_configured')
  const Bucket = bucketName()
  const totals = { objects: 0, bytes: 0 }
  const byClass = new Map<string, { objects: number; bytes: number }>()
  const top = new Map<string, PrefixAgg>()
  const second = new Map<string, PrefixAgg>()
  let ContinuationToken: string | undefined
  let pages = 0
  let truncated = false
  do {
    const out = await c.send(new ListObjectsV2Command({ Bucket, ContinuationToken, MaxKeys: 1000 }))
    for (const obj of out.Contents ?? []) {
      const key = obj.Key ?? ''
      const size = obj.Size ?? 0
      totals.objects += 1
      totals.bytes += size
      const cls = obj.StorageClass || 'STANDARD'
      const agg = byClass.get(cls) ?? { objects: 0, bytes: 0 }
      agg.objects += 1
      agg.bytes += size
      byClass.set(cls, agg)
      const parts = key.split('/')
      if (parts.length > 1) {
        const t = parts[0] + '/'
        const ta = top.get(t) ?? { prefix: t, objects: 0, bytes: 0 }
        ta.objects += 1
        ta.bytes += size
        top.set(t, ta)
        if (parts.length > 2) {
          const s2 = parts[0] + '/' + parts[1] + '/'
          const sa = second.get(s2) ?? { prefix: s2, objects: 0, bytes: 0 }
          sa.objects += 1
          sa.bytes += size
          second.set(s2, sa)
        }
      }
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined
    pages += 1
    if (pages >= MAX_PAGES && ContinuationToken) {
      truncated = true
      break
    }
  } while (ContinuationToken)

  let estMonthlyUsd = 0
  const byClassOut = [...byClass.entries()]
    .map(([storageClass, agg]) => {
      const rate = CLASS_RATE_PER_GB[storageClass] ?? CLASS_RATE_PER_GB.STANDARD
      const est = (agg.bytes / 1024 ** 3) * rate
      estMonthlyUsd += est
      return { storageClass, ...agg, estMonthlyUsd: Math.round(est * 100) / 100 }
    })
    .sort((a, b) => b.bytes - a.bytes)

  return {
    bucket: Bucket,
    scannedAt: new Date().toISOString(),
    truncated,
    totals,
    byClass: byClassOut,
    estMonthlyUsd: Math.round(estMonthlyUsd * 100) / 100,
    topLevel: [...top.values()].sort((a, b) => a.prefix.localeCompare(b.prefix)),
    secondLevel: [...second.values()].sort((a, b) => a.prefix.localeCompare(b.prefix)),
  }
}

storageRouter.get('/status', (_req, res) => {
  res.json({
    configured: Boolean(s3()),
    bucket: bucketName(),
    region: (process.env.ARCHIVE_REGION || 'us-west-2').trim(),
  })
})

storageRouter.get('/summary', async (req, res) => {
  if (!s3()) {
    res.status(200).json({ configured: false })
    return
  }
  const force = req.query.force === '1'
  try {
    if (!force && summaryCache && Date.now() - summaryCache.at < SUMMARY_TTL_MS) {
      res.json({ configured: true, summary: summaryCache.data, cached: true })
      return
    }
    if (!summaryInFlight) {
      summaryInFlight = scanBucket().finally(() => {
        summaryInFlight = null
      })
    }
    const data = await summaryInFlight
    summaryCache = { at: Date.now(), data }
    res.json({ configured: true, summary: data, cached: false })
  } catch (err) {
    logError('storage summary failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(502).json({ error: 'archive_scan_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

// One level of the tree: folders (CommonPrefixes) + files at this prefix.
storageRouter.get('/list', async (req, res) => {
  const c = s3()
  if (!c) {
    res.status(200).json({ configured: false, folders: [], files: [] })
    return
  }
  const rawPrefix = typeof req.query.prefix === 'string' ? req.query.prefix : ''
  // Normalize: no leading slash; a non-empty prefix always ends with '/'.
  const prefix = rawPrefix.replace(/^\/+/, '')
  if (prefix && !prefix.endsWith('/')) {
    res.status(400).json({ error: 'prefix_must_end_with_slash' })
    return
  }
  try {
    const folders: string[] = []
    const files: Array<{ key: string; name: string; size: number; storageClass: string; lastModified: string | null }> = []
    let ContinuationToken: string | undefined
    let pages = 0
    do {
      const out = await c.send(
        new ListObjectsV2Command({
          Bucket: bucketName(),
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken,
          MaxKeys: 1000,
        }),
      )
      for (const p of out.CommonPrefixes ?? []) {
        if (p.Prefix) folders.push(p.Prefix)
      }
      for (const obj of out.Contents ?? []) {
        const key = obj.Key ?? ''
        if (!key || key === prefix) continue
        files.push({
          key,
          name: key.slice(prefix.length),
          size: obj.Size ?? 0,
          storageClass: obj.StorageClass || 'STANDARD',
          lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
        })
      }
      ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined
      pages += 1
    } while (ContinuationToken && pages < 25) // 25k entries per level is plenty
    res.json({ configured: true, prefix, folders, files, truncated: Boolean(ContinuationToken) })
  } catch (err) {
    logError('storage list failed', {
      prefix,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(502).json({ error: 'archive_list_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

// ── Live transfer reports from the NAS ────────────────────────────────
// A tiny reporter container on the UGREEN tails each rclone job log every
// minute and POSTs the tail here (text/plain). We parse rclone's periodic
// stats block into progress/speed/ETA for the Storage page. Token-gated
// (STORAGE_REPORT_TOKEN) because the NAS can't hold a browser session —
// same pattern as INVOICING_SERVICE_TOKEN. Unset token = endpoint off.

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// rclone INFO stats, logged once a minute, look like:
//   Transferred:   208.293 GiB / 2.073 TiB, 10%, 245.5 MiB/s, ETA 2h13m
//   Transferred:          123 / 1136, 11%
function parseRcloneStats(raw: string) {
  const bytesRe = /Transferred:\s+([\d.]+\s*\w+i?B) \/ ([\d.]+\s*\w+i?B), (\d+)%(?:, ([\d.]+\s*\w+i?B\/s))?(?:, ETA (\S+))?/g
  const filesRe = /Transferred:\s+(\d+) \/ (\d+), \d+%/g
  const errorsRe = /Errors:\s+(\d+)/g
  let bytes: RegExpExecArray | null = null
  let files: RegExpExecArray | null = null
  let errors: RegExpExecArray | null = null
  for (let m = bytesRe.exec(raw); m; m = bytesRe.exec(raw)) bytes = m
  for (let m = filesRe.exec(raw); m; m = filesRe.exec(raw)) files = m
  for (let m = errorsRe.exec(raw); m; m = errorsRe.exec(raw)) errors = m
  return {
    bytesDone: bytes?.[1] ?? '',
    bytesTotal: bytes?.[2] ?? '',
    percent: bytes ? parseInt(bytes[3], 10) : null,
    speed: bytes?.[4] ?? '',
    eta: bytes?.[5] ?? '',
    filesDone: files ? parseInt(files[1], 10) : null,
    filesTotal: files ? parseInt(files[2], 10) : null,
    errors: errors ? parseInt(errors[1], 10) : 0,
  }
}

// Exported for index.ts — mounted BEFORE the admin-gated router, with
// express.text(), because the reporter authenticates by token, not session.
export async function handleTransferReport(req: Request, res: Response): Promise<void> {
  const expected = (process.env.STORAGE_REPORT_TOKEN || '').trim()
  const got = typeof req.headers['x-storage-token'] === 'string' ? (req.headers['x-storage-token'] as string).trim() : ''
  if (!expected || !got || !safeEqual(got, expected)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  if (!name) {
    res.status(400).json({ error: 'bad_name' })
    return
  }
  const raw = typeof req.body === 'string' ? req.body.slice(-8000) : ''
  const p = parseRcloneStats(raw)
  try {
    await pool.query(
      `INSERT INTO storage_transfer_reports (name, raw, bytes_done, bytes_total, percent, speed, eta, files_done, files_total, errors, reported_at, last_progress_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
       ON CONFLICT (name) DO UPDATE SET
         last_progress_at = CASE WHEN storage_transfer_reports.raw IS DISTINCT FROM EXCLUDED.raw
                                 THEN now() ELSE storage_transfer_reports.last_progress_at END,
         raw = EXCLUDED.raw, bytes_done = EXCLUDED.bytes_done, bytes_total = EXCLUDED.bytes_total,
         percent = EXCLUDED.percent, speed = EXCLUDED.speed, eta = EXCLUDED.eta,
         files_done = EXCLUDED.files_done, files_total = EXCLUDED.files_total,
         errors = EXCLUDED.errors, reported_at = now()`,
      [name, raw, p.bytesDone, p.bytesTotal, p.percent, p.speed, p.eta, p.filesDone, p.filesTotal, p.errors],
    )
    void maybeAutoQueue()
    res.json({ ok: true })
  } catch (err) {
    logError('transfer report failed', { name, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'store_failed' })
  }
}

// ── Pause / Resume commands ───────────────────────────────────────────
// The Storage page writes the desired action here; the archive-commander
// container on each NAS polls GET /api/storage/agent/commands (token-gated,
// registered public in index.ts like the transfer report), runs docker
// stop/start on the container mapped in that box's containers.map, and acks.
// A box only acts on transfer names in its own map, so RED and BLUE can
// share one command list safely.

storageRouter.post('/transfers/:name/command', async (req, res) => {
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  const wanted = req.body?.action
  const action = wanted === 'pause' ? 'stop' : wanted === 'resume' ? 'start' : null
  if (!name || !action) {
    res.status(400).json({ error: 'bad_request' })
    return
  }
  try {
    const known = await pool.query(`SELECT 1 FROM storage_transfer_reports WHERE name = $1`, [name])
    if (known.rowCount === 0) {
      res.status(404).json({ error: 'unknown_transfer' })
      return
    }
    await pool.query(
      `INSERT INTO storage_transfer_commands (name, action, requested_at, executed_at)
       VALUES ($1, $2, now(), NULL)
       ON CONFLICT (name) DO UPDATE SET action = EXCLUDED.action, requested_at = now(), executed_at = NULL`,
      [name, action],
    )
    res.json({ ok: true, action })
  } catch (err) {
    logError('transfer command failed', { name, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'command_failed' })
  }
})

function agentAuthorized(req: Request): boolean {
  const expected = (process.env.STORAGE_REPORT_TOKEN || '').trim()
  const got = typeof req.headers['x-storage-token'] === 'string' ? (req.headers['x-storage-token'] as string).trim() : ''
  return Boolean(expected && got && safeEqual(got, expected))
}

// Exported for index.ts — plain-text list of pending commands, one per line:
//   PODCASTS stop
export async function handleAgentCommands(req: Request, res: Response): Promise<void> {
  if (!agentAuthorized(req)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  try {
    const { rows } = await pool.query(
      `SELECT name, action FROM storage_transfer_commands WHERE executed_at IS NULL ORDER BY requested_at`,
    )
    // Trailing newline matters: the agent parses this with `while read`,
    // which drops a final line that isn't newline-terminated.
    res.type('text/plain').send(rows.map((r) => `${r.name} ${r.action}\n`).join(''))
  } catch (err) {
    logError('agent commands read failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).type('text/plain').send('')
  }
}

// Exported for index.ts — the NAS confirms it ran the command.
export async function handleAgentAck(req: Request, res: Response): Promise<void> {
  if (!agentAuthorized(req)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  try {
    await pool.query(`UPDATE storage_transfer_commands SET executed_at = now() WHERE name = $1 AND executed_at IS NULL`, [name])
    res.json({ ok: true })
  } catch (err) {
    logError('agent ack failed', { name, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'ack_failed' })
  }
}

// ── Auto-queue ─────────────────────────────────────────────────────────
// "If nothing is going and something is paused, start it." Runs on every
// transfer report (throttled to once a minute). A box is RED unless the
// transfer name carries the BLUE- prefix — the naming convention the
// migration jobs already follow. Safety rules:
//  • only acts on a box that is reporting (reporter alive) and fully idle
//  • never acts while any command on that box is pending or <15 min old
//  • never restarts a job whose own Pause was clicked within the last hour
//  • global on/off switch (storage_settings.auto_queue), default on
const boxOf = (name: string) => (name.startsWith('BLUE-') ? 'blue' : 'red')

async function autoQueueEnabled(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT value FROM storage_settings WHERE key = 'auto_queue'`)
  return (rows[0]?.value ?? 'on') === 'on'
}

let lastAutoQueueAt = 0
export async function maybeAutoQueue(): Promise<void> {
  if (Date.now() - lastAutoQueueAt < 60_000) return
  lastAutoQueueAt = Date.now()
  try {
    if (!(await autoQueueEnabled())) return
    const { rows } = await pool.query(
      `SELECT r.name, r.percent, r.reported_at, r.last_progress_at,
              c.action AS cmd_action, c.requested_at AS cmd_requested_at, c.executed_at AS cmd_executed_at
       FROM storage_transfer_reports r
       LEFT JOIN storage_transfer_commands c ON c.name = r.name
       WHERE r.name <> 'connection-test' AND r.name NOT ILIKE '%.check'`,
    )
    const now = Date.now()
    const age = (ts: unknown) => now - new Date(ts as string).getTime()
    const boxes = new Map<string, typeof rows>()
    for (const r of rows) {
      const b = boxOf(r.name as string)
      boxes.set(b, [...(boxes.get(b) ?? []), r])
    }
    for (const [box, all] of boxes) {
      const reporting = all.filter((r) => age(r.reported_at) < 5 * 60_000)
      if (reporting.length === 0) continue // box dark — reporter down, don't guess
      const isDone = (r: (typeof rows)[number]) => (r.percent as number | null ?? 0) >= 100
      // "Idle" means NO progress anywhere on the box for a full 30 minutes —
      // deliberately much stricter than the UI's 10-minute paused label.
      // (2026-09-10: with a 10-minute window a transient log lull on a
      // running job made RED look idle overnight and auto-queue started a
      // second job alongside it.)
      const running = reporting.some((r) => !isDone(r) && age(r.last_progress_at) < 30 * 60_000)
      if (running) continue
      if (all.some((r) => r.cmd_action && !r.cmd_executed_at)) continue // command in flight
      if (all.some((r) => r.cmd_requested_at && age(r.cmd_requested_at) < 15 * 60_000)) continue // recent human action
      const next = reporting
        .filter((r) => !isDone(r))
        // an explicit Pause clicked < 1h ago stays respected
        .filter((r) => !(r.cmd_action === 'stop' && r.cmd_executed_at && age(r.cmd_executed_at) < 60 * 60_000))
        .sort((a, b) => (a.name as string).localeCompare(b.name as string))[0]
      if (!next) continue
      await pool.query(
        `INSERT INTO storage_transfer_commands (name, action, requested_at, executed_at)
         VALUES ($1, 'start', now(), NULL)
         ON CONFLICT (name) DO UPDATE SET action = 'start', requested_at = now(), executed_at = NULL`,
        [next.name],
      )
      logInfo('storage auto-queue: box idle, starting next paused job', {
        box,
        starting: next.name,
        boxState: all.map((r) => ({
          name: r.name,
          percent: r.percent,
          reportAgeSec: Math.round(age(r.reported_at) / 1000),
          progressAgeSec: Math.round(age(r.last_progress_at) / 1000),
        })),
      })
    }
  } catch (err) {
    logError('storage auto-queue failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

storageRouter.get('/auto-queue', async (_req, res) => {
  try {
    res.json({ on: await autoQueueEnabled() })
  } catch (err) {
    res.status(500).json({ error: 'settings_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

storageRouter.post('/auto-queue', async (req, res) => {
  const on = req.body?.on
  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'bad_request' })
    return
  }
  try {
    await pool.query(
      `INSERT INTO storage_settings (key, value) VALUES ('auto_queue', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [on ? 'on' : 'off'],
    )
    res.json({ ok: true, on })
  } catch (err) {
    res.status(500).json({ error: 'settings_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

// Manual clear for a finished/stale row. Hidden as of now; any NEW progress
// on the same name (e.g. the drive comes back next month) re-surfaces it.
storageRouter.post('/transfers/:name/dismiss', async (req, res) => {
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  if (!name) {
    res.status(400).json({ error: 'bad_name' })
    return
  }
  try {
    await pool.query(
      `INSERT INTO storage_transfer_dismissals (name, dismissed_at) VALUES ($1, now())
       ON CONFLICT (name) DO UPDATE SET dismissed_at = now()`,
      [name],
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'dismiss_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

storageRouter.get('/transfers', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.name, r.raw, r.bytes_done, r.bytes_total, r.percent, r.speed, r.eta, r.files_done, r.files_total,
              r.errors, r.reported_at, r.last_progress_at,
              c.action AS cmd_action, c.requested_at AS cmd_requested_at, c.executed_at AS cmd_executed_at
       FROM storage_transfer_reports r
       LEFT JOIN storage_transfer_commands c ON c.name = r.name
       LEFT JOIN storage_transfer_dismissals d ON d.name = r.name
       WHERE r.name <> 'connection-test'
         -- verification diaries (rclone check logs) are audits, not transfers:
         -- they'd render as bogus paused rows with Resume buttons that map to
         -- no container. Their verdicts are reported by Claude, not this card.
         AND r.name NOT ILIKE '%.check'
         -- finished rows linger a week as a receipt, then clear themselves
         AND NOT (COALESCE(r.percent, 0) >= 100 AND r.last_progress_at < now() - interval '7 days')
         -- manually cleared rows stay hidden until they show NEW progress
         AND (d.dismissed_at IS NULL OR r.last_progress_at > d.dismissed_at)
       ORDER BY r.reported_at DESC`,
    )
    res.json({
      transfers: rows.map((r) => ({
        name: r.name as string,
        bytesDone: r.bytes_done as string,
        bytesTotal: r.bytes_total as string,
        percent: r.percent as number | null,
        speed: r.speed as string,
        eta: r.eta as string,
        filesDone: r.files_done as number | null,
        filesTotal: r.files_total as number | null,
        errors: (r.errors as number | null) ?? 0,
        lastProgressAt: (r.last_progress_at as string | null) ?? (r.reported_at as string),
        // Files rclone reports as in-flight in the latest stats block, e.g.
        //  * Episodes/Ep041_…/Cut 2.mp4: 43% /1.19Gi, 8.145Mi/s, 3m9s
        currentFiles: [...(r.raw as string).matchAll(/^\s*\*\s+(.+?):\s*(?:(\d+)% \/[\d.]+\w*,\s*([\d.]+\s*\w+\/s),\s*(\S+)|transferring)/gm)]
          .map((m) => ({
            name: (m[1] || '').split('/').pop() || '',
            pct: m[2] != null ? parseInt(m[2], 10) : null,
            speed: m[3] || '',
            eta: m[4] || '',
          }))
          .filter((f) => f.name)
          .filter((f, i, arr) => arr.findIndex((o) => o.name === f.name) === i)
          .slice(-8),
        reportedAt: r.reported_at as string,
        command: r.cmd_action
          ? {
              action: r.cmd_action as 'stop' | 'start',
              requestedAt: r.cmd_requested_at as string,
              executedAt: (r.cmd_executed_at as string | null) ?? null,
            }
          : null,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: 'transfers_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})
