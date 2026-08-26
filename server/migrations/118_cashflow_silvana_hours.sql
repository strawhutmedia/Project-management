-- Silvana doesn't have one consolidated hours sheet -- she logs across
-- three per-show sheets (SOTS, Next City, String And Tell), all at
-- $24/hr. Real combined monthly totals: June $2,946 (SOTS $1,704 + NC
-- $108 + S&T $1,134), July $4,386 (SOTS $2,220 + NC $30 + S&T $2,136).
-- Two-month average: $3,666/mo, replacing the flat $3,000 guess.
--
-- Flag: a meaningful chunk of her July hours ($2,136) and some August
-- hours were logged against String And Tell, the client Ryan said had
-- stopped -- worth checking whether that's wind-down work or should
-- have already stopped.
UPDATE cashflow_entries
   SET amount_cents = 366600,
       notes = 'Hourly, $24/hr, logged across SOTS/Next City/String And Tell sheets (no single consolidated sheet). Real 2-month average (June $2,946, July $4,386): $3,666/mo. NOTE: meaningful hours still logged against String And Tell in July/August despite that client reportedly churning -- worth checking with Ryan.'
 WHERE counterparty = 'Silvana' AND kind = 'out' AND occurred_on = '2026-08-01';
