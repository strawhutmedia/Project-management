-- Ryan confirmed Uzair is no longer working with Straw Hut Media -- remove
-- the $1,000/mo line so it doesn't keep counting against the recurring
-- expense baseline.
DELETE FROM cashflow_entries
 WHERE counterparty = 'Uzair' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';
