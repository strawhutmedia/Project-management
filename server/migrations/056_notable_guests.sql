-- Notable past guests — a comma-separated list rendered as social
-- proof on the show's public one-sheet AND fed into Claude when it
-- writes unique sentences for outreach ("you'd join names like…").
--
-- Freeform text rather than a normalized table because the operator
-- just wants to paste 5-10 names as a single field, not manage rows.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS notable_guests TEXT;
