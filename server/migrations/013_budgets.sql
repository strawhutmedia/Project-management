-- Budget feature: one budget per project (optional), with the StudioBinder
-- account structure as the canonical layout. Each project can have a single
-- budget that itself has accounts (10-00, 11-00, ...) with line items
-- underneath. Each line item carries the standard math fields (amt, x, rate)
-- AND optional receipt-tracking fields (vendor, dated_at) so the same row
-- format works for planned line items and live actuals.

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'USD',
  shoot_days INT NOT NULL DEFAULT 0,
  bond_pct NUMERIC(5,2) NOT NULL DEFAULT 3,
  contingency_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  code TEXT NOT NULL,           -- e.g. '10-00', '14-00'
  name TEXT NOT NULL,           -- e.g. 'DEVELOPMENT COSTS', 'CAST'
  category TEXT NOT NULL,       -- 'above_line' | 'production' | 'post' | 'other'
  position INT NOT NULL DEFAULT 0,
  UNIQUE (budget_id, code)
);

CREATE TABLE IF NOT EXISTS budget_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
  code TEXT,                    -- optional, e.g. '10-01' (line code under the account)
  description TEXT NOT NULL,
  amt NUMERIC(12,2) NOT NULL DEFAULT 0,
  units TEXT,                   -- 'Days' | 'Weeks' | 'Day' | 'Week' | 'Flat' | 'A' | etc.
  x NUMERIC(8,2) NOT NULL DEFAULT 1,
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Optional receipt-tracking fields. Empty for planned line items;
  -- populated when entering an actual receipt as a line item.
  vendor TEXT,
  dated_at DATE,
  notes TEXT,
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_accounts_budget ON budget_accounts(budget_id, position);
CREATE INDEX IF NOT EXISTS idx_budget_line_items_account ON budget_line_items(account_id, position);
