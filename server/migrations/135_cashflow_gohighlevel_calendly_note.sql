-- Follow-up to migration 134's GoHighLevel note. Confirmed via the
-- Calendly API that Straw Hut Media already has a live, active Calendly
-- account (calendly.com/strawhutmedia, "Podcast Discovery Call" event
-- type, last updated Jan 2026) -- booking is already fully covered
-- independently of GoHighLevel, same as the phone number already being
-- covered by Freedom Voice. Once the in-house Slate CRM ships (the one
-- real remaining piece GoHighLevel provides that isn't already
-- duplicated elsewhere), there's no dependency left blocking the cut.
UPDATE cashflow_entries
   SET notes = 'Ryan wants to cut this once an in-house CRM is built in Slate (already discussed/planned). Confirmed no other dependency blocks the cut: Freedom Voice already covers the public phone number, and Straw Hut Media already has a live, active Calendly account (calendly.com/strawhutmedia) covering booking independently of GoHighLevel. CRM/contacts is the one remaining piece GoHighLevel provides that needs to be built in Slate first.'
 WHERE counterparty = 'GoHighLevel' AND category = 'Software' AND kind = 'out' AND occurred_on = '2026-08-01';
