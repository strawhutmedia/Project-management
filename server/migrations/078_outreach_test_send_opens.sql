-- Make test-sends verifiable for open tracking without polluting real contact
-- stats. A test-send now logs an outreach_sends row flagged is_test; when its
-- open event arrives, we count it on the SEND row (open_count) instead of the
-- prospect — so "did my test get opened?" is answerable, but a real contact's
-- "Viewed N×" only ever reflects genuine campaign sends.
ALTER TABLE outreach_sends
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;
