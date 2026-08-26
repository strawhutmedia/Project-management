-- Ryan's original spreadsheet (migration 105) excluded String And Tell and
-- 10 Seconds To Air entirely, on the belief both had stopped/paused. Real
-- QuickBooks data (Sales by Customer Summary, Jan-Aug 2026) tells a
-- different story for each:
--
-- String And Tell is billed under the host's name, Tawny Platis (confirmed
-- via the "monthly retainer" language in Ryan's own April 2026 email to her,
-- and the "String And Tell Hours 2026" sheet Silvana logs against). Real
-- QuickBooks sales: a rock-steady $2,450/mo for all 8 months of 2026
-- (Jan-Aug), no gaps, no dips. This client has NOT stopped -- add it back
-- as a genuine recurring income line.
--
-- 10 Seconds To Air is billed under the host's name, Alita Guillen. Real
-- QuickBooks sales: steady $1,225/mo Feb-Jul 2026 (down from $2,450/mo
-- before Feb, per a Feb 2026 email where Alita asked to cut pace/cost in
-- half and Ryan agreed) -- but Aug 2026 shows $0. This matches "paused for
-- now": real, recent, and likely to resume, but not currently generating
-- income. Deliberately NOT added as a cashflow entry (amount_cents must be
-- > 0) -- re-add at $1,225/mo if/when billing resumes.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, qb_customer_name, notes, is_recurring)
VALUES (
  'in', 245000, '2026-08-01', 'Client payment', 'String And Tell', 'Tawny Platis',
  'Billed under host Tawny Platis. Real QuickBooks sales: steady $2,450/mo every month Jan-Aug 2026, no gaps -- was wrongly excluded from the tracker as "stopped." Silvana also still logs real hours against this client (migration 118).',
  true
);
