-- Hotel contingency — a percentage buffer added to hotel costs to
-- cover last-minute room additions (extras, day players, guest
-- talent, last-minute crew hires). Industry standard is ~10%, which
-- roughly covers 1-2 extra rooms per day for a 15-20 person crew.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS hotel_contingency_pct NUMERIC(5,2) DEFAULT 10;

UPDATE budgets SET hotel_contingency_pct = 10 WHERE hotel_contingency_pct IS NULL;
