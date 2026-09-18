-- Auto-heal state for vault verification (Ryan, 2026-09-18: "if something
-- goes wrong it should be corrected immediately by you and keep trying to
-- upload until everything is there; if after a bunch of tries a file or two
-- cannot make it, they should be listed and I should be able to approve
-- that they don't need to be uploaded").
--
-- When a verify run finds missing files on a finished, healable job, the
-- server re-issues the job's start command itself (same mechanism as the
-- Resume button). attempts counts consecutive re-runs that did NOT shrink
-- the missing count; after 3 the server stops retrying and the row asks
-- Ryan to either widen the job on the NAS or approve skipping the listed
-- files. Approval only affects reporting — nothing is ever deleted by it.

CREATE TABLE IF NOT EXISTS storage_heal_state (
  name TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_missing INTEGER,
  accepted_missing INTEGER,
  accepted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
