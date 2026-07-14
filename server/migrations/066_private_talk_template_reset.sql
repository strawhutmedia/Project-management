-- One-time data fix for the Private Talk guest-outreach template.
--
-- The saved template + the prospects' generated sentences predate the
-- copy + prompt improvements (no-call ask, this-week/next-week timing,
-- honest hour->episode framing, and one-sentence generation). Editing
-- code only changes defaults + future generations; it can't rewrite rows
-- already saved in the DB. So this migration resets them directly, the
-- same way 034_promote_caroline.sql fixes live data.
--
-- 1) Replace the Private Talk template body with the short version.
-- 2) Clear the old multi-paragraph unique sentences so a single click of
--    "Generate all sentences" rewrites them with the improved prompt.
--    (Skips anyone already sent/replied so we never disturb live sends.)

UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas, and we'd love to have you on.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

If it sounds like a fit, just reply and we'll get you booked in for this week or next — no call needed.

More about the show: [one_sheet_url]

Best,
Ryan$body$,
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);

UPDATE outreach_prospects
SET unique_sentence = NULL,
    unique_sentence_generated_at = NULL,
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
)
  AND status NOT IN ('sent', 'replied', 'opted_out');
