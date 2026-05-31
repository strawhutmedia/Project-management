-- Episode release date.
--
-- Slate is a forward-looking project management system: the team's job
-- is to ship the NEXT episode, not catalogue past ones. Each episode
-- (song row) carries its public release date so the UI can sort by
-- "what's coming up", and so the scheduler + AI helpers can anchor
-- their judgments to "the episode releasing this week" instead of
-- whatever's published in RSS.
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS release_date date;

CREATE INDEX IF NOT EXISTS idx_songs_release_date ON songs (release_date);
