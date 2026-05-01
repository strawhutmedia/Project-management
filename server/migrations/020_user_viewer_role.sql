-- Add 'viewer' as a third user role for read-only access. A viewer can
-- see every project they're a member of but cannot write anything (no
-- new episodes, no stage changes, no tasks, no comments, no transcripts).
-- The viewer gate lives in the route handlers; this migration just
-- relaxes the CHECK constraint to allow the new value.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'viewer'));
