-- Single-row heartbeat for the edit-machine Premiere bot. Stamped on every
-- token-authed poll of /api/qa/approved and every bot-log post, so Slate
-- can tell "edit PC is off" apart from "bot is on but stuck" and the QA
-- page can show when the bot was last seen.
CREATE TABLE IF NOT EXISTS qa_bot_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_source TEXT
);
