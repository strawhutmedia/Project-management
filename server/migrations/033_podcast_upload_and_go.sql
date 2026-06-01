-- Podcast upload-and-go flow.
--
-- Once a podcast episode's near-final file lands in Slate, we want
-- Slate to run the rest: transcript via Deepgram, social plan via
-- Claude, clip job via OpusClip (if video). The episode moves through
-- a much smaller status set than the music pipeline:
--
--   processing → ready → posted
--
-- processing: the autopipeline is running (transcript / plan / clips
--             still in flight).
-- ready:      everything generated; SAJ can review, queue, and post.
-- posted:     released. Manual flip from the episode page once all
--             the scheduled slots for this episode have gone live.
--
-- The existing 8-stage `stage` column stays for music + film projects;
-- podcasts ignore it and read processing_state instead. Source file
-- path lets the auto-chain re-trigger jobs (e.g. regenerate transcript)
-- without re-picking the file each time.
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS processing_state text
    CHECK (processing_state IN ('processing', 'ready', 'posted')),
  ADD COLUMN IF NOT EXISTS source_file_path text,
  ADD COLUMN IF NOT EXISTS autopipeline_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS autopipeline_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS autopipeline_error text;

CREATE INDEX IF NOT EXISTS idx_songs_processing_state ON songs (processing_state) WHERE processing_state IS NOT NULL;
