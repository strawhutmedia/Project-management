-- Episode cuts + per-cut notes. The centerpiece of podcast (and
-- eventually film) post-production: producers upload a cut, the team
-- and client leave timestamped feedback, the producer iterates, the
-- client approves.
--
-- A "cut" belongs to a song (episodes are songs in our model). It
-- has a label ("Rough cut v1", "Picture lock", "Final mix"), a
-- source URL or Dropbox path, and a status:
--   in_review     — producer uploaded, awaiting feedback
--   needs_changes — client/team asked for revisions
--   approved      — signed off, ready to publish
--   superseded    — a newer cut has replaced this one
--
-- Notes are threaded under each cut. Each note can carry an optional
-- timestamp_ms so feedback like "at 12:34 the audio drops" is
-- linkable / sortable. Notes can be marked resolved so the producer
-- can keep an open punch list.

CREATE TABLE IF NOT EXISTS episode_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  dropbox_path TEXT,
  url TEXT,
  duration_ms INT,
  status TEXT NOT NULL DEFAULT 'in_review'
    CHECK (status IN ('in_review', 'needs_changes', 'approved', 'superseded')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  position INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_episode_cuts_song
  ON episode_cuts(song_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS cut_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cut_id UUID NOT NULL REFERENCES episode_cuts(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  timestamp_ms INT, -- nullable; when set, this note refers to a moment in the cut
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cut_notes_cut
  ON cut_notes(cut_id, created_at ASC);
