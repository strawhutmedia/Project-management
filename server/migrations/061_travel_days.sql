-- Travel days buffer for per diem calculations.
--
-- Per diem now auto-calculates from location tags: any day tagged
-- with something != home_location_tag counts. But cast/crew usually
-- also get per diem on travel-in and travel-out days that aren't
-- shoot days themselves. This adds a small buffer field so the
-- operator can bump it by (typically) 2 days.
--
-- Also removes the manual cast_per_diem_days / crew_per_diem_days
-- fields from user control — they're now computed. We keep the
-- columns so existing rows aren't dropped, but the API stops
-- reading them.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS travel_days INTEGER DEFAULT 0;
