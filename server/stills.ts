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

    // CRITICAL: stream the source file to local disk ONCE before running
    // ffmpeg, instead of letting ffmpeg fetch over HTTP for every frame.
    // Streaming + ffmpeg-decoding in parallel on a 1-2hr H.264 episode
    // can spike memory hard enough that Railway's OOM-killer drops the
    // ffmpeg process (manifests as `ffmpeg_exit_null` in error logs).
    // Downloading first decouples the network from ffmpeg's memory
    // profile entirely.
    const sourcePath = path.join(workDir, 'source')
    await downloadToLocalFile(link.url, sourcePath)
    logInfo('stills: source downloaded', {
      itemId: input.itemId,
      bytes: fs.statSync(sourcePath).size,
    })

    // Sample timestamps evenly across the window. For frames=5 and
    // window=2s, we get center -2, -1, 0, +1, +2.
    const stamps: number[] = []
    const stepCount = frames > 1 ? frames - 1 : 1
    const step = (windowS * 2) / stepCount
    for (let i = 0; i < frames; i++) {
      const t = input.centerSeconds - windowS + step * i
      stamps.push(Math.max(0, t))
    }

    // Run one ffmpeg invocation per timestamp against the LOCAL file.
    // Way faster (no per-frame HTTP overhead) and OOM-safe. Added memory
    // constraints to prevent OOM kills on large files.
    const localFiles: string[] = []
    for (let i = 0; i < stamps.length; i++) {
      const t = stamps[i]
      const outPath = path.join(workDir, `frame-${i}.jpg`)
      try {
        await runFfmpeg([
          // Seek before input for speed; accuracy isn't critical for preview frames
          '-ss', t.toFixed(3),
          // Reduce probe size and duration to minimize memory on file open
          '-probesize', '50M',
          '-analyzeduration', '10M',
          '-i', sourcePath,
          // Extract exactly one frame
          '-frames:v', '1',
          // JPEG quality (2 = high quality, range is 2-31)
          '-q:v', '2',
          // Overwrite output file without asking
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
        const errMsg = err instanceof Error ? err.message : String(err)
        logInfo('stills: ffmpeg frame skipped', {
          itemId: input.itemId, t, error: errMsg,
        })
        // If ffmpeg was killed by signal (OOM, etc.), log additional context
        if (errMsg.includes('killed_by_signal') || errMsg.includes('ffmpeg_exit_null')) {
          logError('stills: ffmpeg killed (likely OOM)', {
            itemId: input.itemId,
            t,
            sourceSize: fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 'unknown',
            error: errMsg,
          })
        }
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
        // If we hit an auth or path permission error, throw immediately so
        // the caller can surface it with a clear message (rather than
        // silently skipping uploads and leaving the user confused).
        if (res.error?.includes('dropbox_auth_failed') || 
            res.error?.includes('dropbox_path_permission_denied') ||
            res.error?.includes('no_write_permission')) {
          throw new Error(res.error || 'dropbox_upload_failed')
        }
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

function runFfmpeg(args: string[], opts?: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'], cwd: opts?.cwd })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += String(d) })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`ffmpeg_timeout_${FFMPEG_TIMEOUT_MS}ms: ${tail(stderr)}`))
    }, FFMPEG_TIMEOUT_MS)
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      // Null code means the process was killed by a signal (often OOM on
      // Railway). Explicitly check for this and provide a better error.
      if (code === null || code === undefined || typeof code !== 'number') {
        reject(new Error(`ffmpeg_killed_by_signal_${signal ?? 'unknown'}: ${tail(stderr)}`))
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`ffmpeg_exit_code_${code}: ${tail(stderr)}`))
    })
  })
}

// Capture enough stderr to include the actual error, but skip past
// ffmpeg's verbose startup banner. We grab the last 2000 chars AND the
// last few non-banner lines, so debugging finds the real message.
function tail(stderr: string): string {
  return stderr.slice(-2000).trim()
}

