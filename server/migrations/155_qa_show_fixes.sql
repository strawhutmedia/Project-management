-- QA show-picker fixes (Ryan, 2026-09-17, from the /qa "Log a recording" form):
--
-- 1) The bare "Private Talk" podcast project shows up in the picker alongside
--    "Private Talk with Alexis Texas" — Ryan wants the bare one gone ("we have
--    that show on there twice"). Soft-archive (migration 154's mechanism), not
--    a hard delete: reversible, keeps any attached data. Exact-name match so
--    the Alexis Texas project is untouched.
UPDATE projects
   SET archived_at = now()
 WHERE kind = 'podcast'
   AND lower(name) = 'private talk'
   AND archived_at IS NULL;

-- 2) "Invest in Her" was in the old QA PRODUCTION SHEET (seeded by migration
--    148) but never existed as a Slate project, so those seeded rows landed
--    with project_id NULL and the show is missing from the picker entirely.
--    Create it as a podcast project (same defaults as the app's create route:
--    podcast stage labels, 'episodes' channels subfolder, admin as EP, slug)
--    and re-attach the orphaned QA rows to it.
INSERT INTO projects (name, kind, created_by, stage_labels, channels_subfolder, default_owners, slug)
SELECT
  'Invest in Her',
  'podcast',
  admin.id,
  '{"writing":{"label":"Scheduled","icon":"📅"},"tracking":{"label":"Prepped","icon":"🎤"},"overdubs":{"label":"Recorded","icon":"🎬"},"producing":{"label":"Editing","icon":"✂️"},"stems":{"label":"Client Review","icon":"👀"},"mixing":{"label":"Revisions","icon":"🔧"},"mastering":{"label":"Finalized","icon":"✨"},"done":{"label":"Released","icon":"🚀"}}'::jsonb,
  'episodes',
  CASE WHEN admin.id IS NULL THEN '{}'::jsonb
       ELSE jsonb_build_object('executive_producer', admin.id) END,
  CASE WHEN EXISTS (SELECT 1 FROM projects WHERE slug = 'invest-in-her') THEN NULL
       ELSE 'invest-in-her' END
FROM (
  SELECT COALESCE(
    (SELECT id FROM users WHERE email = 'ryan@strawhutmedia.com' LIMIT 1),
    (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1)
  ) AS id
) admin
WHERE admin.id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM projects WHERE kind = 'podcast' AND name ILIKE '%invest in her%'
  );

UPDATE qa_recordings r
   SET project_id = p.id
  FROM projects p
 WHERE r.project_id IS NULL
   AND r.title ILIKE 'invest in her%'
   AND p.kind = 'podcast'
   AND p.name ILIKE '%invest in her%'
   AND p.archived_at IS NULL;
