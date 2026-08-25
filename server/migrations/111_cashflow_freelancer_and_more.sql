-- More corrections from real receipts, per Ryan's follow-up: he confirmed
-- "Sales Team" was always the OutboundLabs outbound-sales cost (not a
-- separate person), and confirmed Muhammad, Daniel, Alaa, Uzair, and Sajid
-- are all paid via Freelancer.com rather than a flat retainer.

-- "Sales Team $2,500" and OutboundLabs (migration 110, $1,500) are the same
-- expense -- Ryan confirmed "Sales team = outbound". Remove the old
-- guessed line so it isn't double-counted against the real invoiced amount.
DELETE FROM cashflow_entries
 WHERE counterparty = 'Sales Team' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Muhammad is paid via Freelancer.com (username UMERM41), consistently
-- $120/week across every week checked (Jul-Aug 2026) -- $520/mo real
-- average vs. the $480 flat guess on the sheet.
UPDATE cashflow_entries
   SET amount_cents = 52000,
       notes = 'Paid via Freelancer.com (UMERM41), consistently $120/wk -- this is the monthly average, not a fixed retainer'
 WHERE counterparty = 'Muhammad' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Daniel is paid via Freelancer.com (username freedaniel2) across multiple
-- concurrent projects, highly variable week to week. Trailing 6-week
-- average from real payment receipts: ~$1,190/mo, well above the flat
-- $840 guess on the sheet.
UPDATE cashflow_entries
   SET amount_cents = 119000,
       notes = 'Paid via Freelancer.com (freedaniel2), multiple projects -- 6-week average from real receipts; will vary month to month with hours worked'
 WHERE counterparty = 'Daniel' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Trojan Storage of Glendale, Unit #2358 -- physical storage unit, not on
-- the original spreadsheet at all. Autopay confirmed at a steady $290/mo
-- every month January through August 2026.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 29000, '2026-08-01', 'Storage', 'Trojan Storage of Glendale',
  'Unit #2358, autopay confirmed steady at $290/mo Jan-Aug 2026. Not on the original spreadsheet.',
  true
);

-- Anthropic (Claude) -- pay-as-you-go API auto-recharge, not a flat
-- subscription. ~4 charges of $20 each over the last 53 days (~2.3/mo) ->
-- roughly $45/mo, but this will fluctuate with usage.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 4500, '2026-08-01', 'Software', 'Anthropic (Claude)',
  'Pay-as-you-go auto-recharge (~$20 every 2-3 weeks), not a flat subscription -- estimate from recent receipts, will vary with usage',
  true
);
