-- Pre-send recipient-email verification.
--
-- Before a campaign can fire, every Ready prospect's address gets an
-- in-house check: syntax + a DNS MX lookup on the domain to confirm it
-- can actually receive mail. Dead/typo'd domains are the fastest way to
-- rack up bounces and torch a sending domain's reputation, so the sender
-- refuses to send an unchecked address and skips ones that come back
-- undeliverable.
--
--   unchecked → not run yet (default). Sender is BLOCKED until checked.
--   valid     → domain has MX records, mail should deliver.
--   risky     → domain resolves (A record) but has no MX — unusual for a
--               real mail domain; deliverable sometimes, warned in the UI.
--   invalid   → bad syntax, disposable domain, or domain doesn't resolve.
--               Never sent. Also set automatically on a hard bounce.
ALTER TABLE outreach_prospects
  ADD COLUMN IF NOT EXISTS email_check_status TEXT NOT NULL DEFAULT 'unchecked'
    CHECK (email_check_status IN ('unchecked', 'valid', 'risky', 'invalid')),
  ADD COLUMN IF NOT EXISTS email_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_check_detail TEXT;
