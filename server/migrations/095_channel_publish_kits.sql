-- Publish kits for faceless-YouTube episodes. Ryan publishes to YouTube by
-- hand, so Slate's job is to hand him everything he needs, copy-ready: the
-- main video's full metadata, plus first-class "shorts" that each link back
-- to their parent episode's published video.
--
-- A short's description can contain the token {{MAIN_URL}}, which the API
-- substitutes with the episode's youtube_url once it's published (or a
-- "[PASTE MAIN VIDEO URL HERE]" placeholder until then).

ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS yt_description TEXT;
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS yt_tags TEXT;
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS yt_category TEXT;
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS made_for_kids BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS playlist TEXT;
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS pinned_comment TEXT;
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS recommended_publish TEXT;
-- The published main video's URL, pasted back in by Ryan after upload. Once
-- set, it flows into every short's description so the "full episode" link is
-- live.
ALTER TABLE channel_episodes ADD COLUMN IF NOT EXISTS youtube_url TEXT;

CREATE TABLE IF NOT EXISTS episode_shorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES channel_episodes(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,             -- may contain {{MAIN_URL}}
  recommended_publish TEXT,
  made_for_kids BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_shorts_episode ON episode_shorts(episode_id);
