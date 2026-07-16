-- Fix the sign-off on the Private Talk outreach template. Caroline sends
-- these emails, but the saved body was still signed "Best, Ryan" (set by
-- migrations 066/067). The recipient sees an email from Caroline signed by
-- someone else, which is confusing. Change the signature to Caroline, the
-- actual sender. Same approach as 066/067: the template row lives in the DB
-- and can't be edited from code, so update it directly. Only rewrites the
-- body; leaves sentences, reply-to, and everything else untouched.
UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas, and we'd love to have you on.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

If it sounds like a fit, just reply and we'll get you booked in for this week or next.

More about the show: [one_sheet_url]

Best,
Caroline$body$,
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);

-- Clean already-generated sentences that led with their own greeting. The
-- email template opens with "Hi [name]," and the unique sentence drops in
-- right after, so a sentence starting "Hi Steven, we'd love to…" produces a
-- doubled greeting in the sent email. Strip a leading salutation
-- ("Hi <name>,", "Hey", "Hello", "Dear", …) from every saved sentence and
-- re-capitalize the first remaining character. The generator now forbids
-- this going forward; this fixes the rows already in the DB.
UPDATE outreach_prospects
SET unique_sentence = (
  upper(left(trimmed, 1)) || substring(trimmed FROM 2)
)
FROM (
  SELECT id AS pid,
         regexp_replace(
           unique_sentence,
           '^(hi|hey|hello|dear|greetings)\y[^,:—-]*[,:—-]\s*',
           '',
           'i'
         ) AS trimmed
  FROM outreach_prospects
  WHERE unique_sentence IS NOT NULL
    AND unique_sentence ~* '^(hi|hey|hello|dear|greetings)\y[^,:—-]*[,:—-]'
) AS cleaned
WHERE outreach_prospects.id = cleaned.pid
  AND cleaned.trimmed <> ''
  AND cleaned.trimmed <> outreach_prospects.unique_sentence;
