-- Growth pipeline: Ryan wants a real target MRR ($80,000/mo, per his own
-- stated goal) tracked against a working list of prospective new-client
-- deals, so growth toward it is visible instead of abstract.

CREATE TABLE IF NOT EXISTS cashflow_growth_target (
  id INT PRIMARY KEY DEFAULT 1,
  target_mrr_cents BIGINT NOT NULL DEFAULT 8000000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_growth_target_singleton CHECK (id = 1)
);
INSERT INTO cashflow_growth_target (id, target_mrr_cents) VALUES (1, 8000000)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cashflow_pipeline_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  estimated_mrr_cents BIGINT NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'prospecting'
    CHECK (stage IN ('prospecting', 'quoted', 'negotiating', 'won', 'lost')),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cashflow_pipeline_deals_stage ON cashflow_pipeline_deals(stage);

-- Seed the one real, named prospect already discussed this session -- real
-- intro (May 2026, via Brett Marchand), a call was scheduled (June 2026),
-- but no rate has ever actually been quoted. Estimated value left at $0
-- until a real number exists -- consistent with not guessing at unverified
-- figures anywhere else in this tracker.
INSERT INTO cashflow_pipeline_deals (name, estimated_mrr_cents, stage, notes)
VALUES (
  'Bruce Poon Tip (G Adventures)', 0, 'prospecting',
  'Real prospect -- founder of G Adventures, considering a podcast. Introduced May 2026 via Brett Marchand (Plus Company), a call was scheduled June 2026. No rate has ever been discussed or quoted -- needs an actual pricing call before this has a real estimated MRR value. Do not guess a number here until one exists.'
);
