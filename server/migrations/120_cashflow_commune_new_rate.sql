-- Ryan confirmed the itemized $3,195/mo (migration 119) is being replaced by
-- a newly negotiated flat rate. Found the real SOW negotiation thread with
-- Jeff Krasno and Jacob Laub (onecommune.com), March-April 2026: Xavier
-- records in-person at their studio (up to 5 episodes/month), plus a
-- separate editor for video/audio post-production; kickoff call April 13,
-- 2026. Ryan's own words: "our new monthly rate for Commune is $3000 a
-- month that should start hitting the account this month."
UPDATE cashflow_entries
   SET amount_cents = 300000,
       notes = 'Flat $3,000/mo per new SOW negotiated with Jeff Krasno/Jacob Laub (onecommune.com), Mar-Apr 2026 thread -- Xavier records in-person (up to 5 episodes/mo) + separate editor for post. Starting this month, replacing the prior itemized $2,250 base + variable audio-edit invoices ($3,195/mo actual recent average). Separately: Straw Hut still owes Commune a $2,000 credit from a Sept 2025 billing error, being worked off via invoice deductions -- not reflected here, a one-time reconciliation item.'
 WHERE counterparty = 'Commune' AND kind = 'in' AND occurred_on = '2026-08-01';
