-- Allow users without an email yet ("placeholder" / pre-invite users).
-- The admin can add them by name + role + project access, then add the
-- email later, which triggers the invite flow.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
