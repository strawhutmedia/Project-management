-- Per-project stage label overrides. Internal stage values stay the same
-- (writing/tracking/overdubs/producing/stems/mixing/mastering/done) so
-- existing data is unaffected, but the displayed label/icon for each
-- stage can be overridden per project.
-- Format: {"writing": {"label": "Scheduled", "icon": "📅"}, ...}
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
