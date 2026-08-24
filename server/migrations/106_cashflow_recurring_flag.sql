-- Distinguish reliable monthly recurring cash flow from one-off/lumpy
-- income and expenses (e.g. a single big client project vs. steady monthly
-- retainers). Ryan wants to see his sustainable baseline separately from
-- jobs that haven't proven consistent yet. Defaults to TRUE since most
-- logged entries (payroll, software, existing monthly clients) are
-- recurring; a one-time project payment is the exception and gets flagged
-- false when it's logged.
ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT true;
