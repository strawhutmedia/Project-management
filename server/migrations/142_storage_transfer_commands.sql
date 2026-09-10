-- Pause/Resume for NAS→vault transfer jobs. Slate stores the desired action;
-- the archive-commander container on each NAS polls for pending commands,
-- runs docker stop/start on the matching rclone container (mapped via
-- /volume1/rclone-config/containers.map on that box), then acks by setting
-- executed_at. One row per transfer name = only the latest intent matters.
CREATE TABLE IF NOT EXISTS storage_transfer_commands (
  name TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('stop', 'start')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);
