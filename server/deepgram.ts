// Deepgram client. Submits a media URL (e.g. a Dropbox temporary link) for
// transcription using the Nova-3 model with smart formatting, diarization,
// punctuation, and paragraphs. Returns the request id immediately for the
// async path; the caller polls status separately.
//
// Docs: https://developers.deepgram.com/docs/pre-recorded-audio
import { logError, logInfo } from './diag'

const DEEPGRAM_API = 'https://api.deepgram.com/v1'

export function hasDeepgramKey(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY)
}

function authHeader(): Record<string, string> {
  const key = process.env.DEEPGRAM_API_KEY || ''
  return { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }
}

// Default query params we want for podcast transcription.
const DEFAULT_PARAMS: Record<string, string> = {
  model: 'nova-3',
  smart_format: 'true',
  diarize: 'true',
  punctuate: 'true',
  paragraphs: 'true',
  utterances: 'true',
  detect_language: 'false',
  language: 'en',
}

function paramsToQuery(params: Record<string, string>): string {
  const sp = new URLSearchParams(params)
  return sp.toString()
}

export type DeepgramWord = {
  word: string
  punctuated_word?: string
  start: number
  end: number
  confidence?: number
  speaker?: number
}

export type DeepgramParagraph = {
  start: number
  end: number
  speaker?: number
  sentences: Array<{ text: string; start: number; end: number }>
}

export type DeepgramTranscriptionResult = {
  request_id?: string
  duration_seconds?: number
  language?: string
  words: DeepgramWord[]
  paragraphs: DeepgramParagraph[]
  full_transcript: string
}

// Submit a URL for transcription. Returns the parsed result synchronously
// (Deepgram pre-recorded API returns the full result in the response —
// it's already async on their side, but the HTTP call blocks until done).
//
// For our 2GB ceiling, this can block for up to a few minutes. We return
// the result object so the caller can persist it. Errors throw.
export async function transcribeUrl(
  url: string,
  language: string = 'en',
): Promise<DeepgramTranscriptionResult> {
  const params = { ...DEFAULT_PARAMS, language }
  const endpoint = `${DEEPGRAM_API}/listen?${paramsToQuery(params)}`
  logInfo('deepgram: transcribe start', { language })
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const text = await res.text()
    logError('deepgram: transcribe failed', { status: res.status, body: text.slice(0, 500) })
    throw new Error(`deepgram_${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as DeepgramRawResponse
  return normalizeResponse(data)
}

type DeepgramRawResponse = {
  metadata?: { request_id?: string; duration?: number; language?: string }
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
        words?: DeepgramWord[]
        paragraphs?: { transcript?: string; paragraphs?: DeepgramParagraph[] }
      }>
    }>
  }
}

function normalizeResponse(data: DeepgramRawResponse): DeepgramTranscriptionResult {
  const alt = data.results?.channels?.[0]?.alternatives?.[0]
  const words = alt?.words ?? []
  const paragraphs = alt?.paragraphs?.paragraphs ?? []
  const full = alt?.paragraphs?.transcript ?? alt?.transcript ?? ''
  return {
    request_id: data.metadata?.request_id,
    duration_seconds: data.metadata?.duration,
    language: data.metadata?.language,
    words,
    paragraphs,
    full_transcript: full,
  }
}

// Convert Deepgram paragraphs into our "edited blocks" format, which is
// what the editor reads/writes. One block = one paragraph; speaker is a
// label string the user can rename (we seed it from Deepgram's numeric
// speaker id, e.g. "Speaker 0").
export type EditedBlock = {
  id: string
  speaker: string
  start: number
  end: number
  text: string
  // Per-word timings preserved so the editor can later support word-level
  // click-to-seek (Phase 2). For Phase 1 we just persist them.
  words: Array<{ word: string; start: number; end: number }>
}

export function paragraphsToBlocks(result: DeepgramTranscriptionResult): EditedBlock[] {
  return result.paragraphs.map((p, i) => {
    const text = p.sentences.map((s) => s.text).join(' ').trim()
    const blockWords = result.words.filter((w) => w.start >= p.start && w.end <= p.end)
      .map((w) => ({
        word: w.punctuated_word || w.word,
        start: w.start,
        end: w.end,
      }))
    return {
      id: `b${i + 1}`,
      speaker: p.speaker !== undefined ? `Speaker ${p.speaker}` : 'Speaker',
      start: p.start,
      end: p.end,
      text,
      words: blockWords,
    }
  })
}
