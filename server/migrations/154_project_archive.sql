-- Soft-archive for projects. Removing a project outright would risk breaking
-- the many tables that reference it; archiving hides it from every listing
-- while keeping the data intact and restorable by an admin.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects (archived_at);
