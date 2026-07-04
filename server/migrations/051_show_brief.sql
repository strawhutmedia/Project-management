-- Per-show strategic brief. Captured once, edited when things change,
-- read automatically by every strategy tool. This is the missing
-- foundation — Claude was previously inferring niche/audience/etc.
-- from the show name + a free-form paste field. Now the operator
-- answers a structured questionnaire ONCE and every generation is
-- grounded in the same facts.
CREATE TABLE IF NOT EXISTS social_strategy_briefs (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,

  -- Free-form paragraph: what does this show actually do? Who owns
  -- it? What's the origin story if it matters?
  business_description TEXT,

  -- The specific corner of the space this show occupies. Not
  -- "podcasts" — "a business podcast for marketing execs who came
  -- up on TV and are figuring out streaming."
  niche TEXT,

  -- Who the show is FOR — described the way a strategist would
  -- (occupation, life stage, aspiration, pain).
  target_audience TEXT,

  -- Named competitors — comma or newline separated. e.g.
  -- "Marketing Against The Grain, The Marketing Book Podcast".
  competitors TEXT,

  -- What "winning" looks like over the next 12 months. Specific
  -- targets are better than "grow the audience."
  growth_goals TEXT,

  -- Where the show is today. Followers, avg downloads, engagement,
  -- top platforms, monthly revenue, anything a strategist would ask.
  current_metrics TEXT,

  -- Current monetization: ads / sponsors / subscriptions / courses /
  -- speaking / consulting funnel / etc.
  monetization_current TEXT,

  -- Constraints — team size, legal, sponsor conflicts, publishing
  -- cadence, brand pressure. Things a strategy that ignores would
  -- get thrown out.
  constraints TEXT,

  -- Anything else worth telling a strategist about the show.
  notes TEXT,

  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
