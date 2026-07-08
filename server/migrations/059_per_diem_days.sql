-- Per diem "days" per side. Shoot days = # of days actually filming.
-- Per diem days can be higher: travel day in, hold days between shoots,
-- travel day out. On BIYA (Solvang), crew is likely on location for
-- shoot_days + 2 travel + a couple hold days ≈ 25 days, but cast may
-- only be there for their specific scenes.
--
-- Default = shoot_days. Operator bumps up per side as needed.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS cast_per_diem_days INTEGER,
  ADD COLUMN IF NOT EXISTS crew_per_diem_days INTEGER;
