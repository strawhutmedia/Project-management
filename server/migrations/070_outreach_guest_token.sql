-- Third guest-clarity fix. The closing line still said "we'll get you booked
-- in", which presumes the recipient is the guest. When the recipient is a rep
-- (agent/manager), we're booking their CLIENT, not them — so "you" is wrong.
-- Swap the literal "you" in the booking line for a [guest] token the sender
-- path resolves per prospect: "you" for a direct guest, the client's name
-- (e.g. "Amaya") for a rep. This mirrors the intro fix in 069.
UPDATE outreach_templates
SET body = $body$Hi [name],

I'm a producer at Straw Hut Media — we make Private Talk with Alexis Texas.

[unique_sentence]

The interview itself runs about an hour, and we edit it down into a polished ~45-minute episode. You'll get the audio plus a highlight clip package to share wherever you'd like.

If it sounds like a fit, just reply and we'll get [guest] booked in for this week or next.

More about the show: [one_sheet_url]

Best,
[sender]$body$,
    updated_at = now()
WHERE project_id IN (
  SELECT id FROM projects WHERE kind = 'podcast' AND name ILIKE '%private talk%'
);
