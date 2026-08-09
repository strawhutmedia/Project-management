-- Faceless YouTube channels — a separate top-level area in Slate, distinct
-- from album/podcast/film projects. A channel owns a LOCKED art style and a
-- recurring cast of characters, and produces episodes made of scenes.
--
-- This is Phase 1: the creative workspace (style bible, characters, scripts,
-- and the copy-ready prompt blocks that get pasted into an AI video tool).
-- The LongStories.ai generation pipeline is a later migration, added once an
-- API key is provisioned on the service (per the "no new external service
-- without approval" rule in CLAUDE.md).

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subtitle TEXT,
  premise TEXT,                 -- one-paragraph show premise / logline
  audience TEXT,                -- e.g. "Little kids, ages 3–6"
  art_style TEXT,               -- the LOCKED visual-style block for the generator
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,                    -- "Main character", "Best friend (comic relief)", "Mentor"
  look_lock TEXT,               -- the LOCKED visual description fed to the generator
  personality TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  episode_number INT,
  title TEXT NOT NULL,
  feeling TEXT,                 -- "calm" | "silly" | "adventurous" | ...
  logline TEXT,
  youtube_title TEXT,
  thumbnail_concept TEXT,
  short_concept TEXT,
  status TEXT NOT NULL DEFAULT 'script'
    CHECK (status IN ('script', 'generating', 'review', 'published')),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS episode_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES channel_episodes(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  visual TEXT,                  -- image / video prompt for the scene
  narration TEXT,               -- read-aloud narration + character dialogue
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_characters_channel ON channel_characters(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_episodes_channel ON channel_episodes(channel_id);
CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode ON episode_scenes(episode_id);
