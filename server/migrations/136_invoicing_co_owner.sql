-- Ryan asked explicitly for Caroline to have access to the Client
-- Invoices / QuickBooks side of Invoicing (she's the one who will be
-- adding/editing invoices there). The invoicing section is normally
-- locked to a single hardcoded owner account; this adds a narrow,
-- named second seat instead of opening it to all admins.
--
-- Matches by name/display_name the same way 034_promote_caroline did,
-- to avoid needing her email in source control. Idempotent — re-running
-- is a no-op once she already has the flag. Errors out if multiple
-- non-flagged Carolines exist so we don't silently grant the wrong
-- account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_invoicing_owner boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  match_count int;
BEGIN
  SELECT count(*) INTO match_count FROM users
   WHERE (display_name ILIKE '%caroline%' OR name ILIKE '%caroline%')
     AND is_invoicing_owner IS DISTINCT FROM true;
  IF match_count = 0 THEN
    RAISE NOTICE '136_invoicing_co_owner: no un-flagged Caroline found — no change';
  ELSIF match_count > 1 THEN
    RAISE EXCEPTION '136_invoicing_co_owner: % un-flagged Carolines matched — refine this migration with the specific id', match_count;
  ELSE
    UPDATE users SET is_invoicing_owner = true
     WHERE (display_name ILIKE '%caroline%' OR name ILIKE '%caroline%')
       AND is_invoicing_owner IS DISTINCT FROM true;
    RAISE NOTICE '136_invoicing_co_owner: granted Caroline invoicing co-owner access';
  END IF;
END $$;
