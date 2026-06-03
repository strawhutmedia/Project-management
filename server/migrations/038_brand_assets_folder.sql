-- Per-show "brand assets" folder — a Dropbox path that contains guest
-- headshots, logos, BTS photos, etc. that the team has already curated.
-- The social-plan generator lists what's in this folder and tells
-- Claude which assets exist so image_direction can reference real
-- files instead of describing photos that need to be shot from
-- scratch.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS brand_assets_folder text;
