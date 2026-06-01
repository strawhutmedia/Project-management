// OpusClip API client. Submits a video URL to /clip-projects and polls
// /exportable-clips for results. Mirrors the deepgram.ts shape so future
// changes (webhooks, brand templates, social posting) layer on cleanly.
//
// Docs: https://help.opus.pro/api-reference/overview
import { logError, logInfo } from './diag'

const OPUS_API = 'https://api.opus.pro/api'

export function hasOpusKey(): boolean {
  return Boolean(process.env.OPUSCLIP_API_KEY)
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.OPUSCLIP_API_KEY || ''}`,
    'Content-Type': 'application/json',
  }
}

export type OpusCreateResult = {
  projectId: string
  orgId: string | null
  raw: unknown
}

export type OpusCreateOptions = {
  // Plain-English direction to give their AI ("focus on funny moments
  // about parenting", "highlight Jay's interview answers", etc.). Sent
  // as `prompt` since that's the dominant naming across AI APIs.
  prompt?: string | null
  // Desired number of output clips, if their API honors a count hint.
  clipCount?: number | null
  // Target durations in seconds.
  minDuration?: number | null
  maxDuration?: number | null
}

// Caption-style directive baked into every clip job's prompt so
// OpusClip's AI knows the team wants a single visual style across
// every show: clean burned-in captions, white sans-serif on a
// translucent black pill, no animations, no emoji, one or two words
// per beat. This is sent on top of whatever moment-focused prompt
// the user provides.
const DEFAULT_CAPTION_STYLE = `
CAPTION STYLE — apply to EVERY clip:
- Single-line burned-in captions, white sans-serif text on a small,
  rounded, semi-transparent black background ("pill" style).
- Centered, slightly above the bottom of the frame.
- One or two words at a time, switching with the speaker's cadence.
- NO emoji, NO bouncing/zoom animations, NO color-changing letters,
  NO highlighted active words. Keep it clean and editorial — looks
  the same on every clip across every show in our network.
- Standard sentence case. No all-caps. No emoji.`

// POST /clip-projects — kicks off clip generation. Accepts public URLs
// (YouTube, Google Drive, Vimeo, S3, Dropbox temp links, etc.) so we
// hand it a Dropbox temporary link with no upload.
//
// Options are sent best-effort — OpusClip's API still doesn't document a
// stable param set publicly. Unknown fields should be ignored by their
// validator; we surface the raw response so admins can inspect what
// actually came back.
export async function createOpusProject(videoUrl: string, opts?: OpusCreateOptions): Promise<OpusCreateResult> {
  const body: Record<string, unknown> = { videoUrl }
  // Always prepend the caption style so the look is consistent across
  // every clip OpusClip produces for us, regardless of what the user
  // typed in the prompt field.
  const userPrompt = opts?.prompt && opts.prompt.trim() ? opts.prompt.trim().slice(0, 1000) : ''
  const fullPrompt = userPrompt
    ? `${userPrompt}\n${DEFAULT_CAPTION_STYLE}`
    : DEFAULT_CAPTION_STYLE.trim()
  body.prompt = fullPrompt
  if (opts?.clipCount != null) body.clipCount = opts.clipCount
  if (opts?.minDuration != null) body.minDuration = opts.minDuration
  if (opts?.maxDuration != null) body.maxDuration = opts.maxDuration

  const res = await fetch(`${OPUS_API}/clip-projects`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const body = await res.text()
    logError('opus.createProject failed', { status: res.status, body: body.slice(0, 500) })
    throw new Error(`opus_${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as Record<string, unknown> & {
    id?: string
    projectId?: string
    orgId?: string
    organizationId?: string
  }
  const projectId = String(data.id ?? data.projectId ?? '')
  const orgId = (data.orgId ?? data.organizationId ?? null) as string | null
  if (!projectId) {
    logError('opus.createProject: no projectId in response', { data })
    throw new Error('opus_no_project_id')
  }
  logInfo('opus: project created', { projectId, orgId, hasOrg: Boolean(orgId) })
  return { projectId, orgId, raw: data }
}

export type OpusClip = {
  id: string
  title: string | null
  durationSeconds: number | null
  previewUrl: string | null
  downloadUrl: string | null
  thumbnailUrl: string | null
  score: number | null
  raw: unknown
}

export type OpusFetchClipsResult = {
  ready: boolean
  clips: OpusClip[]
  raw: unknown
}

