-- Fix a double-count: the original spreadsheet's flat "Alaa" $400/mo Staff
-- line (migration 105) and "Ali (Abdur Rehman)" $1,435.20/mo (migration
-- 115) are the same person, confirmed by Ryan. Remove the stale flat line
-- now that the real PayPal-based number is tracked.
DELETE FROM cashflow_entries
 WHERE counterparty = 'Alaa' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';
