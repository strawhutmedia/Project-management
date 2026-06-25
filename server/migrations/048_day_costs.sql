-- Day-level budget items. Equipment rentals, crew rates, catering, base
-- camp — costs that belong to a whole shoot day, not a single scene
-- and not the whole project. Producer needed a place to put these
-- without smearing them across every scene's breakdown.
--
-- ON DELETE SET NULL so a shoot day getting deleted leaves the cost
-- as project-level (visible in the flat budget) rather than wiping
-- the producer's work.
ALTER TABLE budget_line_items
  ADD COLUMN IF NOT EXISTS shoot_day_id UUID REFERENCES shoot_days(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budget_line_items_shoot_day
  ON budget_line_items(shoot_day_id);