// GET /exportable-clips?q=findByProjectId&projectId=... → returns ready
// clips. While the project is still processing, this returns an empty
// list (or a status flag), so we treat "no clips yet" as "still
// processing" rather than failed.
export async function fetchOpusClips(projectId: string, orgId: string | null): Promise<OpusFetchClipsResult> {
  const headers: Record<string, string> = { ...authHeaders() }
  if (orgId) headers['x-opus-org-id'] = orgId
  const url = `${OPUS_API}/exportable-clips?q=findByProjectId&projectId=${encodeURIComponent(projectId)}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text()
    logError('opus.fetchClips failed', { status: res.status, body: body.slice(0, 500), projectId })
    throw new Error(`opus_${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as unknown
  // Normalize a few likely shapes — different OpusClip docs hint at
  // {clips: []} vs a top-level array vs {data: []}.
  let rawClips: unknown[] = []
  if (Array.isArray(data)) rawClips = data
  else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.clips)) rawClips = obj.clips as unknown[]
    else if (Array.isArray(obj.data)) rawClips = obj.data as unknown[]
    else if (Array.isArray(obj.exportableClips)) rawClips = obj.exportableClips as unknown[]
  }
  const clips: OpusClip[] = rawClips.map((c) => normalizeClip(c as Record<string, unknown>))
  return { ready: clips.length > 0, clips, raw: data }
}

// Tries a handful of likely "account" / "quota" / "credits" endpoints
// since OpusClip's docs don't pin down a single one. Returns the first
// 200 response with a JSON body, plus the path that worked so we can
// pin the integration later. Returns null if none respond.
export type OpusAccountInfo = {
  endpoint: string
  raw: unknown
  // Best-effort parsed values pulled from common field names. Any
  // can be null if the response shape doesn't match.
  creditsRemaining: number | null
  creditsTotal: number | null
  minutesRemaining: number | null
  minutesTotal: number | null
  planName: string | null
}

// Only the three most-likely patterns. With a 2s timeout each, the
// worst case is 6s — fast enough that a first-page-load doesn't 502
// even if every candidate fails. Successful or failed result is then
// cached for 5 minutes so subsequent calls are instant.
const ACCOUNT_PATH_CANDIDATES = [
  '/account',
  '/me',
  '/credits',
]

// In-memory cache so every ClipsSection mount doesn't fan out 10
// upstream requests. 5-minute TTL is plenty for a credit balance UI.
type AccountCacheEntry = { at: number; value: OpusAccountInfo | null }
let accountCache: AccountCacheEntry | null = null
const ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000

export async function fetchOpusAccountInfo(): Promise<OpusAccountInfo | null> {
  if (accountCache && Date.now() - accountCache.at < ACCOUNT_CACHE_TTL_MS) {
    return accountCache.value
  }
  for (const path of ACCOUNT_PATH_CANDIDATES) {
    try {
      const res = await fetch(`${OPUS_API}${path}`, {
        headers: authHeaders(),
        // Aggressive timeout: 10 candidates * 5s = up to 50s of hang.
        // 2s each keeps the worst case under 20s for the first call and
        // the cache keeps every subsequent call instant.
        signal: AbortSignal.timeout(2_000),
      })
      if (!res.ok) continue
      const data = (await res.json().catch(() => null)) as unknown
      if (!data) continue
      logInfo('opus: account endpoint hit', { path })
      const value: OpusAccountInfo = {
        endpoint: path,
        raw: data,
        ...parseAccountFields(data as Record<string, unknown>),
      }
      accountCache = { at: Date.now(), value }
      return value
    } catch {
      // Try the next candidate
    }
  }
  accountCache = { at: Date.now(), value: null }
  return null
}

function parseAccountFields(d: Record<string, unknown>): {
  creditsRemaining: number | null
  creditsTotal: number | null
  minutesRemaining: number | null
  minutesTotal: number | null
  planName: string | null
} {
  const num = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = pickDeep(d, k)
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    }
    return null
  }
  const str = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = pickDeep(d, k)
      if (typeof v === 'string' && v.length > 0) return v
    }
    return null
  }
  return {
    creditsRemaining: num('creditsRemaining', 'creditsLeft', 'remainingCredits', 'credits'),
    creditsTotal: num('creditsTotal', 'totalCredits', 'creditLimit'),
    minutesRemaining: num('minutesRemaining', 'minutesLeft', 'remainingMinutes', 'minutes'),
    minutesTotal: num('minutesTotal', 'totalMinutes', 'minuteLimit', 'monthlyMinutes'),
    planName: str('planName', 'plan', 'tier', 'subscriptionName'),
  }
}

