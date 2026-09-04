-- CodeStrap's real QuickBooks invoice history shows a rate increase that
-- was never applied to the tracker: steady $2,950.00/mo Jan-May 2026,
-- then steady $3,687.50/mo Jun-Aug 2026 (confirmed on both accrual and
-- cash-basis pulls, no gaps either way). The tracker was still showing
-- the pre-increase $2,950.00 figure. Updating to the current real rate.
UPDATE cashflow_entries
   SET amount_cents = 368750,
       notes = 'Real QuickBooks invoice history: steady $2,950.00/mo Jan-May 2026, then a rate increase to steady $3,687.50/mo Jun-Aug 2026 (confirmed on both accrual and cash-basis pulls, no gaps). Tracker was still showing the pre-increase rate.'
 WHERE counterparty = 'CodeStrap' AND kind = 'in' AND occurred_on = '2026-08-01';
