-- Follow-up outreach lane (Caroline's ask).
--
-- Goal: follow up with prospects who received the initial email but never
-- replied. This is a SEPARATE lane that NEVER touches the initial-send path
-- (sendOneProspect / status='queued'). A prospect is "queued for follow-up"
-- when followup_scheduled_at IS NOT NULL AND followup_sent_at IS NULL, while
-- its status stays 'sent'. The durable tick fires follow-ups with the same
-- jittered 90-180s pacing as the initial campaign.
--
-- Hard exclusions are enforced by the claim query, not stored flags: a
-- follow-up only ever fires for status = 'sent' AND replied_at IS NULL AND
-- followup_sent_at IS NULL. Anyone who replied / bounced / opted out / failed
-- has a status other than 'sent', so they are structurally excluded — they can
-- never receive a follow-up. followup_sent_at gates it to exactly one follow-up
-- per person (no loops).

-- Second template body, reusing the same [name]/[unique_sentence]/[link] merge
-- tokens as the initial template. Blank until Caroline writes one; the sender
-- refuses to fire a follow-up while these are empty.
ALTER TABLE outreach_templates ADD COLUMN IF NOT EXISTS followup_subject text;
ALTER TABLE outreach_templates ADD COLUMN IF NOT EXISTS followup_body text;

-- followup_scheduled_at: when the durable loop should fire this prospect's
--   follow-up (set at queue time, mirrors scheduled_send_at for the initial).
-- followup_sent_at: stamped once the follow-up actually goes out — the one-and-
--   done gate.
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS followup_scheduled_at timestamptz;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz;

-- Mark follow-up rows in the send log so analytics/opens can tell an initial
-- send from its follow-up. Defaults false so every existing row is an initial.
ALTER TABLE outreach_sends ADD COLUMN IF NOT EXISTS is_followup boolean NOT NULL DEFAULT false;

-- The tick claims due follow-ups on exactly this predicate.
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_followup_due
  ON outreach_prospects (followup_scheduled_at)
  WHERE followup_scheduled_at IS NOT NULL AND followup_sent_at IS NULL;
