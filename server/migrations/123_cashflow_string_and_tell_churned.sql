-- Ryan confirmed: the $2,450 August payment (migration 121) was String And
-- Tell's LAST bill -- the client is ending, not continuing. The real
-- QuickBooks history (steady Jan-Aug) was correct, but it was the tail end
-- of the relationship, not evidence it would keep going. Flip to one-time
-- so it drops out of the recurring baseline; Silvana's remaining hours
-- against this client (migration 118) should wind down accordingly.
UPDATE cashflow_entries
   SET is_recurring = false,
       notes = 'Billed under host Tawny Platis. Real QuickBooks sales were a steady $2,450/mo Jan-Aug 2026, but Ryan confirmed August was the final bill -- client has ended. Kept as a one-time August entry, not recurring. Silvana''s hours against this client (migration 118) should wind down.'
 WHERE counterparty = 'String And Tell' AND kind = 'in' AND occurred_on = '2026-08-01';
