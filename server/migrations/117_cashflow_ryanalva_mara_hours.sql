-- Real numbers computed directly from the hours-log spreadsheets ("Ryan
-- Alva // Straw Hut Hours" and "Mara - Hours worked"), rather than a
-- single snapshot payment or a stale flat guess.

-- Ryan Alva ($32/hr) -- new, not previously tracked. Real paid periods:
-- May $160 (clear outlier, barely worked that month), June $1,664, July
-- $3,472 (this is the PayPal payment Ryan showed earlier), August
-- tracking similarly high through the 24th. Excluding the May outlier,
-- June+July average to $2,568/mo -- genuinely volatile, will need
-- revisiting as more months come in.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 256800, '2026-08-01', 'Staff', 'Ryan Alva',
  'Hourly editor at $32/hr, paid via Link/Navy Federal. June-July average from real hours log ($1,664 + $3,472) = $2,568/mo, excluding an anomalous $160 May. Highly variable month to month -- August is tracking similarly high.',
  true
);

-- Mara ($25/hr) -- was flat $3,000/mo, but her actual hours log shows a
-- trailing 10-week average (mid-June through Aug 21) of ~40.45 hrs/week,
-- consistent with months further back too (Jan/Feb also ran 33-48
-- hrs/week). Real monthly-equivalent: ~$4,380/mo.
UPDATE cashflow_entries
   SET amount_cents = 438000,
       notes = 'Hourly, $25/hr. Real trailing average from her hours log (~40.45 hrs/wk, mid-June through Aug): ~$4,380/mo -- the flat $3,000 guess was stale, not just an unusually busy stretch.'
 WHERE counterparty = 'Mara' AND kind = 'out' AND occurred_on = '2026-08-01';
