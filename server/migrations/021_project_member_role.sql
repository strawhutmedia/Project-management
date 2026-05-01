-- Per-project roles: a user can be admin on Project A, user on Project B,
-- and viewer on Project C. The workspace 'admin' role (Ryan) is "Super
-- Admin" and is treated as project-admin everywhere via getProjectRole;
-- this table just stores the explicit per-project role for everyone else.
ALTER TABLE project_members
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin', 'user', 'viewer'));

-- Backfill 1: project creators are admin on their own projects.
UPDATE project_members pm
SET role = 'admin'
FROM projects p
WHERE pm.project_id = p.id AND pm.user_id = p.created_by;

-- Backfill 2: workspace admins recorded as project admins where they're
-- already members (cosmetic — they get admin behaviour anyway via the
-- getProjectRole short-circuit).
UPDATE project_members pm
SET role = 'admin'
FROM users u
WHERE pm.user_id = u.id AND u.role = 'admin';
