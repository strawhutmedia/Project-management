-- Campaign scheduling. Each prospect gets a scheduled_send_at — the instant
-- its email should fire. A durable background loop (every 60s) sends the ones
-- whose time has come, so a campaign scheduled for 5 AM PT survives Railway
-- restarts/deploys (an in-memory timer would silently die before then).
-- Immediate campaigns just set scheduled_send_at = now + jitter, so the same
-- loop drives everything and nothing double-sends.
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_outreach_prospects_due
  ON outreach_prospects (scheduled_send_at)
  WHERE status = 'queued' AND scheduled_send_at IS NOT NULL;
