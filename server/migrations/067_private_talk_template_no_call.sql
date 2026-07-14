-- Follow-up copy tweak for the Private Talk outreach template: drop the
-- "no call needed" line from the scheduling ask. Same rationale as 066 —
-- the saved template row lives in the DB and can't be changed from code,
-- so we update it directly. Only rewrites the body; leaves sentences,
-- reply-to, and everything else untouched.
UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas, and we'd love to have you on.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

If it sounds like a fit, just reply and we'll get you booked in for this week or next.

More about the show: [one_sheet_url]

Best,
Ryan$body$,
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);
