-- Track when a transfer report's CONTENT last changed (vs merely being
-- re-posted). A fresh reported_at with an old last_progress_at means the
-- job is stopped/paused and the reporter is re-sending an unchanged tail —
-- the page should say "paused", not impersonate a live transfer.
ALTER TABLE storage_transfer_reports ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ NOT NULL DEFAULT now();
