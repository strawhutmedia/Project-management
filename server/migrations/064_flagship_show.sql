-- Flagship marker — flip TRUE on the shows that anchor the Straw Hut
-- roster. They surface in the "Part of Straw Hut Media" section on
-- every other show's one-sheet.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_flagship BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed the flagship set Ryan called out. Uses ILIKE so we match
-- regardless of capitalization or a leading "The"/"With" prefix.
UPDATE projects
   SET is_flagship = TRUE
 WHERE kind = 'podcast'
   AND (
     name ILIKE '%only murders in the building%'
     OR name ILIKE '%naked lunch%'
     OR name ILIKE '%brandi glanville%'
     OR name ILIKE '%wicked podcast%'
     OR name ILIKE '%private talk%'
   );