// Shallow + one-level-deep key lookup so {usage: {credits: 42}} matches "credits".
function pickDeep(d: Record<string, unknown>, key: string): unknown {
  if (d[key] !== undefined) return d[key]
  for (const v of Object.values(d)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = (v as Record<string, unknown>)[key]
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

// Triggers OpusClip to actually render an MP4 for a clip so we can get
// playable URLs back. OpusClip's public docs don't pin down the export
// endpoint, so we probe several reasonable patterns. Returns the first
// 2xx response and the path that worked. Raw is surfaced so the UI can
// show what came back.
export type OpusExportResult = {
  endpoint: string
  raw: unknown
  videoUrl: string | null
  downloadUrl: string | null
  thumbnailUrl: string | null
}

export async function exportOpusClip(args: {
  clipId: string
  projectId: string
  orgId: string | null
}): Promise<OpusExportResult> {
  const headers: Record<string, string> = { ...authHeaders() }
  if (args.orgId) headers['x-opus-org-id'] = args.orgId

  // Each candidate: (method, path, body). Ordered by best guess based
  // on OpusClip's existing /clip-projects + /exportable-clips surface.
  const candidates: Array<{ method: 'POST' | 'GET'; path: string; body?: unknown }> = [
    { method: 'POST', path: `/exportable-clips/${args.clipId}/export` },
    { method: 'POST', path: `/exportable-clips/${args.clipId}/render` },
    { method: 'POST', path: `/exportable-clips/${args.clipId}`, body: { action: 'export' } },
    { method: 'POST', path: `/exports`, body: { clipId: args.clipId, projectId: args.projectId } },
    { method: 'POST', path: `/clip-exports`, body: { clipId: args.clipId, projectId: args.projectId } },
    { method: 'POST', path: `/clip-projects/${args.projectId}/exports`, body: { clipId: args.clipId } },
    { method: 'POST', path: `/render-clip`, body: { clipId: args.clipId, projectId: args.projectId } },
    { method: 'GET',  path: `/exportable-clips/${args.clipId}` },
  ]

  const attempts: Array<{ endpoint: string; status: number; body: string }> = []
  for (const c of candidates) {
    try {
      const init: RequestInit = {
        method: c.method,
        headers,
        signal: AbortSignal.timeout(20_000),
      }
      if (c.body) init.body = JSON.stringify(c.body)
      const res = await fetch(`${OPUS_API}${c.path}`, init)
      const bodyText = await res.text()
      attempts.push({ endpoint: `${c.method} ${c.path}`, status: res.status, body: bodyText.slice(0, 600) })
      if (!res.ok) continue
      let parsed: unknown = bodyText
      try { parsed = JSON.parse(bodyText) } catch {}
      // Harvest URLs from the response wherever they live.
      const found = harvestMediaUrls(parsed)
      logInfo('opus.export: succeeded', { endpoint: `${c.method} ${c.path}`, clipId: args.clipId })
      return {
        endpoint: `${c.method} ${c.path}`,
        raw: parsed,
        videoUrl: found.video,
        downloadUrl: found.video,
        thumbnailUrl: found.image,
      }
    } catch (err) {
      attempts.push({
        endpoint: `${c.method} ${c.path}`,
        status: 0,
        body: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      })
    }
  }
  logError('opus.export: all candidates failed', { clipId: args.clipId, attempts })
  throw new Error(`opus_export_failed: tried ${candidates.length} endpoints, see logs for raw responses`)
}

function normalizeClip(c: Record<string, unknown>): OpusClip {
  // OpusClip's response is still beta-shifting; pull whichever field
  // names we recognize and stash the raw blob for later.
  const get = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = c[k]
      if (typeof v === 'string' && v.length > 0) return v
    }
    return null
  }
  const getNum = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = c[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  }
  // First-pass: named fields we know about.
  let previewUrl = get('previewUrl', 'previewURL', 'previewVideoUrl', 'streamUrl', 'videoUrl', 'mp4Url', 'url', 'mediaUrl', 'assetUrl', 'renderUrl')
  let downloadUrl = get('downloadUrl', 'downloadURL', 'exportUrl', 'mp4Url', 'videoUrl', 'assetUrl', 'renderUrl')
  let thumbnailUrl = get('thumbnailUrl', 'thumbnailURL', 'thumbUrl', 'coverUrl', 'imageUrl', 'thumbnail', 'cover', 'poster')

  // Deep scan: walk the whole clip object looking for URL-shaped
  // strings. Classify by extension. Lets us find URLs no matter
  // where OpusClip nests them.
  if (!previewUrl || !downloadUrl || !thumbnailUrl) {
    const found = harvestMediaUrls(c)
    if (!previewUrl) previewUrl = found.video
    if (!downloadUrl) downloadUrl = found.video
    if (!thumbnailUrl) thumbnailUrl = found.image
  }

  return {
    id: String(c.id ?? c.clipId ?? c._id ?? ''),
    title: get('title', 'name', 'caption', 'headline'),
    durationSeconds: getNum('durationSeconds', 'duration', 'length'),
    previewUrl,
    downloadUrl,
    thumbnailUrl,
    score: getNum('score', 'viralityScore', 'virality'),
    raw: c,
  }
}

// Walk an arbitrary object looking for the most-promising video and
// image URL strings. Pulls strings that look like https://… ending in
// a known media extension. Used as a fallback when OpusClip's named
// fields don't match anything we expect.
function harvestMediaUrls(root: unknown): { video: string | null; image: string | null } {
  const VIDEO_EXT = /\.(mp4|m3u8|mov|webm|m4v)(?:\?|#|$)/i
  const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(?:\?|#|$)/i
  let video: string | null = null
  let image: string | null = null
  const seen = new WeakSet<object>()
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (!/^https?:\/\//i.test(node)) return
      if (!video && VIDEO_EXT.test(node)) video = node
      if (!image && IMAGE_EXT.test(node)) image = node
      return
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v)
      return
    }
    if (node && typeof node === 'object') {
      if (seen.has(node as object)) return
      seen.add(node as object)
      for (const v of Object.values(node as Record<string, unknown>)) walk(v)
    }
  }
  walk(root)
  return { video, image }
}
