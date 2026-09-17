-- Central Anthropic API usage log: one row per messages.create request,
-- tagged with the job that made it, so "what's spending the money" is one
-- query instead of a guess. Written fire-and-forget by server/ai_usage.ts.
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,          -- job tag, e.g. 'autopilot_plan', 'show_chat'
  model TEXT NOT NULL,
  project_id UUID,               -- no FK: usage history survives project deletion
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6)        -- NULL when the model has no rate entry
);
CREATE INDEX IF NOT EXISTS ai_usage_ts_idx ON ai_usage(ts DESC);
CREATE INDEX IF NOT EXISTS ai_usage_source_idx ON ai_usage(source);
