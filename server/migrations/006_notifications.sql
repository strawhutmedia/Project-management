-- Per-user notification feed (the bell icon).
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'mention' | 'assigned_task' | 'assigned_song_role' | 'due_soon' | 'overdue'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,                     -- e.g. /projects/:pid/songs/:sid
  song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Idempotency flags for the scheduler.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_overdue BOOLEAN NOT NULL DEFAULT FALSE;
