-- Scene <-> budget linking + script breakdown storage.
--
-- A budget line item can optionally attach to a scene (props, location, SFX,
-- vehicles, extras, day-player rates). Above-the-line and project-level
-- categories stay scene_id IS NULL. ON DELETE SET NULL so deleting a scene
-- doesn't wipe attached cost rows.
ALTER TABLE budget_line_items
  ADD COLUMN IF NOT EXISTS scene_id UUID REFERENCES scenes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budget_line_items_scene ON budget_line_items(scene_id);

-- Cache scene body text from .fdx so Claude can analyze it for cost items
-- without re-parsing. Also track when we last ran the breakdown so the UI
-- can show "Last analyzed 2 days ago".
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS action_text TEXT;
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS breakdown_run_at TIMESTAMPTZ;
