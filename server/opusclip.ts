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
  if (opts?.prompt && opts.prompt.trim()) body.prompt = opts.prompt.trim().slice(0, 1000)
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

const ACCOUNT_PATH_CANDIDATES = [
  '/account',
  '/me',
  '/account/usage',
  '/account/credits',
  '/credits',
  '/quota',
  '/usage',
  '/billing',
  '/billing/credits',
  '/organizations/me',
]

export async function fetchOpusAccountInfo(): Promise<OpusAccountInfo | null> {
  for (const path of ACCOUNT_PATH_CANDIDATES) {
    try {
      const res = await fetch(`${OPUS_API}${path}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) continue
      const data = (await res.json().catch(() => null)) as unknown
      if (!data) continue
      logInfo('opus: account endpoint hit', { path })
      return {
        endpoint: path,
        raw: data,
        ...parseAccountFields(data as Record<string, unknown>),
      }
    } catch {
      // Try the next candidate
    }
  }
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
