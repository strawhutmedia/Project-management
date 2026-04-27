-- Per-song (channel-level) access. A user with no project_members row but
-- with a song_members row can see ONLY that specific song.
-- A user with a project_members row sees the whole project regardless.
CREATE TABLE IF NOT EXISTS song_members (
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_song_members_user ON song_members(user_id);
