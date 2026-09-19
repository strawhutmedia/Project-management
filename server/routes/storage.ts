import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
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
  // Parse over the full posted tail (up to the 64kb route limit) so a chatty
  // log can't push the stats block out of the parse window; store a shorter
  // slice for the currentFiles dropdown.
  const fullRaw = typeof req.body === 'string' ? req.body : ''
  const raw = fullRaw.slice(-8000)
  const p = parseRcloneStats(fullRaw)
  try {
    await pool.query(
      `INSERT INTO storage_transfer_reports (name, raw, bytes_done, bytes_total, percent, speed, eta, files_done, files_total, errors, reported_at, last_progress_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
       ON CONFLICT (name) DO UPDATE SET
         last_progress_at = CASE WHEN storage_transfer_reports.raw IS DISTINCT FROM EXCLUDED.raw
                                 THEN now() ELSE storage_transfer_reports.last_progress_at END,
         raw = EXCLUDED.raw,
         -- A log tail with no stats block (a burst of per-file notices can
         -- push it out of the window) must NOT blank a live row: keep the
         -- last known numbers until a real stats block comes around again.
         bytes_done  = COALESCE(NULLIF(EXCLUDED.bytes_done, ''), storage_transfer_reports.bytes_done),
         bytes_total = COALESCE(NULLIF(EXCLUDED.bytes_total, ''), storage_transfer_reports.bytes_total),
         percent     = COALESCE(EXCLUDED.percent, storage_transfer_reports.percent),
         speed       = COALESCE(NULLIF(EXCLUDED.speed, ''), storage_transfer_reports.speed),
         eta         = COALESCE(NULLIF(EXCLUDED.eta, ''), storage_transfer_reports.eta),
         files_done  = COALESCE(EXCLUDED.files_done, storage_transfer_reports.files_done),
         files_total = COALESCE(EXCLUDED.files_total, storage_transfer_reports.files_total),
         errors      = GREATEST(EXCLUDED.errors, 0),
         reported_at = now()`,
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

// ── Vault verification (the "Verify against vault" button) ─────────────
// Compares what SHOULD be in the vault — a drive's census file in
// _INVENTORY/, or the wave-1 Dropbox target list against the team census —
// file-by-file with what IS in the vault, entirely server-side using the
// archive read keys this service already holds. Exists so nobody ever has
// to run rclone check or paste anything in a terminal: the button answers
// "did every file land?" and names any that didn't. Matching/mapping logic
// mirrors tools/archive/ledger2.mjs + wave1-verify.mjs — keep them in sync.

// Junk that the uploads deliberately exclude (and OS noise on raw drives):
// never count these as "expected in the vault". `._*` = macOS AppleDouble
// resource-fork stubs (2026-09-18: a 4 KB `._Icon<CR>` was the only thing
// holding the 636 GiB Old Dbox folder back from deletion); .dropbox.device
// is Dropbox's own 56-byte device marker.
const VERIFY_SKIP_RE = /(^|\/)(\.DS_Store|Thumbs\.db|\.dropbox\.device|\._[^/]*)$|(^|\/)(\$RECYCLE\.BIN|System Volume Information|#recycle)\//

// Drive rows with a census listing in _INVENTORY/. mapPath turns a path as
// it appears in the census into the vault key the upload wrote it to.
const DRIVE_CENSUS: Record<string, { census: string; mapPath: (rel: string) => string }> = {
  RHINO: {
    census: '_INVENTORY/inventory-RHINO.txt',
    mapPath: (p) => (p.startsWith('1_PODCASTS/') ? p : '1_PODCASTS/Henri G/' + p),
  },
  RECOVERY: {
    census: '_INVENTORY/inventory-RECOVERY.txt',
    mapPath: (p) => '1_PODCASTS/' + p,
  },
}

// The wave-1 Dropbox folders (same list as tools/archive/wave1-verify.mjs).
const WAVE1_TARGETS = [
  '1_PODCASTS/Hollywood Horror Stories', '1_PODCASTS/The Inside Track',
  '2_CLIENTS/Brandi Glanville', '1_PODCASTS/Poopies', '1_PODCASTS/Murder Room',
  "1_PODCASTS/It's a Racquet", '5_MARKETING/Website', '5_MARKETING/PurchasedMaterials',
  '5_MARKETING/Decks & Marketing', '5_MARKETING/Straw Hut Podcast Newsletter',
  '1_PODCASTS/History. Rated R.', '1_PODCASTS/Virgo Sisters',
  '1_PODCASTS/Salt and Flickers', '1_PODCASTS/HeartBreakers',
  '5_MARKETING/Straw Hut Ads', '3_COURSES/Podcast Primer Pro',
  '2_CLIENTS/Rainbow Media', '4_SOCIAL/HeartBreakers',
  'Ryan Tillotson/You Are U', 'Ryan Tillotson/Indy Automous challenge podcast',
  'Ryan Tillotson/Ryan Personal Photos', 'Ryan Tillotson/Straw Hut General’s files',
  "Ryan Tillotson/Don't Be Alone with Jay Kogen (1)", "Ryan Tillotson/Don't Be Alone with Jay Kogen (2)",
  "Ryan Tillotson/Don't Be Alone with Jay Kogen (3)", 'Ryan Tillotson/Camera Uploads (1)',
  'Ryan Tillotson/Videos', 'Ryan Tillotson/Shaping Freedom Podcast',
  'Ryan Tillotson/Apps', 'Ryan Tillotson/Old Dbox',
]

// NAS-box upload rows (RED = bare name, BLUE- prefix): verified against that
// box's census listing, filtered to the roots this row uploads (same root
// mapping as ledger2.mjs).
const BOX_ROWS: Record<string, { census: string; roots: string[]; vaultRoot: string }> = {
  PODCASTS: { census: '_INVENTORY/inventory-RED.txt', roots: ['PODCASTS', 'Podcast'], vaultRoot: '1_PODCASTS' },
  CLIENTS: { census: '_INVENTORY/inventory-RED.txt', roots: ['CLIENTS'], vaultRoot: '2_CLIENTS' },
  'BLUE-PODCASTS': { census: '_INVENTORY/inventory-BLUE.txt', roots: ['PODCASTS', 'Podcast'], vaultRoot: '1_PODCASTS' },
  'BLUE-CLIENTS': { census: '_INVENTORY/inventory-BLUE.txt', roots: ['CLIENTS'], vaultRoot: '2_CLIENTS' },
}

const VERIFIABLE = new Set([...Object.keys(DRIVE_CENSUS), ...Object.keys(BOX_ROWS), 'HENRI', 'DROPBOX-WAVE1'])

// Full vault listing as a lookup index (~70k objects ≈ 70 LIST calls, a few
// seconds). Cached briefly so back-to-back verifies don't re-scan.
type VaultIndex = { byPath: Map<string, number>; byNameSize: Set<string> }
const VAULT_INDEX_TTL_MS = 5 * 60 * 1000
let vaultIndexCache: { at: number; data: VaultIndex } | null = null
let vaultIndexInFlight: Promise<VaultIndex> | null = null

async function vaultIndex(): Promise<VaultIndex> {
  if (vaultIndexCache && Date.now() - vaultIndexCache.at < VAULT_INDEX_TTL_MS) return vaultIndexCache.data
  if (!vaultIndexInFlight) {
    vaultIndexInFlight = (async () => {
      const c = s3()
      if (!c) throw new Error('archive_not_configured')
      const Bucket = bucketName()
      const byPath = new Map<string, number>()
      const byNameSize = new Set<string>()
      let ContinuationToken: string | undefined
      let pages = 0
      do {
        const out = await c.send(new ListObjectsV2Command({ Bucket, ContinuationToken, MaxKeys: 1000 }))
        for (const obj of out.Contents ?? []) {
          const key = obj.Key ?? ''
          if (!key || key.startsWith('_INVENTORY/')) continue
          const size = obj.Size ?? 0
          byPath.set(key, size)
          byNameSize.add((key.split('/').pop() || '') + '|' + size)
        }
        ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined
        pages += 1
      } while (ContinuationToken && pages < MAX_PAGES)
      const data = { byPath, byNameSize }
      vaultIndexCache = { at: Date.now(), data }
      return data
    })().finally(() => {
      vaultIndexInFlight = null
    })
  }
  return vaultIndexInFlight
}

async function fetchInventory(key: string): Promise<string> {
  const c = s3()
  if (!c) throw new Error('archive_not_configured')
  const out = await c.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }))
  const body = out.Body as { transformToString(enc: string): Promise<string> } | undefined
  if (!body) throw new Error('census_empty')
  return body.transformToString('utf8')
}

