-- Manual "clear this row" for the Transfers card. A dismissal hides the row
-- as of dismissed_at; fresh progress after that moment un-hides it (same
-- drive re-plugged later = new activity = visible again).
CREATE TABLE IF NOT EXISTS storage_transfer_dismissals (
  name TEXT PRIMARY KEY,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
