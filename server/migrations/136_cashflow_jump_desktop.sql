-- Jump Desktop (remote desktop, "Teams Pro", 3 seats) -- found in a Paddle
-- renewal email, was missing from the tracker entirely. Confirmed via real
-- receipts it's billed ANNUALLY, not monthly: Sept 2024 $191.80, Sept 2025
-- renewal $287.70, Sept 2026 renewal $282.71 -- same annual-billing pattern
-- as Dropbox (migration 111). Ryan confirmed keeping the subscription.
-- Monthly-equivalent of the current $282.71/yr renewal: $23.56/mo.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 2356, '2026-08-01', 'Software', 'Jump Desktop',
  'Remote desktop, "Teams Pro" plan, 3 seats. Billed ANNUALLY, not monthly -- this is the monthly-equivalent of the current $282.71/yr renewal (confirmed via real Paddle receipts: Sept 2024 $191.80, Sept 2025 $287.70, Sept 2026 $282.71). Was missing from the tracker entirely until found in a renewal email.',
  true
);
