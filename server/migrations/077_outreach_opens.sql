-- Email open tracking. Resend fires email.opened events (once open tracking is
-- enabled on the sending domain); we count them per prospect so the operator
-- can see how many times each recipient viewed the email. Opens are
-- approximate — some mail clients (notably Apple Mail Privacy Protection)
-- auto-load the pixel — but they're a useful engagement signal.
ALTER TABLE outreach_prospects
  ADD COLUMN IF NOT EXISTS open_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;
