-- Small key/value settings for the storage feature. First key: auto_queue —
-- when 'on' (default), an idle NAS box automatically starts its next paused
-- transfer (Slate enqueues the same 'start' command the Resume button does).
CREATE TABLE IF NOT EXISTS storage_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO storage_settings (key, value) VALUES ('auto_queue', 'on')
ON CONFLICT (key) DO NOTHING;
