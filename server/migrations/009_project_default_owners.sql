-- Project-level role defaults: a project can specify the default owner
-- for each pipeline stage. Songs that have no explicit owner for a stage
-- fall back to the project default.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_owners JSONB NOT NULL DEFAULT '{}'::jsonb;
