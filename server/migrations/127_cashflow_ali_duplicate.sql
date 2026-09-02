-- Fix another double-count in the same family as migration 116: the
-- original spreadsheet's flat "Ali" $1,800/mo "Motion graphics" Staff line
-- (migration 105, never independently verified) and "Ali (Abdur Rehman)"
-- $1,435.20/mo (migration 115, built from 7 months of real PayPal payment
-- receipts) are the same person, confirmed by Ryan directly. Remove the
-- stale unverified flat line now that the real PayPal-based number is
-- tracked -- same pattern as the "Alaa" duplicate removed in 116.
DELETE FROM cashflow_entries
 WHERE counterparty = 'Ali' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';
