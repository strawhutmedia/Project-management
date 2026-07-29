-- One-time guard so the mistakenly auto-loaded detailed budget amounts can
-- be precisely reverted from the live project exactly once. Ryan enters the
-- budget per-day; the top-sheet lump sums loaded onto his blank lines were
-- code defaults he never typed. This flag makes the revert run once.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS detailed_budget_reverted boolean NOT NULL DEFAULT false;
