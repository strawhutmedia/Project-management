-- One-time guard so the detailed BIYA budget (Ryan's real cast/crew/gear
-- amounts) can be applied to the live project exactly once. Without this,
-- re-applying on every boot would re-stamp defaults over a "Reset all
-- prices". Once applied, it never re-runs — a reset stays reset.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS detailed_budget_applied boolean NOT NULL DEFAULT false;
