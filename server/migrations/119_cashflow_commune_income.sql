-- Commune was completely missing from the income tracker despite absorbing
-- real, heavy hours from Ryan Alva, Mara, and Silvana. Ryan confirmed it's
-- a real paying client (~$3k/mo). Real numbers from actual QuickBooks
-- payment-received receipts in email:
--   - Base "Monthly Commune Podcast Services": $2,250 (most recent, Jul 30)
--   - "Commune - Audio Episode" invoices: billed separately/irregularly,
--     most recent $945
-- Combined recurring estimate: $3,195/mo. NOTE: there's a separate,
-- unresolved $2,000 credit Straw Hut owes Commune (an accidental Sept 2025
-- ACH double-charge that was never refunded) which Commune has been
-- deducting from invoice payments themselves -- that's a one-time
-- reconciliation issue, not part of the recurring monthly figure.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'in', 319500, '2026-08-01', 'Client payment', 'Commune',
  'Base retainer ($2,250/mo, "Monthly Commune Podcast Services") + audio episode edits (billed irregularly, recent invoice $945). Was missing from the tracker entirely despite absorbing real hours from Ryan Alva, Mara, and Silvana. Separately: Straw Hut still owes Commune a $2,000 credit from a Sept 2025 billing error, being worked off via invoice deductions -- not reflected here, a one-time reconciliation item.',
  true
);
