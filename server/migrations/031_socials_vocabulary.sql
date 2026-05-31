-- Per-show "spell these correctly" hint.
--
-- Deepgram transcribes phonetically, so guest names like "Cheri Oteri"
-- come out as "Sherri O'Teri" in the transcript — and Claude then
-- reuses that wrong spelling in every generated post. We let the team
-- list names + words that must be spelled a specific way, and we
-- prepend that list to the social plan prompt so Claude always uses
-- the canonical spelling regardless of what the transcript says.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS socials_vocabulary text;
