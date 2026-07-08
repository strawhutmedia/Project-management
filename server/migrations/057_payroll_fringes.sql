-- Cast + crew payroll fringes on the budget. Fringes = SAG P&H,
-- employer FICA/FUTA/SUTA, workers comp, payroll company fee — the
-- 15-35% that stacks on top of every line item labor cost. Two
-- separate percentages because SAG cast fringes (~33%) are much
-- higher than crew (~15% non-union, ~30% IATSE).
--
-- Applied at the top sheet + detailed budget as computed line items,
-- so the operator sees the real total cost of hiring. Editable per
-- show — a non-SAG shoot might use ~15/15, a SAG feature ~33/30.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS cast_payroll_pct NUMERIC(5,2) DEFAULT 33,
  ADD COLUMN IF NOT EXISTS crew_payroll_pct NUMERIC(5,2) DEFAULT 15;

-- Backfill sensible defaults for existing rows.
UPDATE budgets SET cast_payroll_pct = 33 WHERE cast_payroll_pct IS NULL;
UPDATE budgets SET crew_payroll_pct = 15 WHERE crew_payroll_pct IS NULL;
