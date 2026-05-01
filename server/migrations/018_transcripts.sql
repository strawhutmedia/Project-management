-- Transcripts created from Dropbox media files via Deepgram.
-- Each transcript belongs to a project (typically podcast) and optionally
-- to a song (= episode in podcast projects). raw_json holds the Deepgram
-- response; edited_blocks holds the user-edited normalized form which is
-- what we render and export to SRT/SCC. start_offset_ms + frame_rate +
-- drop_frame are user-tunable export settings (rev.com-style).
CREATE TABLE IF NOT EXISTS transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  song_id uuid REFERENCES songs(id) ON DELETE SET NULL,
  dropbox_path text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes bigint,
  duration_seconds numeric,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'transcribing', 'done', 'failed')),
  deepgram_request_id text,
  language text NOT NULL DEFAULT 'en',
  raw_json jsonb,
  edited_blocks jsonb,
  start_offset_ms integer NOT NULL DEFAULT 0,
  frame_rate numeric NOT NULL DEFAULT 29.97,
  drop_frame boolean NOT NULL DEFAULT true,
  error text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_project
  ON transcripts(project_id, created_at DESC);
