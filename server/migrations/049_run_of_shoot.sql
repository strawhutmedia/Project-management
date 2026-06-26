-- "Run of shoot" flag: a budget line item attached to one shoot day
-- can be flagged as spanning the entire production. When true, the
-- item appears on every day's budget view (read-only on the
-- non-source days) but its total cost only counts ONCE toward the
-- project budget.
--
-- Use case: camera package, DP, UPM, sound mixer — costs you pay
-- once for the whole shoot, not per-day. Producer enters the total
-- on Day 1, clicks 🔁 Run of shoot, sees it allocate across every
-- day automatically.
ALTER TABLE budget_line_items
  ADD COLUMN IF NOT EXISTS spans_all_shoot_days BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_budget_line_items_runofshoot
  ON budget_line_items(spans_all_shoot_days)
  WHERE spans_all_shoot_days = TRUE;
