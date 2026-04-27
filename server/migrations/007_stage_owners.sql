-- Per-stage assignees on each song.
-- Producer and Mixer are already on the songs table; add the other 5.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS writer_id UUID REFERENCES users(id);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS tracker_id UUID REFERENCES users(id);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS overdub_id UUID REFERENCES users(id);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS stems_id UUID REFERENCES users(id);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS master_id UUID REFERENCES users(id);
