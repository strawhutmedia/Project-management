-- Known counterparty -> real QuickBooks customer name mismatches (Ryan
-- tracks clients by show name, QuickBooks bills the actual contracting
-- entity), and a real recurring client confirmed via QuickBooks invoice
-- history that wasn't on Ryan's original spreadsheet list.
UPDATE cashflow_entries SET qb_customer_name = 'Universal Pictures'
  WHERE counterparty = 'Seen on the Screen' AND qb_customer_name IS NULL;
UPDATE cashflow_entries SET qb_customer_name = 'Lucky Bastards Inc.'
  WHERE counterparty = 'Naked Lunch' AND qb_customer_name IS NULL;

-- Mekanism: $4,000/mo, invoiced monthly since March 2026, paid on time
-- every month through July (only the just-issued August invoice was
-- outstanding at time of check) -- a genuinely steady recurring client.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'in', 400000, '2026-08-01', 'Client payment', 'Mekanism',
  'Confirmed recurring via QuickBooks invoice history (Mar-Aug 2026, paid on time each month)',
  true
);
