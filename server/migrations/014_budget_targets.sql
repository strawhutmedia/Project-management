-- Budget targets / spending caps. All nullable — when null, no goal is
-- displayed for that bucket. The four caps map to user-facing "goals":
--   production_target  := above_line + production accounts
--   post_target        := post accounts
--   marketing_target   := other accounts (publicity, legal, insurance, general)
--   total_target       := full grand total (incl bond + contingency)

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS production_target NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS post_target NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS marketing_target NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_target NUMERIC(12,2);
