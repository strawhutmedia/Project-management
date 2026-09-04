-- Ryan confirmed directly: IndieFilmaking stopped a long time ago. This
-- lines up with real QuickBooks data -- zero invoices anywhere in 2026
-- (Jan-Aug), which had been flagged as a red flag on the last MRR list
-- but not acted on without Ryan's own confirmation. Unlike migration 124
-- (reverted in 125 for acting on inference from an email instead of
-- asking directly), this is Ryan's own direct statement. Flipping to
-- one-time, same treatment as String And Tell (migration 123) -- kept as
-- a historical entry, dropped from the recurring baseline.
UPDATE cashflow_entries
   SET is_recurring = false,
       notes = 'Ryan confirmed directly this client stopped a long time ago. Consistent with real QuickBooks data: zero invoices anywhere in 2026 (Jan-Aug). Kept as a one-time historical entry, not recurring.'
 WHERE counterparty = 'IndieFilmaking' AND kind = 'in' AND occurred_on = '2026-08-01';
