-- Socials autopilot: fully automated daily content generation, with a
-- hard human QA gate before anything goes live.
--
-- Each morning (per-show configurable PT hour) the autopilot loop
-- generates the day's draft content from the show's strategy docs +
-- 30-day calendar + recent episodes, drops the items into the show's
-- freeform social plan, assigns them to today's scheduler slots, and
-- emails the admin a QA digest. Slate NEVER posts anywhere — a human
-- reviews in the Scheduler and flips slots to 'posted' after manually
-- publishing.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS socials_autopilot_enabled boolean NOT NULL DEFAULT false,
  -- PT hour (0-23) at which the daily generation fires.
  ADD COLUMN IF NOT EXISTS socials_autopilot_hour integer NOT NULL DEFAULT 6,
  -- PT date autopilot was (last) enabled — day 1 of the rolling 30-day
  -- calendar cycle. Re-enabling resets the cycle.
  ADD COLUMN IF NOT EXISTS socials_autopilot_started_on date;

-- One row per (project, PT date) attempt. The UNIQUE constraint is the
-- restart-safety mechanism: the loop INSERTs ... ON CONFLICT DO NOTHING
-- and only proceeds when its insert won, so a redeploy mid-morning can
-- never double-generate a day's content.
CREATE TABLE IF NOT EXISTS socials_autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'done', 'failed')),
  error text,
  -- The freeform plan the items were appended to, and which items.
  plan_id uuid REFERENCES social_plans(id) ON DELETE SET NULL,
  item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Which 30-day-calendar day (1-30) drove the content, if a calendar
  -- doc existed at generation time.
  calendar_day integer,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, run_date)
);

CREATE INDEX IF NOT EXISTS idx_socials_autopilot_runs_project
  ON socials_autopilot_runs(project_id, run_date DESC);
