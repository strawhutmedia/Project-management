-- Seed the QA board with the 10 most recent rows of the old
-- "QA PRODUCTION SHEET" so the tab doesn't launch empty. Shows,
-- shooters and the QA approver are matched by name and quietly left
-- NULL/skipped when no matching project or account exists.

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%don%t be alone%' OR name ILIKE '%jay kogen%' OR name ILIKE '%dbawjk%') ORDER BY name LIMIT 1),
    'DBAWJK - Chris Collins & Griffin James',
    DATE '2026-07-13', 'In person', '1080',
    '180407_183827 and 180407_185749 and 180407_204129', 'SD0007', 'SSD0005',
    'https://www.dropbox.com/scl/fo/ta9ijc3qnjna424hriwoh/AO2Wj4p1dz-VhpVwtVSjU44?rlkey=vapp7m0n46360lrk7eewsrmgt&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-16 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['sullivan%', 'xavier%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%don%t be alone%' OR name ILIKE '%jay kogen%' OR name ILIKE '%dbawjk%') ORDER BY name LIMIT 1),
    'DBAWJK - Linwood Boomer',
    DATE '2026-07-13', 'In person', '1080',
    '180407_223050 and 180407_204835', 'SD0007', 'SSD0005',
    'https://www.dropbox.com/scl/fo/mdkp6kotn4dgil6w2lh28/AG-fnJJMFxzVhAF64E99xws?rlkey=kpcqqdf3yove8lns8b0kh6si0&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-20 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['sullivan%', 'xavier%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%don%t be alone%' OR name ILIKE '%jay kogen%' OR name ILIKE '%dbawjk%') ORDER BY name LIMIT 1),
    'DBAWJK - INTRO FOR Barbara Heller',
    DATE '2026-07-13', 'In person', '1080',
    '180407_224206', 'SD0007', 'SSD0005',
    'https://www.dropbox.com/scl/fo/xvqbhcauk9y72y0gjke07/AI1-jn2seb_bAwhiVmqeABc?rlkey=deqld82blaiuq9dpoop611ajg&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-16 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['sullivan%', 'xavier%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%don%t be alone%' OR name ILIKE '%jay kogen%' OR name ILIKE '%dbawjk%') ORDER BY name LIMIT 1),
    'DBAWJK - Scott Thompson',
    DATE '2026-07-20', 'In person', '1080',
    '180414_195603, 180414_233830', 'SD0009 / SD0008', 'SSD0002',
    'https://www.dropbox.com/scl/fo/mfmr0940arg31rjur4wmw/AAmiNdQAi7oEy4dH8Cd4Vtc?rlkey=z0xy7b8bx9jok9jiiqcqpzeau&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-22 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['sullivan%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%invest in her%') ORDER BY name LIMIT 1),
    'Invest in Her - Tyne Daly and Eric Dyson',
    DATE '2026-07-21', 'In person', '1080',
    '180415_162147', 'SD0008', 'SSD0005',
    'https://www.dropbox.com/scl/fo/v1yldi69fzm46n777kfcn/ANajhmN1cYLyrMJ5QJJF7Bc?rlkey=zav1p9jbci797pkzfr14js0pf&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-22 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['sullivan%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%shaping freedom%') ORDER BY name LIMIT 1),
    'SHAPING FREEDOM - Tiffany Toney',
    DATE '2026-07-22', 'In person', '1080',
    '', 'SD0017', 'SSD0002',
    'https://www.dropbox.com/scl/fo/g8aafy6bn199lm42dlynu/AOr8LZh4C9h4jwg1IoU9_to?rlkey=2sgxl9oq5pau1bcwvgcvatnez&st=zpyfducs&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-27 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['xavier%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%shaping freedom%') ORDER BY name LIMIT 1),
    'SHAPING FREEDOM - Paulette Brown Hinds, Kenneth B. Morris, Jr. & Teri',
    DATE '2026-07-22', 'In person', '1080',
    '180416_212737', 'SD0017', 'SSD0002',
    'https://www.dropbox.com/scl/fo/tdjf4a3wkn27am6erjl3z/ABeMNYOFuZDJcTVtmSQYaeA?rlkey=7w76vjetg4uao116w6i25gz6g&st=bebonjz8&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-27 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['xavier%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%shaping freedom%') ORDER BY name LIMIT 1),
    'SHAPING FREEDOM - Phill Branch',
    DATE '2026-07-23', 'Riverside', '1080',
    '180311_222929, 180417_193753,', 'SD0007', 'SSD0004',
    'https://www.dropbox.com/scl/fo/20z8etg0h3ocqzp20tadf/AMsaqGOw2My033PuuvIPp4I?rlkey=9eyn6d39eqmx8qlwoyxrejgzu&dl=0 https://www.dropbox.com/scl/fo/yrjxw5hf1ip400l4zvosg/ABLKQDPUQps-ygVtiMcrB2w?rlkey=k2osp5bdystny3pb52x9s3lxs&dl=0',
    'Lisane requested the riverside auto edited veritcal clips',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-28 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['steven%']);

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%shaping freedom%') ORDER BY name LIMIT 1),
    'SHAPING FREEDOM - Giveton Gelin',
    DATE '2026-07-23', 'Riverside', '1080',
    '', '', '',
    'https://www.dropbox.com/scl/fo/yrjxw5hf1ip400l4zvosg/ABLKQDPUQps-ygVtiMcrB2w?rlkey=7cfz5hv79d6b0tjij7393gtmm&st=1oxrqp0b&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-27 12:00:00-07'
  ) RETURNING id
)
SELECT id FROM rec;

WITH rec AS (
  INSERT INTO qa_recordings
    (project_id, title, record_date, recording_type, resolution,
     audio_folder, audio_card, video_card, dropbox_url, notes,
     status, qa_by, qa_at)
  VALUES (
    (SELECT id FROM projects WHERE kind = 'podcast' AND (name ILIKE '%invest in her%') ORDER BY name LIMIT 1),
    'Invest in Her - Kathy',
    DATE '2026-07-24', 'Riverside', '1080',
    '180418_170801, 180418_174528, 180418_185821', 'SD0017', 'SSD0014',
    'https://www.dropbox.com/scl/fo/cb8ltocx7b5pknh9i2vi9/ABsKmtK6yhuqD8j3BzeR84U?rlkey=mttyvd6k2tscn7av15vk8yjv6&dl=0',
    '',
    'approved', (SELECT id FROM users WHERE COALESCE(display_name, name) ILIKE 'caroline%' LIMIT 1), TIMESTAMPTZ '2026-07-27 12:00:00-07'
  ) RETURNING id
)
INSERT INTO qa_recording_shooters (recording_id, user_id)
SELECT rec.id, u.id FROM rec, users u
 WHERE COALESCE(u.display_name, u.name) ILIKE ANY (ARRAY['steven%']);
