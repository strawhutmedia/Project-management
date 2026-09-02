-- Full-year audit forced by Ryan: verify every recurring line against real
-- QuickBooks + Gmail evidence, not just the original spreadsheet guess.
-- Found two real errors.

-- "Soul & Science" is Mekanism's own podcast (Jason Harris / Lily Jablonski
-- @ mekanism.com run production logistics for it) -- it is not a separate
-- paying client. Mekanism is already tracked as its own $4,000/mo recurring
-- line (migration 108), confirmed via real QuickBooks invoice history. This
-- $4,000/mo "Soul & Science" line was double-counting the same money under
-- the show's name instead of the client's name.
DELETE FROM cashflow_entries
 WHERE counterparty = 'Soul & Science' AND kind = 'in' AND occurred_on = '2026-08-01';

-- IndieFilmaking ("Indie Filmmaking / Truth & Reality") has ended. Real
-- Gmail evidence, Aug 10-13 2026: the client emailed that they're doing
-- Season 2 elsewhere, asked for login/asset handoff, and Caroline sent a
-- download link for "all the content and assets we created for the show."
-- That's an offboarding conversation, not an active client.
UPDATE cashflow_entries
   SET is_recurring = false,
       notes = 'Client confirmed ending, Aug 2026 -- real email evidence: they emailed about doing Season 2 elsewhere, and Caroline handed off show assets/login access. Flipped to one-time; drops out of the recurring baseline.'
 WHERE counterparty = 'IndieFilmaking' AND kind = 'in' AND occurred_on = '2026-08-01';
