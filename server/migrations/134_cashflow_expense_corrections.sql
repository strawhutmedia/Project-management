-- Three real corrections from Ryan's direct review of the cost breakdown.

-- Sajid: not actually a mystery -- Ryan pays him via direct bank
-- transfer, which doesn't generate any email receipt the way
-- PayPal/Upwork/Freelancer.com payments do. That's why the earlier Gmail
-- investigation found nothing; it's a blind spot in that verification
-- method, not evidence of a missing/wrong payment. Keeping the $200/mo
-- figure as Ryan's stated real number, removing the "unverified/red flag"
-- framing.
UPDATE cashflow_entries
   SET notes = 'Social media. Paid via direct bank transfer, monthly -- confirmed by Ryan directly. No email receipt trail exists for this payment method (unlike PayPal/Upwork/Freelancer.com), which is why an earlier Gmail-based verification pass came up empty; that was a gap in the verification method, not a real red flag.'
 WHERE counterparty = 'Sajid' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Rephonic: Ryan confirmed directly it's not used. Cutting it -- same
-- treatment as a churned client (is_recurring = false), so the $49/mo
-- drops out of the recurring baseline but the record stays for history.
UPDATE cashflow_entries
   SET is_recurring = false,
       notes = 'Ryan confirmed this is not used -- cut, effective this review. Kept as a historical entry, not recurring.'
 WHERE counterparty = 'Rephonic' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01';

-- GoHighLevel: not cut yet, but documenting Ryan's real plan so it isn't
-- lost -- he wants to replace it with an in-house CRM being built in
-- Slate, and had thought the public-facing phone number was a blocker,
-- but realized live in this conversation that Freedom Voice already
-- provides the 800 number independently, so that blocker doesn't
-- actually exist. Real future cut candidate once the Slate CRM ships.
UPDATE cashflow_entries
   SET notes = 'Ryan wants to cut this once an in-house CRM is built in Slate (already discussed/planned). Not a phone-number blocker -- Freedom Voice already provides the public 800 number independently of GoHighLevel. Real future cut candidate, not immediate.'
 WHERE counterparty = 'GoHighLevel' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01';
