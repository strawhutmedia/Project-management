-- Surface rclone's error counter on the Storage page's transfer rows so a
-- struggling job shows "N errors" in red instead of failing silently.
ALTER TABLE storage_transfer_reports ADD COLUMN IF NOT EXISTS errors INT;
