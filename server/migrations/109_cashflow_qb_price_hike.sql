-- QuickBooks Online jumped from $55/mo to $189/mo on Ryan's card -- a real,
-- confirmed increase (not a promo/renewal quirk he wants investigated
-- further before we book it). Correct the seeded August expense line to
-- match reality so the recurring baseline stays accurate.
UPDATE cashflow_entries
   SET amount_cents = 18900,
       notes = 'Jumped from $55/mo -- confirmed real, cause under investigation (likely a promo period ending or plan change)'
 WHERE counterparty = 'Quickbooks' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01';
