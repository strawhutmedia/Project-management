-- Per-kind default assignees for social plans. When a plan is generated
-- for a podcast episode, items inherit the owner for their kind from this
-- map, so Ana gets every photo post automatically and the reel editor
-- gets every reel concept. Per-item assignees live inside the items JSONB
-- (assignee_user_id field) and can be overridden by anyone with project
-- write access.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS socials_default_assignees jsonb NOT NULL DEFAULT '{}'::jsonb;
