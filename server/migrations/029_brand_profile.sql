-- Per-show "Slate's read on this show" brand profile.
--
-- A single JSONB blob holds Claude's most recent analysis: brand voice
-- description, example post styles, suggested posting times, suggested
-- cadence per kind, suggested default assignees. We cache the blob so
-- the project page can re-render without re-calling Claude; the user
-- regenerates it explicitly when they want a fresh read.
--
-- Adoption stays decoupled: the card has per-field Accept buttons that
-- write into the existing socials_* columns. The blob itself is just
-- the suggestion, not the source of truth.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS socials_brand_profile jsonb,
  ADD COLUMN IF NOT EXISTS socials_brand_profile_at timestamptz;
