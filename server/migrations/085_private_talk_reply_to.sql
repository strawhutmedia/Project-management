-- Send outreach replies to the shared booking inbox AND directly to Ryan, so
-- replies always reach him regardless of any Google Group delivery setting.
-- The sender now supports multiple comma-separated reply-to addresses.
UPDATE outreach_templates
   SET reply_to = 'booking@strawhutmedia.com, ryan@strawhutmedia.com',
       updated_at = now()
 WHERE project_id IN (
   SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
 );
