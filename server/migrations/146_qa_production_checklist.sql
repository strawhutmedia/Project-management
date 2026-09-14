-- QA Production Checklist — the in-app replacement for the "QA PRODUCTION
-- SHEET" Google Sheet Xavier + the interns used to confirm footage was
-- recorded and stored properly. One row per recording session; per-show
-- templates define the expected deliverables (cameras/audio tracks) that
-- get stamped onto each new recording as a real checklist.

-- Per-show expected deliverables (e.g. "Full Interview Host Camera" with
-- spec "Wide & Close Up", or "Top View camera" / "Should be recorded in 4K").
CREATE TABLE IF NOT EXISTS qa_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_checklist_items_project_idx
  ON qa_checklist_items(project_id, position);

-- One row per recording session (what used to be a sheet row).
CREATE TABLE IF NOT EXISTS qa_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The show. Nullable so one-off studio rentals ("Peerspace Booking,
  -- Andrea B.") can still be logged.
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  record_date DATE,
  upload_time TEXT NOT NULL DEFAULT '',
  recording_type TEXT NOT NULL DEFAULT '',     -- In person / Riverside / Zoom / Audio only
  resolution TEXT NOT NULL DEFAULT '',         -- 1080 / 4K / 8K / 1080 + 4K / Audio only
  audio_folder TEXT NOT NULL DEFAULT '',
  audio_card TEXT NOT NULL DEFAULT '',
  video_card TEXT NOT NULL DEFAULT '',
  dropbox_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'flagged', 'cancelled')),
  qa_by UUID REFERENCES users(id) ON DELETE SET NULL,
  qa_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_recordings_date_idx ON qa_recordings(record_date DESC);
CREATE INDEX IF NOT EXISTS qa_recordings_project_idx ON qa_recordings(project_id);
CREATE INDEX IF NOT EXISTS qa_recordings_status_idx ON qa_recordings(status);

-- Who shot it — real Slate accounts, several per recording
-- ("Alise/Sydney/Xavier" in the old sheet).
CREATE TABLE IF NOT EXISTS qa_recording_shooters (
  recording_id UUID NOT NULL REFERENCES qa_recordings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, user_id)
);

-- The checklist stamped onto a specific recording (seeded from the show's
-- qa_checklist_items at creation; ad-hoc items can be added per recording).
CREATE TABLE IF NOT EXISTS qa_recording_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES qa_recordings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  checked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS qa_recording_checks_rec_idx
  ON qa_recording_checks(recording_id, position);
