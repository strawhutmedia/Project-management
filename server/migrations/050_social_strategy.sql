-- Per-show social strategy documents.
--
-- Seven Claude-driven strategy tools per project:
--   strategy    Full social media strategy (foundational)
--   audience    Audience psychology breakdown
--   authority   Authority positioning plan
--   pillars     Content pillars that convert (usually 5)
--   calendar    30-day content plan
--   post        Ad-hoc "post that stops the scroll" drafts
--   monetization  Audience monetization strategy
--
-- One row per (project, kind) — the "current" document. Older
-- versions live in social_strategy_versions so an admin can revert
-- or diff. `input_context` captures whatever the operator typed into
-- [paste] fields so the same input can be replayed later.
CREATE TABLE IF NOT EXISTS social_strategy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'strategy', 'audience', 'authority', 'pillars',
    'calendar', 'post', 'monetization'
  )),
  content JSONB NOT NULL,
  input_context TEXT,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generating', 'generated', 'failed')),
  error TEXT,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_social_strategy_docs_project
  ON social_strategy_documents(project_id);

-- Version history (append-only). Every regenerate INSERTs a row here
-- before overwriting the "current" doc, so we never lose an old draft.
CREATE TABLE IF NOT EXISTS social_strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES social_strategy_documents(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  input_context TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_strategy_versions_doc
  ON social_strategy_versions(document_id, created_at DESC);
