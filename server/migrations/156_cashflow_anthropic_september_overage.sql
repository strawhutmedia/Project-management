-- Anthropic September 2026 blowout: log the real one-time overage and fix
-- the recurring line's stale description.
--
-- Primary source: the Anthropic receipt emails in Ryan's Gmail
-- (invoice+statements@mail.anthropic.com), all 27 September receipts read
-- individually on 2026-09-18. September so far (through Sep 17):
--   $150.00  Team plan subscription (Sep 7; 1 Premium seat $125 + 1 Standard $25)
--   $1,109.62  26x "Auto recharge extra usage, Team plan" charges, $44-58
--              each, all between Sep 9 and Sep 17 (Claude Code sessions
--              blowing past the Premium seat's included usage with
--              auto-reload on)
--   $90.00   2x "Prepaid extra usage, Team plan" (Sep 9, Sep 10)
--   $63.61   3x "Auto-recharge credits" (API console credits powering
--            Slate/Podbooster/site servers: $20.83 + $21.08 + $21.70)
--  -$25.16   refund of the unused Jul 20 Individual-plan prepaid (Sep 10)
-- Net September through Sep 17: $1,324.46. The $150 subscription is the
-- recurring line below; everything else nets to $1,174.46 of one-time
-- overage, logged here as a NON-recurring entry so the sustainable
-- baseline isn't distorted by one bad stretch.

INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 117446, '2026-09-17', 'Software', 'Anthropic (Claude)',
  'One-time September extra-usage overage (Sep 9-17): 26 auto-recharge extra-usage top-ups (~$1,109.62) + $90 prepaid extra usage + $63.61 API credit recharges, less $25.16 refund. Verified line-by-line from the Anthropic receipt emails. Excludes the $150/mo subscription (tracked on the recurring line). Cause: Claude Code sessions with extra-usage auto-reload on; plan change to Max 20x under discussion.',
  false
);

-- The recurring line said "pay-as-you-go API usage" -- that stopped being
-- true on Aug 7 when Ryan moved to the Team plan. Amount is unchanged
-- ($150/mo is the real subscription, per the Aug 7 and Sep 7 receipts);
-- only the description is corrected. If Ryan switches to Max 20x
-- ($200/mo), update this line then -- not before the switch actually happens.
UPDATE cashflow_entries
   SET notes = 'Claude Team plan subscription since 2026-08-07: 1 Premium seat ($125) + 1 Standard seat ($25), bills the 7th. Verified from the Aug 7 + Sep 7 receipts. API server credits (~$20-28/mo, sporadic) and any extra-usage top-ups are separate charges -- log those as their own entries when they matter.'
 WHERE counterparty = 'Anthropic (Claude)' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01' AND is_recurring = true;
