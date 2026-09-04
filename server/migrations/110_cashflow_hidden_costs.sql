-- Real recurring costs found by scanning actual receipts in Gmail, at
-- Ryan's request ("is there something I'm missing on a monthly basis").
-- Two unambiguous fixes applied here; two more (Freelancer.com payments to
-- video editors, and a Trojan Storage unit) are flagged to Ryan directly
-- rather than guessed at, since they risk double-counting existing Staff
-- line items or need a dollar amount this migration doesn't have.

-- Dropbox is billed ANNUALLY, not monthly, and the $100/mo on the sheet
-- was stale. Real renewal (Jun 23, 2026): $1,944/year, 3 licenses,
-- 57,344 GB -- $162/mo equivalent. (For reference, prior years: $864 ->
-- $3,048 -> $3,840 -> this year's $1,944, after apparently right-sizing
-- storage/licenses down.)
UPDATE cashflow_entries
   SET amount_cents = 16200,
       notes = 'Billed annually ($1,944/yr, 3 licenses, 57TB) -- this is the monthly-equivalent, not a real monthly charge'
 WHERE counterparty = 'Dropbox' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01';

-- OutboundLabs, Inc. (AI SDR / cold outbound lead gen) -- confirmed via 6
-- straight months of Ignition billing receipts (Mar-Aug 2026), always
-- $1,500 on the 22nd. Wasn't on Ryan's spreadsheet or in the tracker at
-- all. Note: Slate's own backlog already has a build brief for an
-- in-house cold-outreach replacement -- finishing that could cut this
-- entirely.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 150000, '2026-08-01', 'Sales/Outreach', 'OutboundLabs, Inc.',
  'AI SDR / cold outbound tool, billed via Ignition on the 22nd every month. Not on the original spreadsheet. Slate has an in-house replacement brief already drafted.',
  true
);
