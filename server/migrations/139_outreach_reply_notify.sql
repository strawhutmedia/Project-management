-- Where to send the "you got a reply" notification for a show's outreach
-- campaign. NULL means fall back to ADMIN_EMAIL.
--
-- Pairs with reply_to: when reply_to is set to Slate's own inbound-capture
-- address (p-<projectId>@<inbound reply domain>), server/routes/ses_inbound_reply.ts
-- parses the reply itself and emails whoever's in notify_email instead of
-- the sender ever seeing a real human inbox.
ALTER TABLE outreach_templates ADD COLUMN IF NOT EXISTS notify_email TEXT;
