-- Archive the raw .fdx XML on every upload so we never lose access to
-- the source material. Final Draft files are small (typically <500KB)
-- and the parser evolves — re-parsing later lets us extract richer
-- data (action text, dialogue, transitions) without asking the producer
-- to re-upload.
--
-- One row per upload, newest first. We keep history so we can see how
-- the script changed across drafts.
CREATE TABLE IF NOT EXISTS project_script_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_name TEXT,
  byte_size INT NOT NULL,
  scene_count INT NOT NULL,
  xml TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_script_uploads_project
  ON project_script_uploads(project_id, uploaded_at DESC);
