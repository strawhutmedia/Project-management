-- Three corrections from Ryan's direct confirmation plus one more real find
-- while checking Psychedelic Report.

-- Soul & Science IS Mekanism -- Ryan confirmed directly. Re-apply the
-- migration 124 delete that was reverted in 125 (that revert was wrong on
-- this one specifically, right on the other two).
DELETE FROM cashflow_entries
 WHERE counterparty = 'Soul & Science' AND kind = 'in' AND occurred_on = '2026-08-01';

-- Commune: Ryan confirmed it's a fixed monthly number PLUS a variable
-- add-on for audio-only edits, not a flat $3,000 -- migration 120's
-- flattening was wrong. Real recent actuals (found via QuickBooks payment
-- receipts): $2,250 base + $945 audio edits = $3,195. Restoring the
-- itemized figure.
UPDATE cashflow_entries
   SET amount_cents = 319500,
       notes = 'Fixed monthly retainer ($2,250, "Monthly Commune Podcast Services") PLUS a variable add-on for audio-only episode edits, billed separately (recent invoice $945) -- confirmed by Ryan directly, not a flat $3,000. Real combined total from actual invoices: $3,195/mo, will vary with audio-edit volume.'
 WHERE counterparty = 'Commune' AND kind = 'in' AND occurred_on = '2026-08-01';

-- Psychedelic Report IS Future Medicine Media -- same real client (Dr.
-- Dave Rabin), just billed under a different entity name in QuickBooks.
-- Proof: 20 straight months of real $900 sales receipts (Jan 2025-Aug
-- 2026), all addressed "Dear Future Medicine Media" and all sent to
-- dave@apolloneuro.com -- the same inbox as the Psychedelic Report guest-
-- booking threads. Ryan was right that it's real and pays $900/mo; it was
-- just double-counted under two different names. Keep the QuickBooks-
-- confirmed "Future Medicine Media" line, remove the duplicate.
DELETE FROM cashflow_entries
 WHERE counterparty = 'Psychedelic Report' AND kind = 'in' AND occurred_on = '2026-08-01';

UPDATE cashflow_entries
   SET notes = 'Real client: Dr. Dave Rabin (Apollo Neuro), for his show "The Psychedelic Report" -- billed in QuickBooks under the entity name "Future Medicine Media," not the show name. Confirmed via 20 straight months of $900 sales receipts (Jan 2025-Aug 2026) to dave@apolloneuro.com. This was double-counted under both names until Ryan clarified they''re the same client.'
 WHERE counterparty = 'Future Medicine Media' AND kind = 'in' AND occurred_on = '2026-08-01';
