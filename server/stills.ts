// Still-frame extraction for podcast social plans.
//
// Claude proposes timecoded clip moments; this module pulls 5 stills
// from the source MP4 around each proposed timecode so the team has
// real, pickable photos (not just descriptions). Frames are sampled
// across a window because a single frame is almost always a blink, an
// open mouth, or motion blur — five gives a fighting chance of a
// usable shot.
//
// We shell out to ffmpeg (installed via nixpacks.toml) rather than
// pulling in a heavy Node binding. Frames are written to a temp dir,
// uploaded to Dropbox at slate-stills/<songId>/<itemId>/<filename>,
// and the resulting paths are stored on the social item.

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logError, logInfo } from './diag'
import { getTemporaryLink, uploadFile } from './dropbox'

// Cache the ffmpeg-on-PATH check so we don't probe (or log) on every
// frame call. Set to false if the first probe ENOENTs; subsequent
// extractions short-circuit instead of generating one alert email per
// failed frame × every item in the plan.
let ffmpegAvailable: boolean | null = null

async function probeFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    proc.on('error', () => resolve(false))
    proc.on('close', (code) => resolve(code === 0))
  })
  if (ffmpegAvailable) {
    logInfo('stills: ffmpeg available')
  } else {
    logError('stills: ffmpeg not in PATH — stills extraction will be skipped', {})
  }
  return ffmpegAvailable
}

export function isFfmpegAvailable(): Promise<boolean> {
  return probeFfmpeg()
}

export type StillExtractInput = {
  // Dropbox path to the source MP4. We grab a temp link from this.
  videoDropboxPath: string
  // Center timecode in seconds.
  centerSeconds: number
  // Symmetric window around the center, in seconds. We sample 5 frames
  // evenly spaced from (center - window) to (center + window).
  windowSeconds?: number
  // How many frames to pull. Default 5.
  frameCount?: number
  // For Dropbox path scoping.
  songId: string
  itemId: string
  // Bump to invalidate previous batch on regenerate. Default 0.
  version?: number
}

export type StillExtractResult = {
  // Dropbox paths of the uploaded JPGs, in chronological order.
  paths: string[]
  // Echo back so the caller can persist on the item.
  windowSeconds: number
  centerSeconds: number
  version: number
}

const DEFAULT_WINDOW_S = 2
const DEFAULT_FRAME_COUNT = 5

export async function extractStillsForItem(input: StillExtractInput): Promise<StillExtractResult> {
  if (!(await probeFfmpeg())) {
    throw new Error('stills_ffmpeg_unavailable')
  }
  const windowS = input.windowSeconds ?? DEFAULT_WINDOW_S
  const frames = input.frameCount ?? DEFAULT_FRAME_COUNT
  const version = input.version ?? 0

  // Temporary working dir per call so concurrent extractions don't collide.
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slate-stills-'))
  try {
    // Dropbox temp link, valid for 4 hours — plenty for one extraction.
    const link = await getTemporaryLink(input.videoDropboxPath)
    if (!link.ok || !link.url) {
      throw new Error(`dropbox_temp_link_failed: ${link.error || 'unknown'}`)
    }

    // Sample timestamps evenly across the window. For frames=5 and
    // window=2s, we get center -2, -1, 0, +1, +2.
    const stamps: number[] = []
    const stepCount = frames > 1 ? frames - 1 : 1
    const step = (windowS * 2) / stepCount
    for (let i = 0; i < frames; i++) {
      const t = input.centerSeconds - windowS + step * i
      stamps.push(Math.max(0, t))
    }

    // Run one ffmpeg invocation per timestamp. Slower than a single
    // filtergraph call but each frame is independently retryable and
    // we get cleaner errors when one timestamp is past the end of file.
    const localFiles: string[] = []
    for (let i = 0; i < stamps.length; i++) {
      const t = stamps[i]
      const outPath = path.join(workDir, `frame-${i}.jpg`)
      try {
        await runFfmpeg([
          '-ss', t.toFixed(3),
          '-i', link.url,
          '-frames:v', '1',
          '-q:v', '2',
          '-y',
          outPath,
        ])
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          localFiles.push(outPath)
        }
      } catch (err) {
        // One bad timestamp shouldn't kill the whole batch (e.g. window
        // extends past the end of the video). Log and continue.
        logError('stills: ffmpeg frame failed', {
          itemId: input.itemId, t, error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (localFiles.length === 0) {
      throw new Error('stills_no_frames_extracted')
    }

    // Upload each frame to Dropbox.
    const dropboxFolder = `/slate-stills/${input.songId}/${input.itemId}`
    const uploadedPaths: string[] = []
    for (let i = 0; i < localFiles.length; i++) {
      const buf = await fs.promises.readFile(localFiles[i])
      const fileName = `v${version}-f${i}.jpg`
      const res = await uploadFile(dropboxFolder, fileName, buf)
      if (res.ok && res.path) {
        uploadedPaths.push(res.path)
      } else {
        logError('stills: dropbox upload failed', { itemId: input.itemId, fileName, error: res.error })
      }
    }

    logInfo('stills: extracted', {
      itemId: input.itemId,
      requested: stamps.length,
      extracted: localFiles.length,
      uploaded: uploadedPaths.length,
      version,
    })

    return {
      paths: uploadedPaths,
      windowSeconds: windowS,
      centerSeconds: input.centerSeconds,
      version,
    }
  } finally {
    // Clean up the temp dir regardless of success/failure.
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Thin Promise-wrapper around child_process.spawn for ffmpeg.
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += String(d) })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg_exit_${code}: ${stderr.slice(-400)}`))
    })
  })
}

// Helper: parse the [HH:MM:SS] prefix from a Claude-generated
// suggested_clip / image_direction string. Returns the center timecode
// in seconds, or null if the string isn't timecoded.
export function parseTimecode(s: string | undefined | null): number | null {
  if (!s) return null
  const m = s.match(/\[(\d{1,2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const mn = Number(m[2])
  const sc = Number(m[3])
  if (!Number.isFinite(h) || !Number.isFinite(mn) || !Number.isFinite(sc)) return null
  return h * 3600 + mn * 60 + sc
}
