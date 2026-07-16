-- Fix auto-generated script-breakdown items that were created with Days = 0.
--
-- Line-item total = Cost × Days × x. Breakdown suggestions were inserted
-- with days (amt) = 0, so any Cost a producer typed multiplied out to $0 and
-- the scene never registered as priced. Days should default to 1 (a one-time
-- prop buy = cost × 1). Backfill every breakdown-account item still sitting
-- at Days = 0 up to 1, so already-entered costs start counting.

UPDATE budget_line_items li
SET amt = 1
FROM budget_accounts ba
WHERE li.account_id = ba.id
  AND ba.code = '__breakdown__'
  AND li.amt = 0;
