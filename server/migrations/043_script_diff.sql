-- Per-upload script diff summary. Computed at upload time by comparing
-- the new parse to the previous archived upload's parse. Stored as
-- JSONB so the UI can render it without re-running the diff every load.
--
-- Shape:
-- {
--   "added":     [{ "number": "78A", "slug": "...", "location": "...", "characters": [...] }],
--   "removed":   [{ "number": "74",  "slug": "...", "scheduledForDay": 5,
--                   "budgetItemCount": 3, "budgetTotal": 1200 }],
--   "changed":   [{ "number": "12",  "changes": ["LOCATION","ACTION_TEXT"],
--                   "before": {...}, "after": {...} }],
--   "unchanged": 67
-- }
ALTER TABLE project_script_uploads
  ADD COLUMN IF NOT EXISTS diff_against_id UUID REFERENCES project_script_uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS diff_summary JSONB,
  ADD COLUMN IF NOT EXISTS diff_reviewed_at TIMESTAMPTZ;
