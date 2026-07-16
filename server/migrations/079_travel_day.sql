-- Travel days on the stripboard.
--
-- A shoot_day can now be a TRAVEL day: not a shoot, not a day off, but a
-- company move (e.g. drive LA -> Solvang the day before the shoot starts).
-- Travel days carry per diem / hotels / mileage but hold no scenes, and
-- render distinctly from both shoot days and break days.
--
-- BIYA gets a travel Day 1 (LA -> Solvang) prepended in the seed; every
-- existing shoot day slides +1 there. This column just makes the type
-- expressible for every project.

ALTER TABLE shoot_days
  ADD COLUMN IF NOT EXISTS is_travel BOOLEAN NOT NULL DEFAULT false;
