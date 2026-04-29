-- Scenes (parsed from .fdx) and shoot days for the stripboard view.
-- A scene belongs to at most one shoot_day. Position within day determines
-- order. Drag-drop reordering updates these two fields atomically.

CREATE TABLE IF NOT EXISTS shoot_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INT NOT NULL,                  -- e.g. 1..21 (includes break days)
  is_break BOOLEAN NOT NULL DEFAULT false,
  shoot_date DATE,                      -- optional calendar date
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_shoot_days_project ON shoot_days(project_id, number);

CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number TEXT NOT NULL,                 -- "1", "78", "124A", "150A"
  script_position INT NOT NULL,         -- script order (immutable)
  slug TEXT NOT NULL,                   -- raw heading
  int_ext TEXT,                         -- 'INT' | 'EXT' | 'INT/EXT'
  location TEXT,
  location_tag TEXT,                    -- normalized: 'kendricks_house'
  time_of_day TEXT,                     -- 'DAY' | 'NIGHT' | 'SUNSET' | etc.
  page INT,
  page_eighths INT NOT NULL DEFAULT 0,  -- length in eighths
  characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  -- Stripboard placement
  shoot_day_id UUID REFERENCES shoot_days(id) ON DELETE SET NULL,
  day_position INT NOT NULL DEFAULT 0,
  -- Production breakdown flags
  location_status TEXT NOT NULL DEFAULT 'unset',  -- 'unset' | 'free' | 'paid'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id, script_position);
CREATE INDEX IF NOT EXISTS idx_scenes_day ON scenes(shoot_day_id, day_position);
CREATE INDEX IF NOT EXISTS idx_scenes_location ON scenes(project_id, location_tag);
