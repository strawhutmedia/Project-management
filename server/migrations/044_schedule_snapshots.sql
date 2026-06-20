-- Named snapshots of a project's stripboard schedule. Lets the producer
-- save "Plan A" before experimenting, then restore it later if a new
-- arrangement turns out to be worse. Stored as JSONB so we don't have
-- to migrate the schema when we add new scene-level scheduling fields.
--
-- Snapshot payload shape:
--   { "shootDays": [{ number, isBreak, shootDate, notes }, ...],
--     "scenes":    [{ number, shootDayNumber, dayPosition, locationStatus, notes }, ...] }
--
-- We key scene assignments by scene NUMBER not UUID, so restoring works
-- correctly even after a re-import where scene UUIDs may have changed
-- (unlikely with the smart upsert, but the JSON snapshot is the source
-- of truth regardless).
CREATE TABLE IF NOT EXISTS schedule_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scene_count INT NOT NULL,
  shoot_day_count INT NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_snapshots_project
  ON schedule_snapshots(project_id, created_at DESC);