type VerifyResult = {
  verdict: 'VERIFIED' | 'INCOMPLETE'
  filesExpected: number
  filesMatched: number
  tier2Matches: number
  missingCount: number
  detail: Record<string, unknown> | null
}

// A drive (RHINO/RECOVERY): every census file must be in the vault at the
// mapped path with the same size (tier 1), or anywhere by basename+size
// (tier 2 — same rule Ryan approved for deletions).
async function verifyDrive(name: string): Promise<VerifyResult> {
  const src = DRIVE_CENSUS[name]
  const [census, vault] = await Promise.all([fetchInventory(src.census), vaultIndex()])
  let expected = 0
  let matched = 0
  let tier2 = 0
  const missing: string[] = []
  for (const line of census.split('\n')) {
    const m = line.match(/^(\d+) (.+)$/)
    if (!m) continue
    const rel = m[2].replace(/^\.\//, '')
    if (VERIFY_SKIP_RE.test(rel)) continue
    const size = +m[1]
    expected += 1
    if (vault.byPath.get(src.mapPath(rel)) === size) matched += 1
    else if (vault.byNameSize.has((rel.split('/').pop() || '') + '|' + size)) {
      matched += 1
      tier2 += 1
    } else if (missing.length < 20) missing.push(`${src.mapPath(rel)} (${size} B)`)
  }
  const missingCount = expected - matched
  return {
    verdict: missingCount === 0 ? 'VERIFIED' : 'INCOMPLETE',
    filesExpected: expected,
    filesMatched: matched,
    tier2Matches: tier2,
    missingCount,
    detail: missingCount ? { missing } : null,
  }
}

// A NAS-box upload row (PODCASTS / CLIENTS / BLUE-*): every file the box's
// census lists under this row's roots must be in the vault at the mapped
// path+size (tier 1) or anywhere by basename+size (tier 2).
async function verifyBox(name: string): Promise<VerifyResult> {
  const src = BOX_ROWS[name]
  const [census, vault] = await Promise.all([fetchInventory(src.census), vaultIndex()])
  let expected = 0
  let matched = 0
  let tier2 = 0
  const missing: string[] = []
  for (const line of census.split('\n')) {
    const m = line.match(/^(\d+) (.+)$/)
    if (!m) continue
    const parts = m[2].split('/')
    if (!src.roots.includes(parts[0]) || parts.length < 2) continue
    const rel = parts.slice(1).join('/')
    if (VERIFY_SKIP_RE.test(rel)) continue
    const size = +m[1]
    const key = src.vaultRoot + '/' + rel
    expected += 1
    if (vault.byPath.get(key) === size) matched += 1
    else if (vault.byNameSize.has((rel.split('/').pop() || '') + '|' + size)) {
      matched += 1
      tier2 += 1
    } else if (missing.length < 20) missing.push(`${key} (${size} B)`)
  }
  const missingCount = expected - matched
  return {
    verdict: missingCount === 0 ? 'VERIFIED' : 'INCOMPLETE',
    filesExpected: expected,
    filesMatched: matched,
    tier2Matches: tier2,
    missingCount,
    detail: missingCount ? { missing } : null,
  }
}

// HENRI (the Henri Recordings top-up): coverage of the whole Henri
// Recordings Dropbox folder from the team census, matched tier 1 by
// normalized path or tier 2 by basename+size anywhere in the vault (the
// wave-2 rule — RHINO landed the same content under 1_PODCASTS/Henri G/).
async function verifyHenri(): Promise<VerifyResult> {
  const [censusCsv, vault] = await Promise.all([
    fetchInventory('_INVENTORY/inventory-DROPBOX-TEAM.csv'),
    vaultIndex(),
  ])
  let expected = 0
  let matched = 0
  let tier2 = 0
  const missing: string[] = []
  for (const line of censusCsv.split('\n')) {
    if (!line.trim()) continue
    const i = line.indexOf(';')
    if (i < 1) continue
    const j = line.indexOf(';', i + 1)
    if (j < 0) continue
    const size = +line.slice(0, i)
    let p = line.slice(j + 1)
    if (!Number.isFinite(size)) continue
    if (p.startsWith('Straw Hut Team Folder/')) p = p.slice('Straw Hut Team Folder/'.length)
    if (VERIFY_SKIP_RE.test(p)) continue
    if (!p.split('/').some((seg) => /^henri recordings$/i.test(seg))) continue
    expected += 1
    if (vault.byPath.get(p) === size) matched += 1
    else if (vault.byNameSize.has((p.split('/').pop() || '') + '|' + size)) {
      matched += 1
      tier2 += 1
    } else if (missing.length < 20) missing.push(`${p} (${size} B)`)
  }
  if (expected === 0) throw new Error('no census entries for Henri Recordings — regenerate the team census')
  const missingCount = expected - matched
  return {
    verdict: missingCount === 0 ? 'VERIFIED' : 'INCOMPLETE',
    filesExpected: expected,
    filesMatched: matched,
    tier2Matches: tier2,
    missingCount,
    detail: missingCount ? { missing } : null,
  }
}

// Wave 1: per target folder, every Dropbox file (from the team census) must
// be in the vault at the exact normalized path with the same size — the
// strict tier-1-only rule the deletion loop uses.
async function verifyWave1(): Promise<VerifyResult> {
  const [censusCsv, vault] = await Promise.all([
    fetchInventory('_INVENTORY/inventory-DROPBOX-TEAM.csv'),
    vaultIndex(),
  ])
  const want = new Map<string, Array<{ p: string; size: number }>>(WAVE1_TARGETS.map((t) => [t, []]))
  for (const line of censusCsv.split('\n')) {
    if (!line.trim()) continue
    const i = line.indexOf(';')
    if (i < 1) continue
    const j = line.indexOf(';', i + 1)
    if (j < 0) continue
    const size = +line.slice(0, i)
    let p = line.slice(j + 1)
    if (!Number.isFinite(size)) continue
    if (p.startsWith('Straw Hut Team Folder/')) p = p.slice('Straw Hut Team Folder/'.length)
    if (VERIFY_SKIP_RE.test(p)) continue
    const tgt = WAVE1_TARGETS.find((x) => p.startsWith(x + '/'))
    if (tgt) want.get(tgt)!.push({ p, size })
  }
  const targets = WAVE1_TARGETS.map((tgt) => {
    const files = want.get(tgt)!
    if (files.length === 0) return { target: tgt, files: 0, matched: 0, verdict: 'no census entries — already deleted?', missing: [] as string[] }
    let matched = 0
    const missing: string[] = []
    for (const { p, size } of files) {
      if (vault.byPath.get(p) === size) matched += 1
      else if (missing.length < 3) missing.push(p)
    }
    const verdict = matched === files.length ? 'VERIFIED — DELETABLE' : matched === 0 ? 'not started' : 'in progress'
    return { target: tgt, files: files.length, matched, verdict, missing }
  })
  const expected = targets.reduce((a, t) => a + t.files, 0)
  const matched = targets.reduce((a, t) => a + t.matched, 0)
  return {
    verdict: targets.every((t) => t.files === 0 || t.verdict === 'VERIFIED — DELETABLE') ? 'VERIFIED' : 'INCOMPLETE',
    filesExpected: expected,
    filesMatched: matched,
    tier2Matches: 0,
    missingCount: expected - matched,
    detail: { targets },
  }
}

async function runAndRecordVerify(name: string): Promise<VerifyResult & { name: string; runAt: string }> {
  const started = Date.now()
  const r =
    name === 'DROPBOX-WAVE1' ? await verifyWave1()
    : name === 'HENRI' ? await verifyHenri()
    : BOX_ROWS[name] ? await verifyBox(name)
    : await verifyDrive(name)
  const { rows } = await pool.query(
    `INSERT INTO storage_verify_runs (name, verdict, files_expected, files_matched, tier2_matches, missing_count, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING run_at`,
    [name, r.verdict, r.filesExpected, r.filesMatched, r.tier2Matches, r.missingCount, r.detail ? JSON.stringify(r.detail) : null],
  )
  logInfo('storage verify', {
    name,
    verdict: r.verdict,
    expected: r.filesExpected,
    matched: r.filesMatched,
    missing: r.missingCount,
    tookMs: Date.now() - started,
  })
  return { name, runAt: rows[0].run_at as string, ...r }
}

// The button only KICKS OFF a verify and returns immediately — holding the
// HTTP request open for a ~70k-object vault scan meant a redeploy or a phone
// losing signal showed "Load failed" even though the check finished fine
// server-side (2026-09-18, Ryan's screenshot). The verdict lands on the row
// via the normal 30s poll.
const verifyInFlight = new Set<string>()

async function runVerifyGuarded(name: string): Promise<void> {
  if (verifyInFlight.has(name)) return
  verifyInFlight.add(name)
  try {
    await runAndRecordVerify(name)
    await publishVerifySnapshot()
    await maybeHeal(name)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logError('storage verify failed', {
      name,
      error: /NoSuchKey/i.test(detail) ? 'census file not found in _INVENTORY — regenerate it on the NAS first' : detail,
    })
  } finally {
    verifyInFlight.delete(name)
  }
}

// ── Auto-heal (Ryan, 2026-09-18: "it should be corrected immediately by
// you and keep trying to upload until everything is there") ──────────────
// A verify that finds missing files on a FINISHED, healable job re-issues
// that job's start command itself — the exact mechanism behind the Resume
// button, so the NAS re-runs the same rclone container, which skips
// everything already uploaded (--ignore-existing) and sends only strays.
// `attempts` counts consecutive re-runs that did NOT shrink the missing
// count; after 3 the server stops retrying and the row asks Ryan to widen
// the job's folder scope on the NAS or approve skipping the listed files.
const HEAL_MAX_NO_PROGRESS = 3
// DROPBOX-WAVE1 included: once the wave's script has completed (percent 100)
// with stragglers left (e.g. one HeartBreakers .braw), a re-run walks the
// whole target list with --ignore-existing and picks up only what's missing.
const HEALABLE = new Set([...Object.keys(DRIVE_CENSUS), ...Object.keys(BOX_ROWS), 'HENRI', 'DROPBOX-WAVE1'])

async function maybeHeal(name: string): Promise<void> {
  if (!HEALABLE.has(name)) return
  try {
    const { rows } = await pool.query(
      `SELECT v.missing_count, r.percent, r.raw,
              c.action AS cmd_action, c.executed_at AS cmd_executed_at,
              h.attempts, h.last_missing, h.accepted_missing, h.updated_at AS heal_updated_at
       FROM storage_transfer_reports r
       LEFT JOIN LATERAL (
         SELECT missing_count FROM storage_verify_runs WHERE name = r.name ORDER BY run_at DESC LIMIT 1
       ) v ON true
       LEFT JOIN storage_transfer_commands c ON c.name = r.name
       LEFT JOIN storage_heal_state h ON h.name = r.name
       WHERE r.name = $1`,
      [name],
    )
    const r = rows[0]
    if (!r || r.missing_count == null) return
    const missing = r.missing_count as number
    if (missing === 0) {
      // fully landed — clear retry bookkeeping (keep an acceptance if one exists)
      await pool.query(`DELETE FROM storage_heal_state WHERE name = $1 AND accepted_missing IS NULL`, [name])
      return
    }
    if (r.accepted_missing != null && missing <= (r.accepted_missing as number)) return // Ryan approved skipping these
    if (((r.percent as number | null) ?? 0) < 100) return // job is already running again
    if (r.cmd_action && !r.cmd_executed_at) return // a command is already pending on the NAS
    const attempts = (r.attempts as number | null) ?? 0
    const lastMissing = r.last_missing as number | null
    const progressed = lastMissing == null || missing < lastMissing
    // rclone saying "directory not found" for its source root = the job's
    // drive is unplugged (2026-09-18: RHINO/RECOVERY's dock was off; the jobs
    // no-op'd instantly and burned their retries). That's physical, so the
    // attempts cap doesn't apply — instead poke the job at most hourly so it
    // resumes by itself the moment the drive is plugged back in.
    const driveMissing = /error reading source root|directory not found/i.test((r.raw as string) ?? '')
    if (driveMissing) {
      const lastHealAt = r.heal_updated_at ? new Date(r.heal_updated_at as string).getTime() : 0
      if (Date.now() - lastHealAt < 60 * 60_000) return
    } else if (!progressed && attempts >= HEAL_MAX_NO_PROGRESS) {
      return // gave up — the row asks Ryan
    }
    await pool.query(
      `INSERT INTO storage_transfer_commands (name, action, requested_at, executed_at)
       VALUES ($1, 'start', now(), NULL)
       ON CONFLICT (name) DO UPDATE SET action = 'start', requested_at = now(), executed_at = NULL`,
      [name],
    )
    const nextAttempts = driveMissing ? attempts : progressed ? 1 : attempts + 1
    await pool.query(
      `INSERT INTO storage_heal_state (name, attempts, last_missing, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (name) DO UPDATE SET attempts = $2, last_missing = $3, updated_at = now()`,
      [name, nextAttempts, missing],
    )
    logInfo('storage auto-heal: re-running upload to pick up missing files', {
      name,
      missing,
      attempt: nextAttempts,
      maxWithoutProgress: HEAL_MAX_NO_PROGRESS,
    })
  } catch (err) {
    logError('storage auto-heal failed', { name, error: err instanceof Error ? err.message : String(err) })
  }
}

// Ryan's explicit approval that the currently missing files don't need to
// be uploaded. Affects reporting only — deletes nothing, uploads nothing.
storageRouter.post('/transfers/:name/accept-missing', async (req, res) => {
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  if (!VERIFIABLE.has(name)) {
    res.status(400).json({ error: 'verify_not_supported' })
    return
  }
  try {
    const { rows } = await pool.query(
      `SELECT missing_count FROM storage_verify_runs WHERE name = $1 ORDER BY run_at DESC LIMIT 1`,
      [name],
    )
    const missing = rows[0]?.missing_count as number | undefined
    if (missing == null || missing === 0) {
      res.status(400).json({ error: 'nothing_to_accept' })
      return
    }
    await pool.query(
      `INSERT INTO storage_heal_state (name, attempts, last_missing, accepted_missing, accepted_at, updated_at)
       VALUES ($1, 0, $2, $2, now(), now())
       ON CONFLICT (name) DO UPDATE SET accepted_missing = $2, accepted_at = now(), updated_at = now()`,
      [name, missing],
    )
    logInfo('storage verify: admin approved skipping missing files', { name, missing })
    res.json({ ok: true, accepted: missing })
  } catch (err) {
    logError('storage accept-missing failed', { name, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'accept_failed' })
  }
})

storageRouter.post('/transfers/:name/verify', (req, res) => {
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  if (!VERIFIABLE.has(name)) {
    res.status(400).json({ error: 'verify_not_supported' })
    return
  }
  const already = verifyInFlight.has(name)
  if (!already) void runVerifyGuarded(name)
  res.json({ ok: true, started: true, already })
})

// ── Auto-verify ────────────────────────────────────────────────────────
// Nobody should have to click Verify either (Ryan, 2026-09-18: "you're the
// one verifying — so do it"). A background sweep verifies each finished
// drive once (and again only if it reports new progress), and re-checks the
// wave-1 folders every few hours while the wave uploads. Results land in
// storage_verify_runs (same as the button) and are mirrored to the status
// branch as storage-verify.json so cloud Claude sessions can read verdicts
// without any credentials from Ryan.
const WAVE1_REVERIFY_MS = 6 * 60 * 60 * 1000

async function publishVerifySnapshot(): Promise<void> {
  try {
    const { statusReportingEnabled, writeStatusFile } = await import('../github')
    if (!statusReportingEnabled()) return
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (name) name, run_at, verdict, files_expected, files_matched, tier2_matches, missing_count, detail
       FROM storage_verify_runs ORDER BY name, run_at DESC`,
    )
    await writeStatusFile(
      'storage-verify.json',
      JSON.stringify({ updatedAt: new Date().toISOString(), runs: rows }, null, 2),
      'status: storage verify snapshot',
    )
  } catch (err) {
    logError('storage verify snapshot publish failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

let autoVerifyRunning = false
export async function autoVerifySweep(): Promise<void> {
  if (autoVerifyRunning) return
  autoVerifyRunning = true
  try {
    if (!s3()) return
    const { rows } = await pool.query(
      `SELECT r.name, r.percent, r.last_progress_at, v.run_at
       FROM storage_transfer_reports r
       LEFT JOIN LATERAL (
         SELECT run_at FROM storage_verify_runs WHERE name = r.name ORDER BY run_at DESC LIMIT 1
       ) v ON true
       WHERE r.name = ANY($1)`,
      [[...VERIFIABLE]],
    )
    for (const r of rows) {
      const name = r.name as string
      const done = ((r.percent as number | null) ?? 0) >= 100
      const runAt = r.run_at ? new Date(r.run_at as string).getTime() : 0
      const progressAt = new Date(r.last_progress_at as string).getTime()
      const isWave = name === 'DROPBOX-WAVE1'
      // Drives: verify once finished; again only if the job reports new
      // progress after a run (a re-run picked up strays). Wave 1: re-check
      // as it progresses, at most every 6h (a full check reads the big team
      // census from S3 — no need to do that every sweep).
      if (!isWave && !done) continue
      // Wave 1 re-verifies on AGE alone: gating it on new job progress
      // deadlocked once the wave stopped reporting (verdict newer than the
      // last progress → never re-ran → a rules change like the junk filter
      // could never take effect). Found 2026-09-19 with the snapshot frozen
      // at the 21:00 run for 7+ hours.
      const current = isWave
        ? runAt > 0 && Date.now() - runAt < WAVE1_REVERIFY_MS
        : runAt > progressAt
      if (current) {
        // Verdict is current — no re-verify needed, but a current verdict
        // with missing files is exactly what auto-heal exists for.
        await maybeHeal(name)
        continue
      }
      await runVerifyGuarded(name)
    }
  } catch (err) {
    logError('storage auto-verify sweep failed', { error: err instanceof Error ? err.message : String(err) })
  } finally {
    autoVerifyRunning = false
  }
}

export function startStorageAutoVerify(): void {
  // First sweep shortly after boot (covers "just deployed, verify RHINO +
  // RECOVERY now"), then every 30 min; the sweep itself decides whether
  // anything actually needs (re-)verifying.
  setTimeout(() => { void autoVerifySweep() }, 60_000)
  setInterval(() => { void autoVerifySweep() }, 30 * 60_000)
}

storageRouter.get('/transfers', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.name, r.raw, r.bytes_done, r.bytes_total, r.percent, r.speed, r.eta, r.files_done, r.files_total,
              r.errors, r.reported_at, r.last_progress_at,
              c.action AS cmd_action, c.requested_at AS cmd_requested_at, c.executed_at AS cmd_executed_at,
              v.run_at AS verify_run_at, v.verdict AS verify_verdict, v.files_expected AS verify_expected,
              v.files_matched AS verify_matched, v.tier2_matches AS verify_tier2,
              v.missing_count AS verify_missing, v.detail AS verify_detail,
              h.attempts AS heal_attempts, h.accepted_missing AS heal_accepted, h.accepted_at AS heal_accepted_at
       FROM storage_transfer_reports r
       LEFT JOIN storage_transfer_commands c ON c.name = r.name
       LEFT JOIN storage_transfer_dismissals d ON d.name = r.name
       LEFT JOIN storage_heal_state h ON h.name = r.name
       LEFT JOIN LATERAL (
         SELECT run_at, verdict, files_expected, files_matched, tier2_matches, missing_count, detail
         FROM storage_verify_runs WHERE name = r.name ORDER BY run_at DESC LIMIT 1
       ) v ON true
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
        // Actual rclone ERROR lines still inside the stored log tail, so the
        // error badge can show WHAT failed, not just a count. Older errors
        // scroll out of the tail — the verify run is the authoritative check.
        errorLines: [...(r.raw as string).matchAll(/^.*\bERROR\b.*$/gm)]
          .map((m) => m[0].trim())
          .filter((l) => !/Errors:/.test(l))
          .slice(-5)
          .map((l) => (l.length > 220 ? l.slice(0, 220) + '…' : l)),
        verifiable: VERIFIABLE.has(r.name as string),
        verifying: verifyInFlight.has(r.name as string),
        heal:
          r.heal_attempts != null || r.heal_accepted != null
            ? {
                attempts: (r.heal_attempts as number | null) ?? 0,
                maxAttempts: HEAL_MAX_NO_PROGRESS,
                acceptedMissing: (r.heal_accepted as number | null) ?? null,
                acceptedAt: (r.heal_accepted_at as string | null) ?? null,
              }
            : null,
        verify: r.verify_run_at
          ? {
              runAt: r.verify_run_at as string,
              verdict: r.verify_verdict as string,
              filesExpected: r.verify_expected as number,
              filesMatched: r.verify_matched as number,
              tier2Matches: (r.verify_tier2 as number | null) ?? 0,
              missingCount: r.verify_missing as number,
              detail: (r.verify_detail as Record<string, unknown> | null) ?? null,
            }
          : null,
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
