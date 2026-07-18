-- Editable clip captions.
--
-- Captions are burned into the video pixels, so to let the team fix a
-- misspelled name we keep, per clip:
--   - clean_dropbox_path: a caption-FREE copy of the vertical clip, so
--     re-captioning re-burns onto the small clip (fast) instead of
--     re-cutting the whole episode from the source.
--   - captions: the editable caption lines (absolute source seconds +
--     text). Edit the text, re-burn, done.
--   - render_version: bumped each re-render so the Dropbox file path
--     changes and no stale cached copy is served.
ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS captions jsonb,
  ADD COLUMN IF NOT EXISTS clean_dropbox_path text,
  ADD COLUMN IF NOT EXISTS render_version int NOT NULL DEFAULT 0;
