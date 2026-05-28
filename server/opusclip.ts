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

// POST /clip-projects — kicks off clip generation. Accepts public URLs
// (YouTube, Google Drive, Vimeo, S3, Dropbox temp links, etc.) so we
// hand it a Dropbox temporary link with no upload.
export async function createOpusProject(videoUrl: string): Promise<OpusCreateResult> {
  const res = await fetch(`${OPUS_API}/clip-projects`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ videoUrl }),
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
  return {
    id: String(c.id ?? c.clipId ?? c._id ?? ''),
    title: get('title', 'name', 'caption', 'headline'),
    durationSeconds: getNum('durationSeconds', 'duration', 'length'),
    previewUrl: get('previewUrl', 'previewURL', 'previewVideoUrl', 'streamUrl'),
    downloadUrl: get('downloadUrl', 'downloadURL', 'exportUrl', 'mp4Url'),
    thumbnailUrl: get('thumbnailUrl', 'thumbnailURL', 'thumbUrl', 'coverUrl'),
    score: getNum('score', 'viralityScore', 'virality'),
    raw: c,
  }
}
