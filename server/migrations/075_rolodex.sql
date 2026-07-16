-- The Straw Hut Rolodex: a workspace-wide contact book that outlives any one
-- show's outreach. When a prospect replies, they're filed here automatically
-- (unless they bounced / opted out / said wrong-email — those never land).
-- Caroline can also add contacts by hand or in bulk. Later, contacts can be
-- pulled into any show's outreach as fresh prospects. Deduped by email.
CREATE TABLE IF NOT EXISTS rolodex_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,          -- lowercased; the dedup key
  name           text NOT NULL,
  full_name      text,
  recipient_type text,                           -- person / agent / manager / other
  client_name    text,                           -- who they represent, if a rep
  context        text,                           -- the facts we know about them
  tags           text[] NOT NULL DEFAULT '{}',   -- e.g. 'responded', 'love-island'
  notes          text,
  source         text NOT NULL DEFAULT 'manual', -- 'replied' | 'manual' | 'import'
  source_show    text,                           -- show they responded to / came from
  added_by       uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rolodex_contacts_created ON rolodex_contacts (created_at DESC);
