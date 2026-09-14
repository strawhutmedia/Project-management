-- Bruce Poon Tip (G Adventures) update from Ryan directly: he quoted
-- $4,000/mo and they're now negotiating -- was seeded at $0/prospecting
-- in migration 139 since no rate had been quoted yet at the time.
UPDATE cashflow_pipeline_deals
   SET estimated_mrr_cents = 400000,
       stage = 'negotiating',
       notes = 'Real prospect -- founder of G Adventures, considering a podcast. Introduced May 2026 via Brett Marchand (Plus Company). Ryan quoted $4,000/mo; currently negotiating -- not yet won.'
 WHERE name = 'Bruce Poon Tip (G Adventures)';
