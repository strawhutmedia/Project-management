-- Phase 2 of the Slate agent chat: messages now carry an optional
-- English translation, used when the author writes in another
-- language (Caroline often types in Filipino). UI shows the original
-- + translation; Claude sees the translation in the transcript.
ALTER TABLE agent_messages
  ADD COLUMN IF NOT EXISTS detected_language text,
  ADD COLUMN IF NOT EXISTS english_translation text;
