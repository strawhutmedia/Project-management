-- Promote Caroline to Super Admin (workspace-level role='admin').
--
-- Ryan asked for this explicitly. We match by display_name / name
-- containing "caroline" case-insensitively to avoid needing her email
-- in source control. Migration is idempotent — re-running is a no-op
-- once she's already admin. Errors out if multiple non-admin Carolines
-- exist so we don't silently promote the wrong account.
DO $$
DECLARE
  match_count int;
BEGIN
  SELECT count(*) INTO match_count FROM users
   WHERE (display_name ILIKE '%caroline%' OR name ILIKE '%caroline%')
     AND role IS DISTINCT FROM 'admin';
  IF match_count = 0 THEN
    RAISE NOTICE '034_promote_caroline: no non-admin Caroline found — no change';
  ELSIF match_count > 1 THEN
    RAISE EXCEPTION '034_promote_caroline: % non-admin Carolines matched — refine this migration with the specific id', match_count;
  ELSE
    UPDATE users SET role = 'admin'
     WHERE (display_name ILIKE '%caroline%' OR name ILIKE '%caroline%')
       AND role IS DISTINCT FROM 'admin';
    RAISE NOTICE '034_promote_caroline: promoted Caroline to Super Admin';
  END IF;
END $$;
