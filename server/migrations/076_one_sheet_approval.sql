-- One-sheet approval + version history. An admin "approves" a show's one-sheet,
-- which stamps the date and snapshots the exact content that was approved. The
-- outreach send surface shows that date so you can review before the next
-- blast. Every approval is also saved to a history table so you can roll back
-- to a previous approved version. Applies to every show.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS one_sheet_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS one_sheet_approved_by uuid,
  ADD COLUMN IF NOT EXISTS one_sheet_approved_snapshot jsonb;

CREATE TABLE IF NOT EXISTS one_sheet_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  snapshot    jsonb NOT NULL,          -- the one-sheet content at approval time
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_one_sheet_approvals_project
  ON one_sheet_approvals (project_id, approved_at DESC);
