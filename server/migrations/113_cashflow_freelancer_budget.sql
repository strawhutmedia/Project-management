-- Ryan wants one consolidated monthly Freelancer.com budget rather than
-- tracking each video editor individually -- their real payment patterns
-- are too different to track separately anyway (Muhammad and Daniel are
-- steady weekly costs; Alaa and Talha are sporadic, quiet for months then
-- active in bursts). Fold the two we'd already itemized into one line.
--
-- Budget math from real Freelancer.com receipts: Muhammad ~$520/mo
-- (steady $120/wk) + Daniel ~$1,190/mo (variable, multiple projects) +
-- Alaa/Talha ~$150-300/mo when active = a real run-rate of $1,860-2,010,
-- spiking higher in weeks everyone's active at once. $2,000/mo budget
-- gives a bit of cushion without being padded.
DELETE FROM cashflow_entries
 WHERE counterparty IN ('Muhammad', 'Daniel') AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';

INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes, is_recurring)
VALUES (
  'out', 200000, '2026-08-01', 'Freelancer', 'Freelancer.com (video editors)',
  'Consolidated monthly budget covering Muhammad, Daniel, Alaa, Talha, and any other video editors hired through Freelancer.com. This is a budget/ceiling, not an exact bill -- actual weekly spend varies (Muhammad steady ~$120/wk, Daniel ~$270/wk across multiple projects, Alaa/Talha sporadic). Revisit if actual spend consistently runs over or well under.',
  true
);
