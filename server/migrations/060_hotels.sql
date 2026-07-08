-- Hotel budgeting driven by per-day location tags.
--
-- Every shoot day gets an optional location tag (e.g. "LA", "Solvang").
-- The budget stores which tag is "home" — days at home don't need
-- hotels; days anywhere else do. Nightly rates × per-diem headcount ×
-- number of hotel-required days = total hotel cost.
--
-- For BIYA: home_location_tag = 'LA'. Tag 7 days as 'LA' (no hotels)
-- and 14 as 'Solvang' (hotels). Slate handles the multiplication.

ALTER TABLE shoot_days
  ADD COLUMN IF NOT EXISTS location_tag TEXT;

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS home_location_tag TEXT,
  ADD COLUMN IF NOT EXISTS hotel_cast_nightly NUMERIC(9,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hotel_crew_nightly NUMERIC(9,2) DEFAULT 0;
