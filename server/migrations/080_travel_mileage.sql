-- Travel-day cities + mileage reimbursement.
--
-- A travel day records where the company drives FROM and TO plus the
-- round-trip miles for that leg. Mileage reimbursement lands on the travel
-- day and is paid to everyone traveling:
--
--   mileage = rate_per_mi × round_trip_miles × (cast headcount + crew headcount)
--
-- Rate is a budget-level policy (IRS standard business rate ≈ $0.70/mi in
-- 2026); miles are per travel leg since different moves are different
-- distances. The destination (travel_to) also drives that night's hotel +
-- per diem via the existing location_tag rule.

ALTER TABLE shoot_days
  ADD COLUMN IF NOT EXISTS travel_from  TEXT,
  ADD COLUMN IF NOT EXISTS travel_to    TEXT,
  ADD COLUMN IF NOT EXISTS travel_miles NUMERIC(8,1);

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS mileage_rate_per_mi NUMERIC(6,3) DEFAULT 0.70;

UPDATE budgets SET mileage_rate_per_mi = 0.70 WHERE mileage_rate_per_mi IS NULL;
