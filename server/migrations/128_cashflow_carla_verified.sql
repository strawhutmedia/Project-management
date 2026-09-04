-- Verify the "Carla" bookkeeping line against real Upwork billing, at
-- Ryan's request after he flagged general worry about missing/unverified
-- data. The $250/mo amount from the original spreadsheet seed (migration
-- 105) is confirmed exactly correct: real Upwork milestone payments on
-- contract #29325650 "Bookkeeping 2021" show $250.00 for Jun 2026, Jul
-- 2026, and Aug 2026, with the Sep 2026 milestone already queued at the
-- same $250.00, plus a weekly Upwork billing summary (Aug 24-30) showing
-- exactly "$250.00 Fixed-price & other payments." Ryan confirmed the
-- Upwork contractor of record, "Ka Lai L.", is the same person he calls
-- Carla -- no name/person mismatch, no double-count.
UPDATE cashflow_entries
   SET notes = 'Bookkeeping, $250/mo. Confirmed via real Upwork milestone payments on contract #29325650 "Bookkeeping 2021" (Jun/Jul/Aug 2026 all $250.00, Sep 2026 milestone queued at $250.00) -- exact match to the original spreadsheet figure. Ryan confirmed the Upwork contractor "Ka Lai L." is the same person as Carla.'
 WHERE counterparty = 'Carla' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';
