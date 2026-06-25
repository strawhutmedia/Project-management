-- Lightweight presence: who's actively viewing/editing a project right
-- now. Frontend pings POST /presence/heartbeat every 30 seconds while
-- the project page is open. The "Who's here" bar shows users whose
-- last_seen_at is within the last 90 seconds.
--
-- Not a full collaboration layer (no live cursors, no per-field
-- locking) — just enough so when Ryan and Alex are both pricing the
-- budget on a video call, they can SEE that the other is also in there
-- and read each other's edits via the 15-second auto-refresh.

CREATE TABLE IF NOT EXISTS project_presence (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_section TEXT, -- optional: 'budget' | 'stripboard' | 'scene-12' etc.
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_presence_recent
  ON project_presence(project_id, last_seen_at DESC);