// Stream a remote URL into a local file. Streaming is essential —
// `await response.arrayBuffer()` would buffer a 2GB MP4 in memory and
// re-trigger the exact OOM we're trying to escape. Resolves once the
// write stream is fully drained.
async function downloadToLocalFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`download_failed: HTTP ${res.status} ${res.statusText}`)
  }
  if (!res.body) {
    throw new Error('download_failed: empty body')
  }
  const out = fs.createWriteStream(destPath)
  const reader = res.body.getReader()
  try {
    // Pump chunks one at a time through the write stream and honor
    // backpressure so we don't queue up GBs in memory if disk is slow.
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once('drain', resolve))
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  }
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

// One timed caption line, in ABSOLUTE source seconds. We offset to
// clip-relative time when we build the subtitle file.
export type ClipCaption = { startSeconds: number; endSeconds: number; text: string }

export type ClipExtractInput = {
  videoDropboxPath: string
  startSeconds: number
  endSeconds: number
  songId: string
  itemId: string
  version?: number
  // Render a framed 9:16 vertical (blurred fill + centered video) —
  // the shape social clips actually need. Default true. Set false only
  // for a raw horizontal passthrough cut.
  vertical?: boolean
  // Transcript blocks that overlap the clip. When present we burn them
  // in as captions. Best-effort: if the build's subtitle filter is
  // missing, we fall back to the same clip without captions.
  captions?: ClipCaption[]
}

export type ClipExtractResult = {
  dropboxPath: string
  durationSeconds: number
  version: number
  // What actually rendered, after the fallback ladder, so the caller /
  // logs know whether captions + vertical framing made it in.
  vertical: boolean
  captioned: boolean
}

// ── Subtitle (ASS) generation ───────────────────────────────────────
//
// Block-level captions from the transcript. Each transcript block is
// split into ~6-word chunks spread evenly across its duration so the
// caption reads a few words at a time (the look that works on Reels)
// rather than dumping a whole paragraph on screen. Times are made
// relative to the clip start, since we fast-seek with -ss before -i
// (output timestamps reset to 0).

function assTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 100)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${h}:${p2(m)}:${p2(sec)}.${p2(cs)}`
}

function sanitizeCaptionText(text: string): string {
  // Strip ASS override braces + collapse whitespace so a stray brace or
  // newline can't corrupt the Dialogue line.
  return text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

const CAPTION_CHUNK_WORDS = 6

// Break transcript blocks into the ~6-word lines that ACTUALLY appear on
// screen, each with its own absolute start/end. We store these as the
// clip's captions so the editor shows exactly what the viewer sees (like
// Instagram/rev), and buildAssFile renders each line one-to-one.
export function chunkCaptions(
  blocks: ClipCaption[],
  clipStartSeconds: number,
  clipDurationSeconds: number,
): ClipCaption[] {
  const out: ClipCaption[] = []
  for (const cap of blocks) {
    const relStart = cap.startSeconds - clipStartSeconds
    const relEnd = Math.min(cap.endSeconds - clipStartSeconds, clipDurationSeconds)
    if (relEnd <= 0 || relStart >= clipDurationSeconds || relEnd <= relStart) continue
    const text = sanitizeCaptionText(cap.text)
    if (!text) continue
    const words = text.split(' ')
    const chunks: string[] = []
    for (let i = 0; i < words.length; i += CAPTION_CHUNK_WORDS) {
      chunks.push(words.slice(i, i + CAPTION_CHUNK_WORDS).join(' '))
    }
    const span = relEnd - relStart
    const per = span / chunks.length
    for (let i = 0; i < chunks.length; i++) {
      const cs = Math.max(0, relStart + per * i)
      const ce = Math.min(clipDurationSeconds, relStart + per * (i + 1))
      if (ce <= cs) continue
      // Store in ABSOLUTE source seconds so edits + re-renders line up.
      out.push({ startSeconds: clipStartSeconds + cs, endSeconds: clipStartSeconds + ce, text: chunks[i] })
    }
  }
  return out
}

function buildAssFile(captions: ClipCaption[], clipStartSeconds: number, clipDurationSeconds: number): string {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // White text, opaque-ish black box (BorderStyle 3), bottom-center,
    // lifted off the very bottom. Clean + editorial, no karaoke colours.
    'Style: Cap,Arial,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,3,6,0,2,90,90,300,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const lines: string[] = []
  for (const cap of captions) {
    const relStart = cap.startSeconds - clipStartSeconds
    const relEnd = Math.min(cap.endSeconds - clipStartSeconds, clipDurationSeconds)
    if (relEnd <= 0 || relStart >= clipDurationSeconds || relEnd <= relStart) continue
    const text = sanitizeCaptionText(cap.text)
    if (!text) continue
    const words = text.split(' ')
    const CHUNK = 6
    const chunks: string[] = []
    for (let i = 0; i < words.length; i += CHUNK) chunks.push(words.slice(i, i + CHUNK).join(' '))
    const span = relEnd - relStart
    const per = span / chunks.length
    for (let i = 0; i < chunks.length; i++) {
      const cs = Math.max(0, relStart + per * i)
      const ce = Math.min(clipDurationSeconds, relStart + per * (i + 1))
      if (ce <= cs) continue
      lines.push(`Dialogue: 0,${assTime(cs)},${assTime(ce)},Cap,,0,0,0,,${chunks[i]}`)
    }
  }
  return header.concat(lines).join('\n') + '\n'
}

// Vertical framing filtergraph: a blurred, filled 9:16 background with
// the source video scaled to full width and centered. Optionally burns
// the ASS subtitle file (referenced by bare name; ffmpeg runs with cwd
// = workDir so we never have to escape the path).
function verticalFilter(withCaptions: boolean): string {
  const base =
    '[0:v]split=2[bg][fg];' +
    '[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bgb];' +
    '[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fg2];' +
    '[bgb][fg2]overlay=(W-w)/2:(H-h)/2'
  return withCaptions ? `${base}[base];[base]ass=captions.ass[vout]` : `${base}[vout]`
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
    // Stream source to local disk first (see same fix in
    // extractStillsForItem). This is the difference between "ffmpeg
    // runs reliably on H.264 episode MP4s" and "ffmpeg gets OOM-killed
    // streaming a 2hr file from Dropbox."
    const sourcePath = path.join(workDir, 'source')
    await downloadToLocalFile(link.url, sourcePath)
    logInfo('clips: source downloaded', {
      itemId: input.itemId,
      bytes: fs.statSync(sourcePath).size,
    })
    const outPath = path.join(workDir, 'clip.mp4')
    const wantVertical = input.vertical !== false
    const haveCaptions = wantVertical && Array.isArray(input.captions) && input.captions.length > 0
    const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

    // Vertical (9:16 framed) render. -ss BEFORE -i fast-seeks and resets
    // output timestamps to 0, so the subtitle times (clip-relative) line
    // up. We re-encode here (the filters require it), unlike the raw
    // copy fallback below.
    const verticalArgs = (withCaptions: boolean): string[] => [
      '-ss', input.startSeconds.toFixed(3),
      '-probesize', '50M',
      '-analyzeduration', '10M',
      '-i', sourcePath,
      '-t', duration.toFixed(3),
      '-filter_complex', verticalFilter(withCaptions),
      '-map', '[vout]',
      // Optional audio — the '?' means "don't fail if there's no track".
      '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outPath,
    ]
    // Original behaviour: a raw horizontal passthrough cut. Last-resort
    // fallback so a clip is ALWAYS produced even if the filter graph
    // (missing libass / boxblur in the build) can't run.
    const copyArgs = (): string[] => [
      '-ss', input.startSeconds.toFixed(3),
      '-probesize', '50M',
      '-analyzeduration', '10M',
      '-i', sourcePath,
      '-t', duration.toFixed(3),
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', outPath,
    ]

    if (haveCaptions) {
      await fs.promises.writeFile(
        path.join(workDir, 'captions.ass'),
        buildAssFile(input.captions!, input.startSeconds, duration),
      )
    }

    // Render ladder — best look first, guaranteed output last.
    let renderedVertical = false
    let renderedCaptioned = false
    if (haveCaptions) {
      try {
        await runFfmpeg(verticalArgs(true), { cwd: workDir })
        renderedVertical = true; renderedCaptioned = true
      } catch (err) {
        logInfo('clips: vertical+captions render failed, retrying without captions', {
          itemId: input.itemId, error: errMsg(err),
        })
      }
    }
    if (!renderedVertical && wantVertical) {
      try {
        await runFfmpeg(verticalArgs(false), { cwd: workDir })
        renderedVertical = true
      } catch (err) {
        logInfo('clips: vertical render failed, falling back to horizontal cut', {
          itemId: input.itemId, error: errMsg(err),
        })
      }
    }
    if (!renderedVertical) {
      // Throws on failure — if even a raw copy can't run, the clip
      // genuinely can't be produced and the caller should hear about it.
      await runFfmpeg(copyArgs())
    }

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error('clip_no_output')
    }
    const buf = await fs.promises.readFile(outPath)
    const dropboxFolder = `/slate-clips/${input.songId}/${input.itemId}`
    const fileName = `v${version}.mp4`
    const res = await uploadFile(dropboxFolder, fileName, buf)
    if (!res.ok || !res.path) {
      // Surface the specific error from dropbox.ts (includes the helpful
      // "reconnect required" message for no_write_permission)
      throw new Error(res.error || 'dropbox_upload_failed: unknown')
    }
    logInfo('clips: extracted', {
      itemId: input.itemId,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      durationSeconds: duration,
      version,
      vertical: renderedVertical,
      captioned: renderedCaptioned,
      bytes: buf.length,
    })
    return {
      dropboxPath: res.path,
      durationSeconds: duration,
      version,
      vertical: renderedVertical,
      captioned: renderedCaptioned,
    }
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ============================================================
// Editable-caption clips
// ============================================================
//
// For the Clips panel we want captions the team can fix (Deepgram
// misspells names). So we render TWO files per clip:
//   - a clean (caption-free) 9:16 vertical, cut from the source, and
//   - a captioned version, made by burning the transcript captions
//     ONTO that clean clip.
// Editing captions later re-burns onto the small clean clip (seconds),
// never re-downloads/re-cuts the multi-GB source.

export type EditableClipInput = {
  videoDropboxPath: string
  startSeconds: number
  endSeconds: number
  songId: string
  itemId: string
  captions?: ClipCaption[]
  version?: number
}

export type EditableClipResult = {
  dropboxPath: string          // the captioned clip (or clean if no captions)
  cleanDropboxPath: string     // caption-free copy, for future re-burns
  durationSeconds: number
  version: number
  vertical: boolean
  captioned: boolean
}

// ffmpeg args to burn an ASS file (bare name, cwd = workDir) onto an
// already-vertical clip. Video re-encodes; audio is copied.
function burnArgs(inputPath: string, outPath: string): string[] {
  return [
    '-i', inputPath,
    '-vf', 'ass=captions.ass',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', outPath,
  ]
}

export async function extractEditableClip(input: EditableClipInput): Promise<EditableClipResult> {
  if (!(await probeFfmpeg())) throw new Error('clips_ffmpeg_unavailable')
  const version = input.version ?? 0
  const duration = input.endSeconds - input.startSeconds
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slate-eclip-'))
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))
  try {
    const link = await getTemporaryLink(input.videoDropboxPath)
    if (!link.ok || !link.url) throw new Error(`dropbox_temp_link_failed: ${link.error || 'unknown'}`)
    const sourcePath = path.join(workDir, 'source')
    await downloadToLocalFile(link.url, sourcePath)

    // Pass 1 — clean vertical from source.
    const cleanPath = path.join(workDir, 'clean.mp4')
    const cleanArgs = [
      '-ss', input.startSeconds.toFixed(3),
      '-probesize', '50M', '-analyzeduration', '10M',
      '-i', sourcePath,
      '-t', duration.toFixed(3),
      '-filter_complex', verticalFilter(false),
      '-map', '[vout]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', cleanPath,
    ]
    let vertical = true
    try {
      await runFfmpeg(cleanArgs, { cwd: workDir })
    } catch (err) {
      // No vertical framing available — fall back to a raw horizontal
      // cut. Captions can't be burned on that, but a clip still exists.
      logInfo('eclip: vertical failed, raw cut fallback', { itemId: input.itemId, error: errMsg(err) })
      vertical = false
      await runFfmpeg([
        '-ss', input.startSeconds.toFixed(3), '-probesize', '50M', '-analyzeduration', '10M',
        '-i', sourcePath, '-t', duration.toFixed(3), '-c', 'copy', '-movflags', '+faststart', '-y', cleanPath,
      ])
    }
    if (!fs.existsSync(cleanPath) || fs.statSync(cleanPath).size === 0) throw new Error('clip_no_output')

    const folder = `/slate-clips/${input.songId}/${input.itemId}`
    const cleanUp = await uploadFile(folder, `clean-v${version}.mp4`, await fs.promises.readFile(cleanPath))
    if (!cleanUp.ok || !cleanUp.path) throw new Error(cleanUp.error || 'dropbox_upload_failed')

    // Pass 2 — burn captions onto the clean clip (fast; small input).
    let dropboxPath = cleanUp.path
    let captioned = false
    const caps = input.captions ?? []
    if (vertical && caps.length > 0) {
      try {
        await fs.promises.writeFile(
          path.join(workDir, 'captions.ass'),
          buildAssFile(caps, input.startSeconds, duration),
        )
        const capPath = path.join(workDir, 'captioned.mp4')
        await runFfmpeg(burnArgs(cleanPath, capPath), { cwd: workDir })
        if (fs.existsSync(capPath) && fs.statSync(capPath).size > 0) {
          const capUp = await uploadFile(folder, `v${version}.mp4`, await fs.promises.readFile(capPath))
          if (capUp.ok && capUp.path) { dropboxPath = capUp.path; captioned = true }
        }
      } catch (err) {
        logInfo('eclip: caption burn failed, keeping clean clip', { itemId: input.itemId, error: errMsg(err) })
      }
    }

    logInfo('eclip: rendered', { itemId: input.itemId, version, vertical, captioned })
    return { dropboxPath, cleanDropboxPath: cleanUp.path, durationSeconds: duration, version, vertical, captioned }
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Re-burn edited captions onto an existing clean clip. Fast: downloads
// only the short clean clip, not the source episode. Returns the new
// captioned Dropbox path.
export async function reburnClipCaptions(args: {
  cleanDropboxPath: string
  captions: ClipCaption[]
  clipStartSeconds: number
  clipDurationSeconds: number
  songId: string
  itemId: string
  version: number
}): Promise<{ dropboxPath: string }> {
  if (!(await probeFfmpeg())) throw new Error('clips_ffmpeg_unavailable')
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'slate-reburn-'))
  try {
    const link = await getTemporaryLink(args.cleanDropboxPath)
    if (!link.ok || !link.url) throw new Error(`dropbox_temp_link_failed: ${link.error || 'unknown'}`)
    const cleanLocal = path.join(workDir, 'clean.mp4')
    await downloadToLocalFile(link.url, cleanLocal)

    await fs.promises.writeFile(
      path.join(workDir, 'captions.ass'),
      buildAssFile(args.captions, args.clipStartSeconds, args.clipDurationSeconds),
    )
    const outPath = path.join(workDir, 'captioned.mp4')
    await runFfmpeg(burnArgs(cleanLocal, outPath), { cwd: workDir })
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new Error('reburn_no_output')

    const folder = `/slate-clips/${args.songId}/${args.itemId}`
    const up = await uploadFile(folder, `v${args.version}.mp4`, await fs.promises.readFile(outPath))
    if (!up.ok || !up.path) throw new Error(up.error || 'dropbox_upload_failed')
    logInfo('eclip: re-burned captions', { itemId: args.itemId, version: args.version })
    return { dropboxPath: up.path }
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
