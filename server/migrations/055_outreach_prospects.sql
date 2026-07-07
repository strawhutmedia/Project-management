-- Per-show outreach: prospects + templates + send log.
--
-- Every podcast project gets exactly one outreach_templates row (upserted
-- from the editor) and many outreach_prospects rows (the guest list you
-- build up over time). Sends are logged to outreach_sends so the sender
-- can pace itself + so we can compute health scores per domain later.

-- One template per show. The editor upserts on project_id.
CREATE TABLE IF NOT EXISTS outreach_templates (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  from_name TEXT,
  reply_to TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per person you might email. Slate never sends without an
-- email. `recipient_type` is the key hint Claude uses to craft the
-- unique sentence — a note to an agent reads differently than a note
-- to the guest themselves.
CREATE TABLE IF NOT EXISTS outreach_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- The merge value for [name] in the email ("Alex" for a friendly
  -- "Hi Alex,"). Required — Slate refuses to send without one.
  name TEXT NOT NULL,

  -- Formal name for subject lines / signature blocks. Optional.
  full_name TEXT,

  -- Where the message actually goes. NULL means "found the prospect
  -- but haven't hunted the email yet" — status stays needs_email.
  email TEXT,

  -- person   → the guest themselves
  -- agent    → their agent, sentence should pitch the client
  -- manager  → their manager, sentence should pitch the client
  -- other    → PR firm, assistant, unclear — Claude defaults conservative
  recipient_type TEXT NOT NULL DEFAULT 'person'
    CHECK (recipient_type IN ('person', 'agent', 'manager', 'other')),

  -- Optional: name of the client if recipient_type is agent/manager.
  client_name TEXT,

  -- Free-form facts about the prospect. Claude reads this to craft
  -- the unique sentence. "Founder of X, just did Y podcast, launched
  -- Z in April" — one or two lines is plenty.
  context TEXT,

  -- The AI-generated line that gets inserted at [unique_sentence] in
  -- the body. Editable before send. NULL means we haven't generated
  -- it yet — sender refuses to fire until this is filled.
  unique_sentence TEXT,
  unique_sentence_generated_at TIMESTAMPTZ,

  -- needs_email  → email is NULL, sender skips
  -- ready        → email + unique_sentence both filled, eligible to send
  -- queued       → picked up by the sender, waiting for its slot
  -- sent         → send completed successfully
  -- replied      → reply captured via inbound webhook
  -- bounced      → hard bounce
  -- opted_out    → clicked the unsubscribe link
  -- failed       → send errored (rate limit, invalid, etc.)
  status TEXT NOT NULL DEFAULT 'needs_email'
    CHECK (status IN ('needs_email','ready','queued','sent','replied','bounced','opted_out','failed')),

  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,

  -- Domain used for the send (for reply-rate scoring later).
  sending_domain_id UUID REFERENCES sending_domains(id) ON DELETE SET NULL,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_prospects_project
  ON outreach_prospects (project_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_email
  ON outreach_prospects (email) WHERE email IS NOT NULL;

-- Send log — one row per attempted send. Even failed sends land here
-- so we can compute bounce/complaint rates per domain over time.
CREATE TABLE IF NOT EXISTS outreach_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES outreach_prospects(id) ON DELETE CASCADE,
  sending_domain_id UUID REFERENCES sending_domains(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  resend_message_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('queued','sent','bounced','complained','failed','opted_out')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_sends_domain
  ON outreach_sends (sending_domain_id, created_at);
