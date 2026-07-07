-- Public one-sheet page per podcast show. Lives at /shows/<slug> —
-- linked from every guest outreach email so the recipient sees an
-- elegant single-page pitch instead of a PDF attachment.
--
-- We add columns on `projects` itself instead of a separate table
-- because a show has exactly one one-sheet, and every field is optional
-- (unfilled fields just don't render on the page). Keeps the JOIN out
-- of the public request path.
--
-- The `slug` is auto-populated for existing podcast projects from the
-- name (kebab-case). Admins can override by updating the column
-- directly for now — the in-app editor ships with the Outreach tab.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS one_sheet_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hero_tagline TEXT,
  ADD COLUMN IF NOT EXISTS guest_pitch TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS brand_hex TEXT;

-- Backfill slugs for existing podcast projects. Lowercase, spaces to
-- dashes, strip anything non-alphanumeric-or-dash, collapse dashes.
-- Only touch rows where slug is still NULL so re-runs are safe.
UPDATE projects
   SET slug = regexp_replace(
                regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
                '(^-|-$)', '', 'g')
 WHERE slug IS NULL AND kind = 'podcast';

-- Enforce uniqueness after backfill. Partial index so film + music
-- projects (which don't need slugs) don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug
  ON projects (slug) WHERE slug IS NOT NULL;
