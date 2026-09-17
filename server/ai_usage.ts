// Central Anthropic API usage recorder. Every messages.create call site
// reports its response.usage here with a source tag naming the job, so
// spend questions are answered from the ai_usage table (and the 30-day
// rollup in the status snapshot) instead of guesses. Fire-and-forget:
// recording must never break the feature that made the call.
import { pool } from './db'
import { logError } from './diag'

// $ per 1M tokens (Anthropic first-party API rates). Cache write is 1.25x
// the input rate (5-minute TTL), cache read is 0.1x.
const RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

export type UsageLike = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export function computeCostUsd(model: string, u: UsageLike): number | null {
  const rate = RATES[model]
  if (!rate) return null
  const input = u.input_tokens ?? 0
  const output = u.output_tokens ?? 0
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  const cacheRead = u.cache_read_input_tokens ?? 0
  return (
    (input * rate.input +
      cacheWrite * rate.input * 1.25 +
      cacheRead * rate.input * 0.1 +
      output * rate.output) /
    1_000_000
  )
}

export function recordAiUsage(args: {
  source: string
  model: string
  usage: UsageLike | null | undefined
  projectId?: string | null
}): void {
  const u = args.usage
  if (!u) return
  void (async () => {
    try {
      await pool.query(
        `INSERT INTO ai_usage
           (source, model, project_id, input_tokens, output_tokens,
            cache_write_tokens, cache_read_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          args.source,
          args.model,
          args.projectId ?? null,
          u.input_tokens ?? 0,
          u.output_tokens ?? 0,
          u.cache_creation_input_tokens ?? 0,
          u.cache_read_input_tokens ?? 0,
          computeCostUsd(args.model, u),
        ],
      )
    } catch (err) {
      logError('ai usage record failed', {
        source: args.source,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()
}
