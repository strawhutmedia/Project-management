-- Travel leg duration (one-way drive time, hours).
--
-- Crew travel-day pay is rule-based on drive time:
--   under 4 hours  -> crew paid HALF day
--   4 hours or more -> crew paid FULL day
-- Cast are always full on travel days (SAG distant-location rule).
--
-- Auto-filled from the city-center distance table alongside miles
-- (LA <-> Solvang ≈ 2.5 hr); editable per leg.

ALTER TABLE shoot_days
  ADD COLUMN IF NOT EXISTS travel_hours NUMERIC(4,1);
