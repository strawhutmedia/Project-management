-- Shared production resources — locations, characters, props, vehicles
-- that appear in multiple scenes. Cost is recorded ONCE and shown on
-- every scene where the resource is used, so the producer can edit
-- "Hospital location: $4000 / 2 days" from any of the 17 hospital
-- scenes and the change propagates.
--
-- Two new fields on budget_line_items:
--   resource_type — 'LOCATION' | 'CHARACTER' | 'PROP' | 'WARDROBE' |
--                   'VEHICLE' | 'PICTURE_CAR' | 'WEAPON' | 'ANIMAL' |
--                   'EQUIPMENT' | 'SFX' | 'VFX' | 'CATERING' | 'OTHER' | NULL
--   resource_key  — normalized identifier within the project, e.g.
--                   'kendricks_house', 'officer_miller', 'hero_pistol'
--                   For LOCATION, matches scenes.location_tag.
--                   For CHARACTER, matches normalize(scenes.characters[i]).
--
-- When BOTH resource_type and resource_key are set on a line item,
-- the item is "shared." Auto-link to scenes:
--   LOCATION : resource_key = scenes.location_tag → show on those scenes
--   CHARACTER: resource_key in normalize(scenes.characters) → show
--   other    : explicit junction (scene_budget_items below)
--
-- A line item can EITHER have a scene_id (one-off, single scene) OR
-- a resource_type+resource_key (shared across scenes). The flat
-- budget view counts each shared item once regardless of how many
-- scenes reference it.

ALTER TABLE budget_line_items
  ADD COLUMN IF NOT EXISTS resource_type TEXT,
  ADD COLUMN IF NOT EXISTS resource_key TEXT;

CREATE INDEX IF NOT EXISTS idx_budget_line_items_resource
  ON budget_line_items(resource_type, resource_key)
  WHERE resource_type IS NOT NULL;

-- For shared resources that DON'T auto-link by tag (props, vehicles,
-- equipment) the producer explicitly attaches them to scenes. This
-- junction holds those manual attachments.
CREATE TABLE IF NOT EXISTS scene_budget_items (
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  budget_line_item_id UUID NOT NULL REFERENCES budget_line_items(id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, budget_line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_scene_budget_items_item
  ON scene_budget_items(budget_line_item_id);
