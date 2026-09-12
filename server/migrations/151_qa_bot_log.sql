-- Live status channel for the on-PC Premiere bot. It POSTs what it's doing
-- here (token-authed), so Ryan and Claude both read the bot's progress in
-- Slate instead of relaying a terminal by screenshot.
CREATE TABLE IF NOT EXISTS qa_bot_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'info',   -- info | ok | warn | error
  source TEXT NOT NULL DEFAULT 'premiere-bot',
  message TEXT NOT NULL DEFAULT '',
  data JSONB
);
CREATE INDEX IF NOT EXISTS qa_bot_log_ts_idx ON qa_bot_log(ts DESC);
