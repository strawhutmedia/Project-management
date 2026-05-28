-- AI clip generation via OpusClip. A clip_job is one submission to
-- OpusClip's /clip-projects endpoint (one video → many clips). The
-- clips table holds each individual exportable clip OpusClip returns
-- (preview URL + download URL + thumbnail + AI score).
CREATE TABLE IF NOT EXISTS clip_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  song_id uuid REFERENCES songs(id) ON DELETE SET NULL,
  dropbox_path text NOT NULL,
  file_name text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  opus_project_id text,
  opus_org_id text,
  error text,
  raw_create_response jsonb,
  last_polled_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_jobs_song
  ON clip_jobs(song_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES clip_jobs(id) ON DELETE CASCADE,
  opus_clip_id text,
  title text,
  duration_seconds numeric,
  preview_url text,
  download_url text,
  thumbnail_url text,
  score numeric,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clips_job ON clips(job_id);
