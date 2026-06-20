-- Per-scene producer note suggestion from Claude's breakdown pass.
--
-- When Claude analyzes a scene it can also surface a one-line producer
-- heads-up: "this is your biggest cost", "permit risk", "stunt + armorer
-- + SFX makeup all on one day". The producer either applies it (we copy
-- to scenes.notes) or dismisses it (we NULL this column). The existing
-- scenes.notes column stays the producer's authoritative notes field.
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS producer_note_suggestion TEXT;
