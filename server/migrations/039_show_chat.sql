-- Per-show chat: one shared thread per project where Claude has the
-- show's context (RSS description, brand voice, vocabulary, recent
-- episodes, etc.). Project members + admins can post; Claude responds
-- to whoever posted last but sees the full thread history so context
-- compounds over time.
--
-- model column tags assistant turns with which Claude model ran so
-- the UI can show cost weight and the daily cap can budget Opus turns
-- against Sonnet turns proportionally.

CREATE TABLE IF NOT EXISTS show_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL,
  -- 'sonnet' or 'opus' for assistant turns; null on user turns.
  model text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_show_chat_messages_project
  ON show_chat_messages (project_id, created_at ASC);
