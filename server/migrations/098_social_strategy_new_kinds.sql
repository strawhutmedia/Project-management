-- Two new social-strategy tools (Ryan's updated playbook, Aug 2026):
--   profile_audit  "Fix the Profile" — audit an existing social profile
--                  before feeding it more content
--   ideas          "Never Run Out of Ideas" — idea bank sorted by
--                  beginner / intermediate / advanced audience levels
--
-- The kind column has an inline CHECK from 050 — widen it.
ALTER TABLE social_strategy_documents
  DROP CONSTRAINT IF EXISTS social_strategy_documents_kind_check;

ALTER TABLE social_strategy_documents
  ADD CONSTRAINT social_strategy_documents_kind_check CHECK (kind IN (
    'strategy', 'audience', 'authority', 'pillars',
    'calendar', 'post', 'monetization',
    'profile_audit', 'ideas'
  ));
