-- Workspace-wide social content scheduler.
--
-- The team generates IG/FB content per podcast episode (social_plans), then
-- explicitly pushes individual items into the scheduler. The scheduler holds
-- a pre-seeded grid of N slots per day per kind, each with a default PT
-- time, that items can be dragged into.
--
-- Why slots are stored, not derived: we want stable per-slot scheduled
-- times that the team can override individually, and we want UNIQUE
-- (day_date, kind, slot_index) so a slot survives item moves.
--
-- Items themselves still live as JSONB inside social_plans.items. The
-- "pushed to scheduler" flag is stored on the JSON item itself (key
-- pushed_to_scheduler_at); backlog = items where that key is set AND
-- the item is not currently referenced by any non-null slot row.

CREATE TABLE IF NOT EXISTS scheduler_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text_post', 'photo_concept', 'reel_concept', 'story_concept')),
  slot_index integer NOT NULL,
  -- PT time-of-day; stored without tz because Pacific is the canonical
  -- posting timezone for this workspace.
  scheduled_time time NOT NULL,
  -- Item reference via (plan_id, item_id). NULL when the slot is empty.
  plan_id uuid REFERENCES social_plans(id) ON DELETE SET NULL,
  item_id uuid,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'posted', 'skipped')),
  platforms text[] NOT NULL DEFAULT ARRAY['instagram', 'facebook']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day_date, kind, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_scheduler_slots_day ON scheduler_slots(day_date);
CREATE INDEX IF NOT EXISTS idx_scheduler_slots_item ON scheduler_slots(plan_id, item_id);
