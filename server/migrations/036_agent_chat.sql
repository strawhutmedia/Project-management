-- Inline Claude agent for Ryan + Caroline + Claude as a shared
-- three-way chat — like a Slack thread with the bot in it. Everyone
-- with access sees every message. Phase 1: conversation + message
-- history. Tool execution + git push gets bolted on in subsequent
-- migrations.
--
-- One conversation = one thread the team can come back to. Anyone
-- on the access list can post into it; Claude responds to the
-- whole thread (it sees who said what).
CREATE TABLE IF NOT EXISTS agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New conversation',
  -- Audit-only: which user kicked off the thread. Anyone with
  -- access can still post; this is just for "started by" labels.
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Total Claude tokens consumed across all messages. Used for the
  -- per-day cap that protects against runaway spend.
  total_input_tokens bigint NOT NULL DEFAULT 0,
  total_output_tokens bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_recent
  ON agent_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  -- 'user' or 'assistant'. The system prompt is reconstructed per
  -- turn from the live codebase, not stored.
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  -- Which human posted this. NULL for assistant messages. When we
  -- replay the conversation to Claude we prefix each user turn with
  -- the author's display name so Claude knows who said what.
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Plain text content. For assistant messages with tool calls
  -- attached (Phase 2), the human-readable text portion lives here
  -- and the tool_calls live in tool_calls.
  content text NOT NULL DEFAULT '',
  -- Phase 2 fields: tool_calls is what the assistant asked to run;
  -- tool_results is what came back when we ran them.
  tool_calls jsonb,
  tool_results jsonb,
  input_tokens int,
  output_tokens int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation
  ON agent_messages(conversation_id, created_at ASC);
