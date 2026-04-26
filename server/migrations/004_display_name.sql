-- Add display_name (used for @mentions, defaults to first part of name).
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
UPDATE users SET display_name = name WHERE display_name IS NULL;
