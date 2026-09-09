import { Router } from 'express'
import {
  S3Client,
  ListObjectsV2Command,
  type _Object as S3Object,
} from '@aws-sdk/client-s3'
import { requireAdmin } from '../auth'
import { logError } from '../diag'

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
