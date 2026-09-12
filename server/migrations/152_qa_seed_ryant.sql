-- Add the Ep190_RyanT recording to the QA board. It's the editbot sync-test
-- episode (Don't Be Alone with Jay Kogen) and the live target for the
-- Premiere assembly bridge, so it belongs on the board as an approved
-- recording. No card info was recorded on the sheet for it. Guarded so a
-- re-run can't duplicate it.
INSERT INTO qa_recordings
  (project_id, title, record_date, recording_type, resolution,
   audio_folder, audio_card, video_card, dropbox_url, dropbox_path, notes,
   status, qa_by, qa_at)
SELECT
  (SELECT id FROM projects
     WHERE kind = 'podcast'
       AND (name ILIKE '%don%t be alone%' OR name ILIKE '%jay kogen%' OR name ILIKE '%dbawjk%')
     ORDER BY name LIMIT 1),
  'DBAWJK - Dating Debrief w/ Ryan T (Ep190_RyanT)',
  DATE '2026-07-24', 'In person', '1080',
  '180421_205013', '', '',
  'https://www.dropbox.com/scl/fo/ekh9osn0qa0ujamgeoeyb/AEDa6IqZ9sfoBokz-g0bPVc?rlkey=v8uixq0lyq7hdmo7hq92u1hq2&dl=0',
  '/Straw Hut Team Folder/1_PODCASTS/Dont Be Alone with Jay Kogen/Episodes/Ep190_RyanT',
  'Ep190_RyanT — editbot sync-test recording. 3 cameras (CAM 1/3/4, each spanned 01+02) + Zoom H6 good audio (TRACK03/04 in 180421_205013). No card info was recorded on the QA sheet.',
  'approved',
  (SELECT id FROM users WHERE lower(email) = 'ryan@strawhutmedia.com' LIMIT 1),
  TIMESTAMPTZ '2026-07-27 12:00:00-07'
WHERE NOT EXISTS (
  SELECT 1 FROM qa_recordings WHERE title = 'DBAWJK - Dating Debrief w/ Ryan T (Ep190_RyanT)'
);
