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
// Bundled ffmpeg binary — ships in the npm package, lives at
// node_modules/@ffmpeg-installer/<platform>-<arch>/ffmpeg. No PATH
// dependency, works the same on Railway / local / wherever Node runs.
// We tried Nix's `ffmpeg` package via nixpacks.toml and it never
// reliably landed in PATH on the runtime container; this swap takes
// system PATH out of the equation entirely.
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { logError, logInfo } from './diag'
import { getTemporaryLink, uploadFile } from './dropbox'

const FFMPEG_PATH = ffmpegInstaller.path

// Cache the ffmpeg-on-PATH check so we don't probe (or log) on every
// frame call. Set to false if the first probe ENOENTs; subsequent
// extractions short-circuit instead of generating one alert email per
// failed frame × every item in the plan.
let ffmpegAvailable: boolean | null = null

async function probeFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn(FFMPEG_PATH, ['-version'], { stdio: 'ignore' })
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
        // extends past the end of the video). Log as INFO and continue
        // — these per-frame failures used to fire admin alerts, which
        // turned a single audio-source upload into 20+ emails.
        logInfo('stills: ffmpeg frame skipped', {
          itemId: input.itemId, t, error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (localFiles.length === 0) {
      // ALL frames failed → escalate ONCE. The caller (socials route)
      // catches this and decides whether to email.
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

// Thin Promise-wrapper around child_process.spawn for ffmpeg. Adds
// an explicit timeout so a hung ffmpeg can't sit forever waiting on a
// dead network read, and captures a larger stderr tail so the actual
// failure reason survives in error logs (was 400 chars, which only
// caught the end of ffmpeg's startup banner — completely useless for
// debugging).
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000  // 5 minutes per invocation

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += String(d) })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`ffmpeg_timeout_${FFMPEG_TIMEOUT_MS}ms: ${tail(stderr)}`))
    }, FFMPEG_TIMEOUT_MS)
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      // exit code null = process was killed by a signal (SIGKILL from
      // OOM-killer, our timeout, etc.). Report the signal so the cause
      // is visible instead of just "exit_null".
      else if (code === null) reject(new Error(`ffmpeg_killed_${signal ?? 'unknown'}: ${tail(stderr)}`))
      else reject(new Error(`ffmpeg_exit_${code}: ${tail(stderr)}`))
    })
  })
}

// Capture enough stderr to include the actual error, but skip past
// ffmpeg's verbose startup banner. We grab the last 2000 chars AND the
// last few non-banner lines, so debugging finds the real message.
function tail(stderr: string): string {
  return stderr.slice(-2000).trim()
}

// Probe the source file with ffprobe to confirm it has a video stream.
// Returns { hasVideo, hasAudio } so we can skip stills/clips on audio-
// only sources cleanly (instead of letting ffmpeg try, fail, and email
// a stack of errors). Resolves to nulls if the probe itself fails.
export async function probeMediaStreams(url: string): Promise<{ hasVideo: boolean; hasAudio: boolean } | null> {
  // ffprobe ships alongside the @ffmpeg-installer ffmpeg binary in
  // some packages but not all. Best-effort: try the path next to ffmpeg.
  const probePath = FFMPEG_PATH.replace(/ffmpeg$/, 'ffprobe')
  return new Promise((resolve) => {
    const proc = spawn(probePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-timeout', '10000000', // 10s socket timeout
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    proc.stdout?.on('data', (d) => { stdout += String(d) })
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null) }, 20_000)
    proc.on('error', () => { clearTimeout(timer); resolve(null) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve(null)
      try {
        const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }> }
        const streams = parsed.streams ?? []
        resolve({
          hasVideo: streams.some((s) => s.codec_type === 'video'),
          hasAudio: streams.some((s) => s.codec_type === 'audio'),
        })
      } catch {
        resolve(null)
      }
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

// Helper: parse a [HH:MM:SS - HH:MM:SS] range — Claude is required to
// produce these on every suggested_clip. Returns start + end in
// seconds, or null if the string doesn't have a range.
export function parseTimecodeRange(s: string | undefined | null): { startSeconds: number; endSeconds: number } | null {
  if (!s) return null
  // Accepts plain dash, en-dash, em-dash, "to", optional spaces.
  const m = s.match(/\[(\d{1,2}):(\d{2}):(\d{2})\s*[-–—to]+\s*(\d{1,2}):(\d{2}):(\d{2})/i)
  if (!m) return null
  const h1 = Number(m[1]), m1 = Number(m[2]), s1 = Number(m[3])
  const h2 = Number(m[4]), m2 = Number(m[5]), s2 = Number(m[6])
  const start = h1 * 3600 + m1 * 60 + s1
  const end = h2 * 3600 + m2 * 60 + s2
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  // Cap at 90s — anything longer is almost certainly a Claude
  // hallucination of an end timecode. Reel/story clips top out
  // around 60s in practice.
  if (end - start > 90) return null
  return { startSeconds: start, endSeconds: end }
}

// ============================================================
// Video clip extraction
// ============================================================
//
// Same idea as still extraction but the output is an mp4 segment cut
// from the source episode at the [start - end] range. Used to turn
// Claude's "[00:14:23 – 00:15:02] Sherri's bit about Kool-Aid" into
// a real ready-to-post clip, no OpusClip required for moments Claude
// has already picked.

export type ClipExtractInput = {
  videoDropboxPath: string
  startSeconds: number
  endSeconds: number
  songId: string
  itemId: string
  version?: number
}

export type ClipExtractResult = {
  dropboxPath: string
  durationSeconds: number
  version: number
}

export async function extractClipForItem(input: ClipExtractInput): Promise<ClipExtractResult> {
  if (!(await probeFfmpeg())) throw new Error('clips_ffmpeg_unavailable')
  const version = input.version ?? 0
  const duration = input.endSeconds - input.startSeconds
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slate-clip-'))
  try {
    const link = await getTemporaryLink(input.videoDropboxPath)
    if (!link.ok || !link.url) {
      throw new Error(`dropbox_temp_link_failed: ${link.error || 'unknown'}`)
    }
    const outPath = path.join(workDir, 'clip.mp4')
    // Use -ss BEFORE -i for fast seeking, then -t for duration. Use
    // -c copy to avoid re-encoding (fast, lossless). If the keyframes
    // don't line up exactly, the cut may start a fraction of a second
    // late — acceptable for a 30-60s social clip preview.
    await runFfmpeg([
      '-ss', input.startSeconds.toFixed(3),
      '-i', link.url,
      '-t', duration.toFixed(3),
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outPath,
    ])
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error('clip_no_output')
    }
    const buf = await fs.promises.readFile(outPath)
    const dropboxFolder = `/slate-clips/${input.songId}/${input.itemId}`
    const fileName = `v${version}.mp4`
    const res = await uploadFile(dropboxFolder, fileName, buf)
    if (!res.ok || !res.path) {
      throw new Error(`dropbox_upload_failed: ${res.error || 'unknown'}`)
    }
    logInfo('clips: extracted', {
      itemId: input.itemId,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      durationSeconds: duration,
      version,
      bytes: buf.length,
    })
    return {
      dropboxPath: res.path,
      durationSeconds: duration,
      version,
    }
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
