-- Locations: a persistent, nestable list of a film's shooting locations.
-- Auto-seeded from distinct scenes.location_tag, but the user can rename
-- them and drag one location under another as a sub-location (parent_id).
-- Shooting-day counts are computed live from scenes at query time.
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,                       -- matches scenes.location_tag
  name TEXT NOT NULL,                      -- display name (editable)
  parent_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_locations_project ON locations(project_id, position);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
