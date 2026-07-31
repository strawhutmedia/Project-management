-- Cache each show's auto-derived carousel design (palette + wordmark), so the
-- look is modeled from the show's own cover art instead of a single hardcoded
-- preset. Derived once from the cover via Claude vision, re-derivable on demand.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS carousel_preset jsonb;
