-- Verification pass on the last three unverified flat spreadsheet guesses
-- in Staff, at Ryan's direct request ("dig into all payments").

-- Kirill: confirmed exact via 18+ months of real PayPal invoices from
-- "Maple&Bear" (kurlyrtr@gmail.com), Jan 2025 through Aug 2026, every
-- single one exactly $400.00. He's Straw Hut's Google Ads consultant.
-- No amount change -- notes only.
UPDATE cashflow_entries
   SET notes = 'Google Ads consultant. Confirmed via 18+ months of real PayPal invoices from "Maple&Bear" (kurlyrtr@gmail.com), Jan 2025-Aug 2026, every single one exactly $400.00 -- exact match to the original spreadsheet figure.'
 WHERE counterparty = 'Kirill' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Sajid: active team member (staff email saj@strawhutmedia.com, cc'd on
-- live campaign work through Apr 2026), but NO payment trail found
-- anywhere in Gmail for the current period (PayPal/Upwork/Wise/Zelle/
-- invoice) -- only a stale 2020 Freelancer.com contract. The $200/mo
-- figure is unverified and unverifiable from available records; flagging
-- rather than guessing. Ryan should confirm how Sajid is actually being
-- paid.
UPDATE cashflow_entries
   SET notes = 'Social media. UNVERIFIED -- no payment trail found anywhere in Gmail for the current period (checked PayPal/Upwork/Wise/Zelle/invoices), despite Sajid being an active team member (staff email saj@strawhutmedia.com). Only record found is a stale 2020 Freelancer.com contract. Ryan should confirm the actual payment channel/amount.'
 WHERE counterparty = 'Sajid' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Ana: the $100/mo flat guess was wrong. No independent payment receipt
-- exists, but strong identity match to Ana Clara Munoz (near-daily design
-- work 2024-2026, a Slack thread about her fixed working hours), and Ryan
-- directly stated her real rate in a separate Slack conversation this
-- session: $125/week, 9am-2pm Mon-Fri = $541.67/mo. Trusting Ryan's own
-- stated rate over the stale spreadsheet guess.
UPDATE cashflow_entries
   SET amount_cents = 54167,
       notes = 'Graphic design (Ana Clara Munoz). Corrected from a stale $100/mo spreadsheet guess -- Ryan directly stated her real rate ($125/wk, 9am-2pm Mon-Fri) in a Slack conversation, which works out to $541.67/mo. No independent payment receipt found to confirm further, but this is Ryan''s own stated figure, not a guess, and volume of her ongoing design work is inconsistent with $100/mo.'
 WHERE counterparty = 'Ana' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';
