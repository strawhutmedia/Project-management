-- Per-show audience (email list) CRM.
--
-- The comment-trigger funnel: a fan comments a trigger word on a show's
-- IG/FB post → ManyChat (official Meta API partner) DMs them and
-- collects their email → ManyChat's External Request action POSTs the
-- email to Slate's capture endpoint → the contact lands here AND syncs
-- to a per-show Resend audience, ready for broadcasts.
--
-- Lists are per-SHOW deliberately: fans follow shows, not the network.
--
-- audience_capture_token: secret path segment for the public capture
-- webhook (/api/audience/hooks/:token). Per-show so a leaked token only
-- exposes one show's intake and can be rotated without touching others.
-- resend_audience_id: lazily-created Resend audience for the show.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS audience_capture_token text,
  ADD COLUMN IF NOT EXISTS resend_audience_id text;

CREATE TABLE IF NOT EXISTS audience_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  -- Social handle (IG username etc.) when the capture source knows it.
  handle text,
  -- Where the contact came from: manychat | landing | manual | import
  source text NOT NULL DEFAULT 'manychat',
  -- The comment trigger word that started the flow ("RAVEN"), when known.
  -- Doubles as consent context: what they asked for.
  trigger_word text,
  resend_synced_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_audience_contacts_project
  ON audience_contacts(project_id, created_at DESC);
