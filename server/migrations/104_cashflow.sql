-- Cash flow tracker — Ryan's owner-only money log. He tells Slate every
-- incoming and outgoing amount; the app keeps a running balance and a
-- month-by-month picture of cash flow. Money is integer cents (no floats).

-- Singleton settings row: the opening balance the running total starts from.
-- Set it once (bank balance on a chosen day), then log every movement after.
CREATE TABLE IF NOT EXISTS cashflow_settings (
  id INT PRIMARY KEY DEFAULT 1,
  starting_balance_cents BIGINT NOT NULL DEFAULT 0,
  starting_date DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_settings_singleton CHECK (id = 1)
);
INSERT INTO cashflow_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One row per money movement. kind 'in' = money received, 'out' = money spent.
CREATE TABLE IF NOT EXISTS cashflow_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cashflow_entries_date ON cashflow_entries(occurred_on);
CREATE INDEX IF NOT EXISTS idx_cashflow_entries_kind ON cashflow_entries(kind);
