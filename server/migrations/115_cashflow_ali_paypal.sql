-- Ali (Abdur Rehman) is paid primarily via direct PayPal transfer, not
-- Freelancer.com. Confirmed real completed payments (the "canceled money
-- request" emails are just PayPal's request-then-direct-send workflow --
-- an actual "you sent" receipt follows each one): Feb $1,347.60, Mar
-- $1,428.40, Apr $1,714.20, May $1,393.80, Jun $1,201.60, Jul $1,574.40,
-- Aug $1,386.40. Seven-month average: $1,435.20/mo. His Freelancer.com
-- activity is minor/sporadic and stays folded into the $2,000/mo
-- consolidated Freelancer.com budget (migration 113).
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 143520, '2026-08-01', 'Staff', 'Ali (Abdur Rehman)',
  'Paid via direct PayPal transfer, roughly monthly. 7-month average (Feb-Aug 2026) from real payment receipts: $1,435.20/mo. His Freelancer.com side is minor/sporadic and already covered by the consolidated Freelancer.com budget.',
  true
);
