-- Tag each outreach contact with the batch they were imported/contacted in, so
-- you always know which wave someone came from and can view any batch cleanly.
-- Backfill everything that already exists as "Batch 1" (the first wave).
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS batch_label text;

UPDATE outreach_prospects
   SET batch_label = 'Batch 1'
 WHERE batch_label IS NULL;
