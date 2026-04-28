-- Seed the codestrap "Code x Connor" podcast project so Ryan doesn't have
-- to create it manually. Idempotent: skipped if a project with that name
-- already exists.
DO $$
DECLARE
  ryan_id UUID;
  proj_id UUID;
BEGIN
  SELECT id INTO ryan_id FROM users WHERE email = 'ryan@strawhutmedia.com';
  IF ryan_id IS NULL THEN RETURN; END IF;

  SELECT id INTO proj_id FROM projects WHERE name = 'Code x Connor';
  IF proj_id IS NULL THEN
    INSERT INTO projects (name, kind, created_by, dropbox_folder, channels_subfolder, stage_labels, subtitle)
    VALUES (
      'Code x Connor',
      'podcast',
      ryan_id,
      '/1_PODCASTS/codestrap',
      'episodes',
      jsonb_build_object(
        'writing',   jsonb_build_object('label', 'Scheduled',     'icon', '📅'),
        'tracking',  jsonb_build_object('label', 'Prepped',       'icon', '🎤'),
        'overdubs',  jsonb_build_object('label', 'Recorded',      'icon', '🎬'),
        'producing', jsonb_build_object('label', 'Editing',       'icon', '✂️'),
        'stems',     jsonb_build_object('label', 'Client Review', 'icon', '👀'),
        'mixing',    jsonb_build_object('label', 'Revisions',     'icon', '🔧'),
        'mastering', jsonb_build_object('label', 'Finalized',     'icon', '✨'),
        'done',      jsonb_build_object('label', 'Released',      'icon', '🚀')
      ),
      'codestrap'
    )
    RETURNING id INTO proj_id;

    INSERT INTO project_members (project_id, user_id) VALUES (proj_id, ryan_id);
  END IF;
END $$;
