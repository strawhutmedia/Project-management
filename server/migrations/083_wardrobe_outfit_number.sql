-- Editable outfit number on wardrobe line items.
--
-- Each WARDROBE breakdown item (one per character per scene) can carry an
-- outfit number/label the costume team assigns — "1", "3", "7A" — so the
-- day view can show each character's look(s) by number, and the same
-- recurring outfit can share a number across scenes. Free TEXT so labels
-- like "1A" work. Only meaningful for WARDROBE-coded rows.

ALTER TABLE budget_line_items
  ADD COLUMN IF NOT EXISTS outfit_number TEXT;
