-- Per-clip-job user options + raw OpusClip poll response.
--
-- Until now Slate just shipped the video URL and let OpusClip's AI decide
-- everything. The team wants to drive: how many clips, what to focus
-- on, target length. We store the user's preferences so the request
-- can be reproduced / debugged, and we store the most recent raw
-- OpusClip poll response so admins can inspect what the API actually
-- returned (the integration's response shape is still beta-shifting).
ALTER TABLE clip_jobs
  ADD COLUMN IF NOT EXISTS options jsonb,
  ADD COLUMN IF NOT EXISTS raw_poll_response jsonb;
