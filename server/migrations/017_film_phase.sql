-- Film projects use a simple 3-phase progress (plus a "wrapped" terminal
-- state) instead of the music-stage workflow. Default to pre-production
-- since most films start there.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS film_phase TEXT NOT NULL DEFAULT 'pre'
  CHECK (film_phase IN ('pre', 'production', 'post', 'wrapped'));
