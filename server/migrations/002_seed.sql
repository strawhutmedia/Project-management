-- Seed Ryan as admin and the Maggie Glass record with all 14 songs.
-- Idempotent: only inserts if missing.

INSERT INTO users (email, name, role, timezone)
VALUES ('ryan@strawhutmedia.com', 'Ryan', 'admin', 'America/Los_Angeles')
ON CONFLICT (email) DO NOTHING;

DO $$
DECLARE
  ryan_id UUID;
  proj_id UUID;
BEGIN
  SELECT id INTO ryan_id FROM users WHERE email = 'ryan@strawhutmedia.com';

  SELECT id INTO proj_id FROM projects WHERE name = 'Maggie Glass — Record';
  IF proj_id IS NULL THEN
    INSERT INTO projects (name, subtitle, kind, created_by)
    VALUES ('Maggie Glass — Record', '13 songs · 14 tracks', 'album', ryan_id)
    RETURNING id INTO proj_id;

    INSERT INTO project_members (project_id, user_id) VALUES (proj_id, ryan_id);

    INSERT INTO songs (project_id, title, subtitle, stage, position) VALUES
      (proj_id, 'Olive Juice', NULL, 'tracking', 1),
      (proj_id, 'I Know', NULL, 'tracking', 2),
      (proj_id, 'Lionheart', NULL, 'tracking', 3),
      (proj_id, 'Yellow-Billed Loon', NULL, 'tracking', 4),
      (proj_id, 'Ferocious Beasts', NULL, 'producing', 5),
      (proj_id, 'I Hope That You Die', NULL, 'producing', 6),
      (proj_id, 'Fake Plastic Trees', NULL, 'tracking', 7),
      (proj_id, '500 Miles', NULL, 'tracking', 8),
      (proj_id, 'Long Walk Home', '2026 version', 'tracking', 9),
      (proj_id, 'Long Walk Home', '2015 version', 'producing', 10),
      (proj_id, 'Mabel', NULL, 'producing', 11),
      (proj_id, 'Oh Wood', NULL, 'producing', 12),
      (proj_id, 'I Can''t Explain', NULL, 'done', 13),
      (proj_id, 'This Is It', NULL, 'done', 14);

    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Decide: add synth?', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'Olive Juice';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Track vocals', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'I Know';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Guitar tracked', 'tracking', TRUE FROM songs WHERE project_id = proj_id AND title = 'I Know';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Track vocals', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'Lionheart';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Guitar tracked', 'tracking', TRUE FROM songs WHERE project_id = proj_id AND title = 'Lionheart';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Decide: track drums?', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'Yellow-Billed Loon';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Decide: add synth or organ?', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'Fake Plastic Trees';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Decide: track drums?', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = '500 Miles';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Decide: track drums?', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'Long Walk Home' AND subtitle = '2026 version';
    INSERT INTO tasks (song_id, title, stage, done) SELECT id, 'Decide: add synth?', 'tracking', FALSE FROM songs WHERE project_id = proj_id AND title = 'Long Walk Home' AND subtitle = '2026 version';
  END IF;
END $$;
