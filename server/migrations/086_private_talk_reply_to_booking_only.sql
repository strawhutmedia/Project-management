-- Ryan already receives the booking@ mail, so drop the direct-to-Ryan reply-to
-- added in 085. Replies go to booking@strawhutmedia.com only.
UPDATE outreach_templates
   SET reply_to = 'booking@strawhutmedia.com',
       updated_at = now()
 WHERE project_id IN (
   SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
 );
