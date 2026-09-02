-- "Seen on the Screen" (billed in QuickBooks as Universal Pictures) --
-- Ryan confirmed directly this is a real steady monthly retainer, plus
-- separate travel/expense-reimbursement invoices layered on top (they
-- travel together often; Ryan gets reimbursed for real trip costs). That
-- explains why the raw QuickBooks customer-level total looked lumpy
-- (Jan $28,900 = 2x base, likely Jan+Feb invoiced together; Mar $15,398.14
-- and May $15,950 = base + small reimbursement; Jul $31,274.58 = base +
-- a large trip reimbursement; Apr/Jun/Aug = clean $14,450 base alone) --
-- it was never actually unstable, just co-mingled with pass-through
-- expense billing at the customer level.
--
-- Correcting the tracked amount to match the real base retainer exactly:
-- real invoiced base is $14,450.00/mo, not the $14,500.00 on the original
-- spreadsheet seed (migration 105) -- a small $50/mo overstatement.
UPDATE cashflow_entries
   SET amount_cents = 1445000,
       notes = 'Billed in QuickBooks as "Universal Pictures." Real steady base retainer confirmed by Ryan: $14,450/mo (corrects a $50/mo overstatement from the original spreadsheet''s $14,500 guess). Separate, non-recurring travel/expense-reimbursement invoices are billed to the same customer on top of the base when they travel together, which is why the raw QuickBooks customer-level monthly total looks lumpy (e.g. $31,274.58 in Jul) -- the base itself is steady.'
 WHERE counterparty = 'Seen on the Screen' AND kind = 'in' AND occurred_on = '2026-08-01';
