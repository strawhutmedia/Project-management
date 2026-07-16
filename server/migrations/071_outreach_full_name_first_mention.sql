-- First-mention style fix. When we pitch a rep (agent/manager) on their
-- client, the AI sentence named the client by first name only ("We'd love to
-- have Amaya on…"). For someone we've never emailed, a bare first name reads
-- as oddly familiar — the FIRST mention should be the full name ("Amaya
-- Espinal"). The generator prompt now does this going forward; this fixes the
-- sentences already saved.
--
-- For each rep prospect whose client has a multi-word name, if the sentence
-- mentions the client's first name but NOT their full name, expand the FIRST
-- occurrence of that first name to the full name. Only the first occurrence is
-- touched (no 'g' flag), so any later mention stays first-name — matching the
-- booking line's [guest] token, which intentionally stays casual.
UPDATE outreach_prospects
SET unique_sentence = regexp_replace(
      unique_sentence,
      '\y' || split_part(trim(client_name), ' ', 1) || '\y',
      trim(client_name),
      ''
    ),
    updated_at = now()
WHERE recipient_type IN ('agent', 'manager')
  AND client_name IS NOT NULL
  AND position(' ' IN trim(client_name)) > 0
  AND unique_sentence IS NOT NULL
  AND unique_sentence ~ ('\y' || split_part(trim(client_name), ' ', 1) || '\y')
  AND unique_sentence NOT LIKE '%' || trim(client_name) || '%';
