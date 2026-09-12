-- One "these recordings need QA today" digest email per PT day, enforced
-- with a UNIQUE date so Railway redeploys can't double-send (same pattern
-- as socials_autopilot_runs).
CREATE TABLE IF NOT EXISTS qa_digest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL UNIQUE,
  recording_count INTEGER NOT NULL DEFAULT 0,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
