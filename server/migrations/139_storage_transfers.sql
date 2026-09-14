-- Live NAS→archive transfer stats, POSTed by the reporter container running
-- on the UGREEN (tails each rclone job log once a minute). One row per job
-- log name; the Storage page renders these as progress bars.
CREATE TABLE IF NOT EXISTS storage_transfer_reports (
  name TEXT PRIMARY KEY,
  raw TEXT NOT NULL DEFAULT '',
  bytes_done TEXT NOT NULL DEFAULT '',
  bytes_total TEXT NOT NULL DEFAULT '',
  percent INT,
  speed TEXT NOT NULL DEFAULT '',
  eta TEXT NOT NULL DEFAULT '',
  files_done INT,
  files_total INT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
