-- RSS feed integration for podcast projects. Stores the feed URL plus
-- the cover-art URL extracted from the feed so the per-show post
-- template can pull a branded accent color.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS rss_feed_url text,
  ADD COLUMN IF NOT EXISTS cover_art_url text;
