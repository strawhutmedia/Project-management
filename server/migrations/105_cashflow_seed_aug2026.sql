-- One-time seed of Ryan's real August 2026 monthly expenses and active
-- client income, captured directly from his "2025 Accounts" spreadsheet so
-- the new Cash Flow tracker (migration 104) isn't empty on day one. Dated
-- the 1st of the month since these are monthly recurring figures, not a
-- single day's transaction. String and Tell and 10 Seconds are left out —
-- Ryan confirmed both stopped/paused as recurring clients. Zero-amount and
-- blank-amount spreadsheet rows (Facebook Marketing, Bank of America, Amex,
-- CitiBank, Discover) are skipped — nothing to log. The $649 "Paid Annually"
-- line is also skipped; it isn't a monthly figure.
--
-- Opening balance is intentionally left at its migration-104 default (0) —
-- Ryan needs to set the real starting balance himself via the Cash Flow
-- page's "Opening balance" control so the running total is accurate.

INSERT INTO cashflow_entries (kind, amount_cents, occurred_on, category, counterparty, notes) VALUES
  ('out', 226300, '2026-08-01', 'Staff', 'Ryan', 'Monthly payroll'),
  ('out', 190000, '2026-08-01', 'Staff', 'Caroline', 'Monthly payroll'),
  ('out', 292800, '2026-08-01', 'Staff', 'Mag', 'Monthly payroll'),
  ('out', 314800, '2026-08-01', 'Staff', 'Xavier', 'Monthly payroll'),
  ('out', 48000,  '2026-08-01', 'Staff', 'Muhammad', 'Podcast ads & scheduling'),
  ('out', 25000,  '2026-08-01', 'Staff', 'Carla', 'Bookkeeping'),
  ('out', 300000, '2026-08-01', 'Staff', 'Mara', 'Monthly payroll'),
  ('out', 84000,  '2026-08-01', 'Staff', 'Daniel', 'Video editor'),
  ('out', 300000, '2026-08-01', 'Staff', 'Silvana', 'Producer / editor'),
  ('out', 180000, '2026-08-01', 'Staff', 'Ali', 'Motion graphics'),
  ('out', 100000, '2026-08-01', 'Staff', 'Uzair', 'Video editor'),
  ('out', 20000,  '2026-08-01', 'Staff', 'Sajid', 'Social media'),
  ('out', 10000,  '2026-08-01', 'Staff', 'Ana', 'Graphic design'),
  ('out', 40000,  '2026-08-01', 'Staff', 'Alaa', 'Video editor'),
  ('out', 40000,  '2026-08-01', 'Staff', 'Kirill', 'Monthly payroll'),
  ('out', 250000, '2026-08-01', 'Staff', 'Sales Team', 'Monthly payroll'),
  ('out', 75000,  '2026-08-01', 'Marketing', 'SHM Google Marketing', ''),
  ('out', 10000,  '2026-08-01', 'Software', 'Dropbox', ''),
  ('out', 45000,  '2026-08-01', 'Software', 'Veed', ''),
  ('out', 3000,   '2026-08-01', 'Software', 'Descript', ''),
  ('out', 9900,   '2026-08-01', 'Software', 'Opus', ''),
  ('out', 20000,  '2026-08-01', 'Software', 'GSuite', ''),
  ('out', 2118,   '2026-08-01', 'Software', 'Freedom Voice', ''),
  ('out', 10598,  '2026-08-01', 'Software', 'Adobe', ''),
  ('out', 9200,   '2026-08-01', 'Software', 'GoHighLevel', ''),
  ('out', 5500,   '2026-08-01', 'Software', 'Quickbooks', ''),
  ('out', 4000,   '2026-08-01', 'Software', 'Riverside', ''),
  ('out', 4900,   '2026-08-01', 'Software', 'Rephonic', ''),
  ('out', 1634,   '2026-08-01', 'Software', 'Zoom', ''),
  ('out', 30300,  '2026-08-01', 'Utilities', 'AT&T', ''),
  ('out', 300000, '2026-08-01', 'Utilities', 'Studio', ''),
  ('out', 55000,  '2026-08-01', 'Vehicles', 'Ryan Car', ''),
  ('out', 18000,  '2026-08-01', 'Vehicles', 'Tesla Insurance', ''),
  ('out', 45400,  '2026-08-01', 'Loans', 'SBA Loan', ''),
  ('out', 82000,  '2026-08-01', 'Loans', 'ChaseFreedom', ''),
  ('in', 295000,  '2026-08-01', 'Client payment', 'CodeStrap', ''),
  ('in', 90000,   '2026-08-01', 'Client payment', 'Psychedelic Report', ''),
  ('in', 400000,  '2026-08-01', 'Client payment', 'Soul & Science', ''),
  ('in', 245000,  '2026-08-01', 'Client payment', 'Shaping Freedom', ''),
  ('in', 245000,  '2026-08-01', 'Client payment', 'Next City', ''),
  ('in', 100000,  '2026-08-01', 'Client payment', 'IndieFilmaking', ''),
  ('in', 75000,   '2026-08-01', 'Client payment', 'Rainbow Media Co', ''),
  ('in', 1450000, '2026-08-01', 'Client payment', 'Seen on the Screen', ''),
  ('in', 433300,  '2026-08-01', 'Client payment', 'Naked Lunch', '');
