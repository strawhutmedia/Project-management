-- Add the recording LOCATION to the Private Talk outreach email. In-person is
-- preferred (LA or New York studio); remote is offered only as a fallback.
-- Same approach as the earlier template migrations: the row lives in the DB
-- and can't be edited from code, so update it directly. Only rewrites the
-- body; leaves sentences, sender_name, reply-to, and everything else intact.
UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

We tape in person at our LA or New York studio whenever we can — that's always our preference with Alexis — and we can make it work remotely if that's the only way to fit your schedule.

If it sounds like a fit, just reply and we'll get [guest] booked in for this week or next.

More about the show: [one_sheet_url]

Best,
[sender]$body$,
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);
