-- Notable topics — comma-separated list of subjects the show covers
-- ("Career reinvention", "Modern relationships", "Recovery"). Renders
-- on the public one-sheet + fed into Claude when writing outreach so
-- pitches connect the guest to a topic the show actually explores.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS notable_topics TEXT;
