-- Move clip generation off OpusClip and onto Slate's own ffmpeg cutter.
--
-- Clips are now: Claude picks the moments from the transcript, ffmpeg
-- cuts each as a framed 9:16 vertical with burned captions, and the
-- result lands in Dropbox. So a `clips` row now points at a Dropbox
-- file + its in/out timecodes instead of OpusClip preview/download URLs.
--
-- The old OpusClip columns (opus_clip_id, preview_url, download_url,
-- thumbnail_url, score) stay on the table, unused, so historical rows
-- don't break — new rows just leave them null.
ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS dropbox_path text,
  ADD COLUMN IF NOT EXISTS start_seconds numeric,
  ADD COLUMN IF NOT EXISTS end_seconds numeric,
  ADD COLUMN IF NOT EXISTS vertical boolean,
  ADD COLUMN IF NOT EXISTS captioned boolean;
