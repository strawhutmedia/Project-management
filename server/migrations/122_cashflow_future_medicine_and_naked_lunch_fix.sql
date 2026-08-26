-- Two corrections from the same QuickBooks Sales by Customer Summary pull
-- that caught String And Tell / 10 Seconds To Air (migration 121).

-- Future Medicine Media: steady $900/mo every month, Jan-Aug 2026 -- a real
-- recurring client that was never on Ryan's original spreadsheet list at all.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'in', 90000, '2026-08-01', 'Client payment', 'Future Medicine Media',
  'Confirmed recurring via QuickBooks: steady $900/mo every month, Jan-Aug 2026. Was missing from the tracker entirely.',
  true
);

-- Naked Lunch (mapped in migration 108 to real QuickBooks customer "Lucky
-- Bastards Inc.") was seeded at $4,333/mo from Ryan's spreadsheet, but real
-- QuickBooks sales show an exact steady $4,375/mo every month, Jan-Aug 2026.
UPDATE cashflow_entries
   SET amount_cents = 437500,
       notes = 'Billed to QuickBooks customer "Lucky Bastards Inc." Real QuickBooks sales: exact steady $4,375/mo every month, Jan-Aug 2026 -- corrects a small ($41.70/mo) undercount from the original spreadsheet seed.'
 WHERE counterparty = 'Naked Lunch' AND kind = 'in' AND occurred_on = '2026-08-01';
