-- Real updates from Ryan directly: new car (payment + insurance changed),
-- and Anthropic's real current charge.

-- Car payment changed with the new car: $550 -> $554/mo.
UPDATE cashflow_entries
   SET amount_cents = 55400,
       notes = 'Updated for new car -- Ryan confirmed the payment is now $554/mo (was $550/mo on the prior car).'
 WHERE counterparty = 'Ryan Car' AND category = 'Vehicles' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Tesla Insurance ($180/mo) no longer applies -- Ryan has a new car, no
-- longer a Tesla. Renaming to a generic "Car Insurance" line and updating
-- to the real current rate Ryan gave: $340/mo.
UPDATE cashflow_entries
   SET amount_cents = 34000,
       counterparty = 'Car Insurance',
       notes = 'Was "Tesla Insurance" ($180/mo) -- Ryan no longer has a Tesla, replaced by a new car with real current insurance of $340/mo.'
 WHERE counterparty = 'Tesla Insurance' AND category = 'Vehicles' AND kind = 'out' AND occurred_on = '2026-08-01';

-- Anthropic (Claude): Ryan confirmed the real current charge is $150/mo,
-- not the $45/mo estimate from migration 111 (which was based on a rough
-- "~$20 every 2-3 weeks" read of sporadic pay-as-you-go receipts).
UPDATE cashflow_entries
   SET amount_cents = 15000,
       notes = 'Pay-as-you-go API usage. Ryan confirmed the real current monthly charge is $150/mo -- corrects the earlier $45/mo estimate, which undercounted actual usage.'
 WHERE counterparty = 'Anthropic (Claude)' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01';
