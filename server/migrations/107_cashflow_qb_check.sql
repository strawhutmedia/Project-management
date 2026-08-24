-- Monthly automated check: are Ryan's recurring cash-flow clients actually
-- paid up in QuickBooks? See server/cashflow_payment_check.ts. Runs once a
-- month (day 1-3, restart-safe via cashflow_payment_check_runs) and emails
-- the admin a short digest of anyone with a genuinely overdue invoice --
-- verified at the invoice level, never from the QuickBooks A/R Aging
-- Summary report alone (that report has shown stale data: it flagged
-- invoices as 91+ days overdue that were already paid).

-- Ryan's recurring-income counterparty (e.g. "Seen on the Screen") doesn't
-- always match the actual QuickBooks customer name (e.g. "Universal
-- Pictures", the studio that actually gets billed). This optional override
-- lets the check use the right QuickBooks name; NULL means "use the
-- counterparty name as-is".
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS qb_customer_name TEXT;

CREATE TABLE IF NOT EXISTS cashflow_payment_check_runs (
  run_month TEXT PRIMARY KEY, -- 'YYYY-MM'
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
