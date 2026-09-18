-- Promo moments (Ryan, 2026-09-18): a per-recording list of moments someone
-- saw happen while shooting that they want cut into promos. Entered by the
-- person logging the recording or by a producer later — one row per moment,
-- deliberately separate entries (not a blob in notes) so the promo cutter
-- can work through them one by one and each carries who called it out.
CREATE TABLE IF NOT EXISTS qa_promo_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES qa_recordings(id) ON DELETE CASCADE,
  -- What happened ("Guest breaks down laughing telling the tour-bus story").
  description TEXT NOT NULL,
  -- Rough pointer to where it lives — free text, since the crew won't have a
  -- timecode mid-shoot ("~20 min in", "right after the ad break", "00:41:30").
  approx_time TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_promo_moments_rec_idx
  ON qa_promo_moments(recording_id, position);
