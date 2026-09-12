-- QA recordings: store the Dropbox folder as a real path (picked with the
-- in-app folder picker) alongside the legacy pasted share link. The path is
-- what downstream automation (the Premiere assembly machine, which has the
-- Dropbox folder synced locally) actually needs.
ALTER TABLE qa_recordings ADD COLUMN IF NOT EXISTS dropbox_path TEXT NOT NULL DEFAULT '';
