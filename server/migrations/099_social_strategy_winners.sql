-- Final tool from Ryan's updated playbook (Aug 2026):
--   winners  "Copy Your Own Winners" — review pasted past posts, find
--            the patterns behind the strongest and weakest ones, and
--            extract a repeatable formula
--
-- (Playbook prompt 6, "Write the Caption Last", upgraded the existing
-- 'post' kind in place — no new kind needed.)
ALTER TABLE social_strategy_documents
  DROP CONSTRAINT IF EXISTS social_strategy_documents_kind_check;

ALTER TABLE social_strategy_documents
  ADD CONSTRAINT social_strategy_documents_kind_check CHECK (kind IN (
    'strategy', 'audience', 'authority', 'pillars',
    'calendar', 'post', 'monetization',
    'profile_audit', 'ideas', 'winners'
  ));
