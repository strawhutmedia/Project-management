-- Where channels (songs/episodes) live within the project's root folder.
-- For podcast projects this is typically "episodes" so a project root of
-- /1_podcasts/codestrap with channels_subfolder = "episodes" produces
-- channel folders at /1_podcasts/codestrap/episodes/<channel>/.
-- Album projects leave it null so songs land directly under the root.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS channels_subfolder TEXT;

-- Default existing podcast projects (none in the wild yet, but for safety)
UPDATE projects
SET channels_subfolder = 'episodes'
WHERE kind = 'podcast' AND channels_subfolder IS NULL;
