-- Contractor invoicing — Ryan's payroll tool. Turns a freelancer's monthly
-- hours into a saved, numbered invoice with a clear total to pay by credit
-- card via Melio (Melio charges the card, pays the contractor by ACH/check).
-- Admin-only feature; money is stored in integer cents to avoid float drift.

-- Company/branding + invoice numbering. Single-row table (id is pinned to 1).
CREATE TABLE IF NOT EXISTS invoice_settings (
  id INT PRIMARY KEY DEFAULT 1,
  company_name TEXT NOT NULL DEFAULT 'Straw Hut Media',
  company_email TEXT NOT NULL DEFAULT 'ryan@strawhutmedia.com',
  company_address TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT,                        -- data: URI of the uploaded logo
  invoice_prefix TEXT NOT NULL DEFAULT 'SHM',
  next_number INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_settings_singleton CHECK (id = 1)
);
INSERT INTO invoice_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Saved freelancers/contractors. Set up once, then invoiced in seconds.
CREATE TABLE IF NOT EXISTS contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  hourly_rate_cents INT NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT 'ACH' CHECK (pay_method IN ('ACH', 'Check', 'Other')),
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contractors_archived ON contractors(archived);

-- Invoices. Line items are stored as JSONB:
--   [{ "desc": string, "hours": number, "rateCents": int, "amountCents": int }]
-- Contractor details are snapshotted onto the invoice so historical invoices
-- stay accurate even if the contractor is later edited or removed.
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL,
  contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  contractor_name TEXT NOT NULL DEFAULT '',
  contractor_email TEXT NOT NULL DEFAULT '',
  contractor_address TEXT NOT NULL DEFAULT '',
  pay_method TEXT NOT NULL DEFAULT 'ACH',
  period TEXT NOT NULL DEFAULT '',
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  line_items JSONB NOT NULL DEFAULT '[]',
  total_cents INT NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft', 'unpaid', 'paid')),
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(number);
CREATE INDEX IF NOT EXISTS idx_invoices_contractor ON invoices(contractor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at DESC);
