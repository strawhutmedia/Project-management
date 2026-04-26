-- Default the Maggie Glass record's Dropbox root to /2_CLIENTS/Maggie Glass Record/
-- and set per-song dropbox_folder paths.

UPDATE projects
SET dropbox_folder = '/2_CLIENTS/Maggie Glass Record'
WHERE name = 'Maggie Glass — Record' AND (dropbox_folder IS NULL OR dropbox_folder = '');

DO $$
DECLARE
  proj_id UUID;
BEGIN
  SELECT id INTO proj_id FROM projects WHERE name = 'Maggie Glass — Record';
  IF proj_id IS NULL THEN RETURN; END IF;

  UPDATE songs SET dropbox_folder = '/2_CLIENTS/Maggie Glass Record/' || title
  WHERE project_id = proj_id AND subtitle IS NULL AND dropbox_folder IS NULL;

  -- Versioned variants get the version in the folder name to avoid collisions
  UPDATE songs
  SET dropbox_folder = '/2_CLIENTS/Maggie Glass Record/' || title || ' (' || subtitle || ')'
  WHERE project_id = proj_id AND subtitle IS NOT NULL AND dropbox_folder IS NULL;
END $$;
