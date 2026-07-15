-- Make the recording location a per-show setting Caroline picks from a
-- dropdown, instead of copy baked into the body. Add a location column and
-- switch the Private Talk body's hard-coded location sentence to a [location]
-- token that renders from the chosen setting. Default 'either' = LA or NY
-- studio, in-person preferred, remote as fallback (what 073 hard-coded).
ALTER TABLE outreach_templates ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT 'either';

UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

[location]

If it sounds like a fit, just reply and we'll get [guest] booked in for this week or next.

More about the show: [one_sheet_url]

Best,
[sender]$body$,
    location = 'either',
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);
