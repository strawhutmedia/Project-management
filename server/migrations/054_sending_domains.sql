-- Sending-domain pool for guest outreach. We rotate sends across a
-- pool of N domains (~3-4 to start) so cold-outreach volume never
-- concentrates on a single sender identity. If one domain's
-- reputation dips, Slate auto-pauses it and falls back to the next
-- healthiest — the operator gets an email alert and can buy a
-- replacement before delivery breaks.
--
-- Health scores + rotation logic land with the sender (migration 057
-- or so). This table holds the pool config + Resend verification
-- state so the admin dashboard has something to render today.

CREATE TABLE IF NOT EXISTS sending_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The domain itself (e.g. 'strawhut.media'). Slate constructs the
  -- from-address at send time as e.g. `guests@strawhut.media`.
  name TEXT UNIQUE NOT NULL,

  -- Resend's ID for the verified domain, populated when the operator
  -- runs the "Verify with Resend" action. NULL means we haven't
  -- registered it with Resend yet.
  resend_id TEXT,

  -- Lifecycle:
  --   pending    → added but Resend hasn't seen it yet (DNS not done)
  --   verifying  → Resend is checking DNS records
  --   verified   → SPF/DKIM/DMARC pass; safe to send from
  --   failed     → verification failed; check DNS
  --   paused     → admin flipped it off, or auto-pause tripped
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verifying','verified','failed','paused')),

  -- Admin toggle. When FALSE, sender skips this domain even if
  -- health is good. Useful for "resting" a domain in rotation.
  active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Pin a show to a primary domain so recipients see consistent
  -- sender identity across a campaign. NULL = pool member available
  -- to any show.
  primary_show_id UUID REFERENCES projects(id) ON DELETE SET NULL,

  -- When we first sent from this domain — health score factors this
  -- in (older = more trusted by inbox providers).
  warmup_start_date DATE,

  -- Rolling 30-day stats. NULL until sender wires health scoring.
  health_score INT CHECK (health_score BETWEEN 0 AND 100),
  bounce_rate NUMERIC(5,4),
  complaint_rate NUMERIC(5,4),
  reply_rate NUMERIC(5,4),
  last_computed_at TIMESTAMPTZ,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sending_domains_active
  ON sending_domains (active, status) WHERE active = TRUE;
