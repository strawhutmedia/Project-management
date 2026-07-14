-- Two outreach fixes.
--
-- 1. GUEST CLARITY. The template's second line said "…and we'd love to have
--    you on." That presumes the recipient IS the guest. But when the
--    recipient is a rep (agent/manager), the unique sentence correctly
--    pitches their CLIENT ("We'd love to have Amaya on…"), so the email
--    contradicted itself: "we want you" then "we want Amaya". Drop the
--    presumptive ask from the fixed copy and let the unique sentence carry
--    it, aimed at the right person. Now the email names exactly one guest.
--
-- 2. DYNAMIC SIGNATURE. The sign-off was hard-coded ("Best, Caroline"). It
--    should reflect whichever account actually sends. Swap the literal name
--    for a [sender] token and add a sender_name column the sender path fills
--    with the account's display name at send time. Backfill Caroline so
--    nothing signs blank before the first send sets it.

ALTER TABLE outreach_templates ADD COLUMN IF NOT EXISTS sender_name text;

UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

If it sounds like a fit, just reply and we'll get you booked in for this week or next.

More about the show: [one_sheet_url]

Best,
[sender]$body$,
    sender_name = COALESCE(NULLIF(trim(sender_name), ''), 'Caroline'),
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);
