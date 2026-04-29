-- Split the marketing goal bucket: previously "marketing_target" was measured
-- against the entire StudioBinder "other" category (publicity + legal + GE +
-- insurance). Add an admin_target so legal/insurance/GE can be tracked
-- separately from publicity/PR. Marketing now maps to publicity (55-00) only;
-- admin maps to legal (56-00) + general expense (57-00) + insurance (58-00).

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS admin_target NUMERIC(12,2);
