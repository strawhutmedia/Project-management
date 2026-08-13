-- Vendor self-service intake: contractors submit their own W9 + address via
-- a private, expiring, per-contractor link. The TIN (SSN/EIN) is stored
-- ENCRYPTED (AES-256-GCM, see server/crypto_vault.ts) — never plaintext —
-- with only the last 4 digits kept in the clear for display. Bank details
-- are NOT collected here; contractors enter those directly in Melio.
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS legal_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_classification TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tin_type TEXT NOT NULL DEFAULT '',          -- 'ssn' | 'ein' | ''
  ADD COLUMN IF NOT EXISTS tin_last4 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tin_encrypted TEXT,                          -- AES-256-GCM payload (iv:tag:ct)
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_us_person BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS prefers_ach BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS w9_signature TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS w9_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS w9_status TEXT NOT NULL DEFAULT 'none',      -- 'none' | 'requested' | 'on_file'
  ADD COLUMN IF NOT EXISTS w9_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_token_hash TEXT,                      -- sha256 of the link token
  ADD COLUMN IF NOT EXISTS intake_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contractors_intake_token ON contractors(intake_token_hash);
