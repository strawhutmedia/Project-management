-- Vault verification runs, fired by the "Verify against vault" button on the
-- Storage page. The server compares a drive's census file (in _INVENTORY/)
-- or the wave-1 Dropbox targets file-by-file against the S3 vault listing —
-- Ryan clicks a button, no terminal. Every run is kept as an audit trail;
-- the dashboard shows the latest per row.

CREATE TABLE IF NOT EXISTS storage_verify_runs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verdict TEXT NOT NULL,
  files_expected INTEGER NOT NULL,
  files_matched INTEGER NOT NULL,
  tier2_matches INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL,
  -- up to 20 missing paths for a drive run; per-target verdicts for wave-1
  detail JSONB
);

CREATE INDEX IF NOT EXISTS idx_storage_verify_runs_name ON storage_verify_runs (name, run_at DESC);
