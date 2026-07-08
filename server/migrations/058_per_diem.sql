-- Per diem for cast + crew when the shoot is on location.
-- Solvang for BIYA — the crew's not sleeping at home, so meals + a
-- small stipend get budgeted separately from wages.
--
-- We store daily rates (per person per day). The top sheet + budget
-- summary render an estimated total using shoot_days as the day count
-- and a headcount the operator sets separately. If either headcount is
-- 0, that side contributes 0 — no need to disable per diem entirely,
-- just leave headcount empty.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS cast_per_diem_daily NUMERIC(9,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crew_per_diem_daily NUMERIC(9,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cast_per_diem_headcount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crew_per_diem_headcount INTEGER DEFAULT 0;
