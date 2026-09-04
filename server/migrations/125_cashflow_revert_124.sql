-- Revert migration 124. Ryan confirmed directly: Soul & Science,
-- IndieFilmaking, and Psychedelic Report are all real, current clients.
-- Migration 124 acted on inference from email threads (shared production
-- contacts, an asset-handoff email) instead of asking Ryan first -- that
-- was the wrong call for a real income line. Restoring both entries as
-- they were before that migration.
INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'in', 400000, '2026-08-01', 'Client payment', 'Soul & Science',
  'Restored after Ryan confirmed this is a real, separate paying client -- not a Mekanism double-count as migration 124 assumed.',
  true
);

UPDATE cashflow_entries
   SET is_recurring = true,
       notes = 'Ryan confirmed this is a real, current client -- migration 124''s read of an asset-handoff email as churn was wrong.'
 WHERE counterparty = 'IndieFilmaking' AND kind = 'in' AND occurred_on = '2026-08-01';
