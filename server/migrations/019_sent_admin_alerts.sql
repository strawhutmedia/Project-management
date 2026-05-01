-- Persistent dedupe for admin alert emails. Without this, the in-memory
-- Map in email.ts resets on every Railway redeploy and the scheduler's
-- 30-second startup tick re-fires already-sent digests.
CREATE TABLE IF NOT EXISTS sent_admin_alerts (
  key text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
