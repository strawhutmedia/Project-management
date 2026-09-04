-- Ariana is an hourly editor ($25/hr) not previously tracked anywhere.
-- Real hours-log totals from her "Ariana // Straw Hut Hours" sheet:
-- May $812.50, June $1,037.50, July $1,187.50 -- steady work on
-- Codestrap/Code x Connor, no crunch spike. ~$1,000/mo average.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 100000, '2026-08-01', 'Staff', 'Ariana',
  'Hourly editor at $25/hr. Real 3-month average from her hours log: $812.50 (May), $1,037.50 (June), $1,187.50 (July). Not a flat retainer -- will vary with hours worked.',
  true
);
