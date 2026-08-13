-- Teleprompter sessions — a SHARED library for the podcast team.
--
-- Sessions used to live in each device's localStorage, which meant they
-- were trapped on whatever iPad/laptop created them. They now live here so
-- anyone with podcast access sees the same set, from any device.

CREATE TABLE IF NOT EXISTS teleprompter_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teleprompter_sessions_updated
  ON teleprompter_sessions (updated_at DESC);
